import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { config } from '../config/env';
import { UnauthorizedError, ConflictError, ValidationError } from '../utils/errors';
import { RegisterDto } from './auth.dto';
import { UserRole } from '@prisma/client';
import { redisClient } from '../config/redis';
import { msg91Service } from './msg91.service';
import { logger } from '../utils/logger';

export class AuthService {
  // ─── OTP Flow ────────────────────────────────────────────

  async sendOtp(phone: string) {
    await msg91Service.sendOTP(phone);
    return { message: 'OTP sent successfully' };
  }

  async resendOtp(phone: string, retryType?: 'voice' | 'text') {
    await msg91Service.resendOTP(phone, retryType);
    return { message: 'OTP resent successfully' };
  }

  async verifyOtp(phone: string, otp: string, deviceInfo?: string) {
    // Verify OTP via MSG91
    await msg91Service.verifyOTP(phone, otp);

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

    // Create user — SaaS model: always MAHAJAN_STAFF on self-registration
    const user = await prisma.user.create({
      data: {
        phone: decoded.phone,
        name: data.name,
        role: UserRole.MAHAJAN_STAFF,
      },
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    // Generate tokens
    const accessToken = this.generateAccessToken(user.id, user.phone, user.role);
    const refreshToken = await this.createRefreshToken(user.id, deviceInfo);

    logger.info('New user registered', { userId: user.id, phone: user.phone });

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
