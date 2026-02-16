import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { config } from '../config/env';
import { UnauthorizedError, ConflictError } from '../utils/errors';
import { RegisterDto } from './auth.dto';
import { UserRole } from '@prisma/client';
import { redisClient } from '../config/redis';
import { msg91Service } from './msg91.service';
import { logger } from '../utils/logger';

export class AuthService {
  // ─── Widget-based OTP verification ───────────────────────
  //
  // Flow:
  // 1. Frontend loads MSG91 widget (widgetId configured in HTML)
  // 2. User enters phone → widget sends OTP
  // 3. User enters OTP → widget verifies and returns JWT access token
  // 4. Frontend sends access token to POST /auth/verify-widget-token
  // 5. Backend verifies token with MSG91 and returns app tokens

  async verifyWidgetToken(widgetAccessToken: string, deviceInfo?: string) {
    // Verify the access token from MSG91 widget
    const { phone } = await msg91Service.verifyWidgetToken(widgetAccessToken);

    // Check if user already exists
    const user = await prisma.user.findUnique({
      where: { phone },
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    if (user) {
      // Existing user — check status
      if (user.status !== 'ACTIVE') {
        throw new UnauthorizedError('Account has been suspended or banned');
      }

      // Generate tokens and return
      const accessToken = this.generateAccessToken(user.id, user.phone, user.role);
      const refreshToken = await this.createRefreshToken(user.id, deviceInfo);

      return {
        isNewUser: false,
        user,
        tokens: { accessToken, refreshToken: refreshToken.token },
      };
    }

    // New user — return verification token for registration
    const verificationToken = jwt.sign(
      { phone, type: 'phone_verification' },
      config.jwt.accessSecret,
      { expiresIn: '10m' } as any,
    );

    return {
      isNewUser: true,
      phone,
      verificationToken,
    };
  }

  // ─── Registration (after OTP verification) ───────────────

  async register(data: RegisterDto, deviceInfo?: string) {
    // Decode and verify the verification token
    let decoded: { phone: string; type: string };
    try {
      decoded = jwt.verify(data.verificationToken, config.jwt.accessSecret) as {
        phone: string;
        type: string;
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired verification token');
    }

    if (decoded.type !== 'phone_verification') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Check if user already exists (race condition guard)
    const existing = await prisma.user.findUnique({
      where: { phone: decoded.phone },
    });

    if (existing) {
      throw new ConflictError('User with this phone already exists');
    }

    // Determine role based on registration path
    const role = data.registerAs === 'DRIVER' ? UserRole.DRIVER : UserRole.MAHAJAN;

    const user = await prisma.user.create({
      data: {
        phone: decoded.phone,
        name: data.name,
        role,
      },
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    // If MAHAJAN, auto-create Org and OrgMember, then link pending receiver trips
    if (role === UserRole.MAHAJAN) {
      // Check if a placeholder org already exists for this phone (created during guest trip)
      let org = await prisma.org.findFirst({
        where: { phone: decoded.phone },
      });

      if (org) {
        // ✅ Placeholder org exists — upgrade it with real name
        org = await prisma.org.update({
          where: { id: org.id },
          data: { name: `${data.name}'s Business` },
        });
        logger.info('Upgraded placeholder org for newly registered receiver', {
          orgId: org.id,
          phone: decoded.phone,
        });
      } else {
        // No placeholder — create new org as before
        org = await prisma.org.create({
          data: {
            name: `${data.name}'s Business`,
            phone: decoded.phone,
          },
        });
      }

      await prisma.orgMember.create({
        data: {
          orgId: org.id,
          userId: user.id,
        },
      });

      // ✅ Link any trips waiting for this receiver's phone number
      await this.linkPendingReceiverTrips(decoded.phone);
    }

    // If DRIVER, auto-create empty DriverProfile and link pending trips
    if (role === UserRole.DRIVER) {
      const driverProfile = await prisma.driverProfile.create({
        data: {
          userId: user.id,
        },
      });

      // Link any trips waiting for this driver's phone number
      await this.linkPendingDriverTrips(decoded.phone, driverProfile.id);
    }

    // Generate tokens
    const accessToken = this.generateAccessToken(user.id, user.phone, user.role);
    const refreshToken = await this.createRefreshToken(user.id, deviceInfo);

    logger.info('New user registered', { userId: user.id, phone: user.phone, role });

    return {
      user,
      tokens: { accessToken, refreshToken: refreshToken.token },
    };
  }

  // ─── Refresh Token (DB-stored with rotation) ─────────────

  async refreshToken(token: string, deviceInfo?: string) {
    // Look up the refresh token in DB
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: { select: { id: true, phone: true, role: true, status: true } } },
    });

    if (!storedToken) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Check if token was already revoked (potential breach — revoke entire family)
    if (storedToken.revokedAt) {
      logger.warn('Refresh token reuse detected — revoking token family', {
        family: storedToken.family,
        userId: storedToken.userId,
      });

      // Revoke ALL tokens in this family (breach detection)
      await prisma.refreshToken.updateMany({
        where: { family: storedToken.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      throw new UnauthorizedError('Token has been revoked. Please login again.');
    }

    // Check expiry
    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token has expired');
    }

    // Check user status
    if (storedToken.user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Account has been suspended or banned');
    }

    // Rotate: revoke old token + create new one in same family
    const [, newToken] = await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: {
          token: crypto.randomBytes(32).toString('hex'),
          userId: storedToken.userId,
          family: storedToken.family,
          expiresAt: new Date(Date.now() + config.jwt.refreshTokenExpiryDays * 24 * 60 * 60 * 1000),
          deviceInfo: deviceInfo || storedToken.deviceInfo,
        },
      }),
    ]);

    const accessToken = this.generateAccessToken(
      storedToken.user.id,
      storedToken.user.phone,
      storedToken.user.role as UserRole,
    );

    return {
      tokens: {
        accessToken,
        refreshToken: newToken.token,
      },
    };
  }

  // ─── Logout ──────────────────────────────────────────────

  async logout(accessToken: string, refreshToken?: string) {
    // Blacklist access token in Redis until it expires
    try {
      const decoded = jwt.decode(accessToken) as { exp?: number } | null;
      if (decoded?.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await redisClient.set(`bl:${accessToken}`, '1', 'EX', ttl);
        }
      }
    } catch { /* ignore decode errors */ }

    // Revoke refresh token in DB
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private async linkPendingDriverTrips(driverPhone: string, driverProfileId: string) {
    // Find all trips that were created with this driver's phone but driver hadn't registered yet
    const pendingTrips = await prisma.trip.findMany({
      where: {
        pendingDriverPhone: driverPhone,
        driverId: null,
      },
    });

    if (pendingTrips.length === 0) return;

    // ✅ Batch update for scale (updateMany for simple fields)
    await prisma.trip.updateMany({
      where: {
        pendingDriverPhone: driverPhone,
        driverId: null,
      },
      data: {
        driverId: driverProfileId,
        pendingDriverPhone: null,
        driverRegistered: true,
        trackingEnabled: true,
      },
    });

    // Update status CREATED → ASSIGNED for trips that are still in CREATED state
    await prisma.trip.updateMany({
      where: {
        driverId: driverProfileId,
        status: 'CREATED',
      },
      data: {
        status: 'ASSIGNED',
      },
    });

    logger.info('Linked pending trips to newly registered driver', {
      count: pendingTrips.length,
      driverPhone,
      driverProfileId,
    });
  }

  // ✅ NEW: Link trips waiting for a receiver (Mahajan) to register
  private async linkPendingReceiverTrips(receiverPhone: string) {
    // Find all trips where this phone was stored as pending receiver
    const pendingTrips = await prisma.trip.findMany({
      where: {
        pendingReceiverPhone: receiverPhone,
        receiverRegistered: false,
      },
      select: { id: true },
    });

    if (pendingTrips.length === 0) return;

    // Batch update — set receiverRegistered + paymentEnabled
    await prisma.trip.updateMany({
      where: {
        pendingReceiverPhone: receiverPhone,
        receiverRegistered: false,
      },
      data: {
        receiverRegistered: true,
        pendingReceiverPhone: null,
        paymentEnabled: true,
      },
    });

    logger.info('Linked pending trips to newly registered receiver', {
      count: pendingTrips.length,
      receiverPhone,
    });
  }

  private generateAccessToken(userId: string, phone: string, role: UserRole): string {
    return jwt.sign(
      { userId, phone, role, type: 'access' },
      config.jwt.accessSecret,
      { expiresIn: config.jwt.accessExpiration } as any,
    );
  }

  private async createRefreshToken(userId: string, deviceInfo?: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const family = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + config.jwt.refreshTokenExpiryDays * 24 * 60 * 60 * 1000);

    const refreshToken = await prisma.refreshToken.create({
      data: {
        token,
        userId,
        family,
        expiresAt,
        deviceInfo,
      },
    });

    return refreshToken;
  }

  static async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await redisClient.get(`bl:${token}`);
    return result !== null;
  }
}
