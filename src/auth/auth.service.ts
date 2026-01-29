import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { config } from '../config/env';
import { UnauthorizedError, ConflictError } from '../utils/errors';
import { RegisterDto, LoginDto } from './auth.dto';
import { UserRole } from '@prisma/client';

export class AuthService {
  async register(data: RegisterDto) {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { phone: data.phone },
    });

    if (existingUser) {
      throw new ConflictError('User with this phone already exists');
    }

    // ✅ SECURITY FIX: Use 12 rounds minimum (OWASP 2024 recommendation)
    const BCRYPT_ROUNDS = 12;
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    // Create user
    const user = await prisma.user.create({
      data: {
        phone: data.phone,
        passwordHash,
        name: data.name,
        role: data.role,
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
    const tokens = this.generateTokens(user.id, user.phone, user.role);

    return {
      user,
      tokens,
    };
  }

  async login(data: LoginDto) {
    // Find user
    const user = await prisma.user.findUnique({
      where: { phone: data.phone },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(data.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Generate tokens
    const tokens = this.generateTokens(user.id, user.phone, user.role);

    return {
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      tokens,
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      // ✅ SECURITY FIX: Verify refresh token with refresh secret
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as {
        userId: string;
        phone: string;
        role: string;
        type: string;
      };

      if (decoded.type !== 'refresh') {
        throw new UnauthorizedError('Invalid token type');
      }

      // Verify user still exists
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      // Generate new tokens
      const tokens = this.generateTokens(user.id, user.phone, user.role);

      return { tokens };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError('Invalid refresh token');
      }
      throw error;
    }
  }

  private generateTokens(userId: string, phone: string, role: UserRole) {
    // ✅ SECURITY FIX: Use separate secrets for access and refresh tokens
    const accessToken = jwt.sign(
      { userId, phone, role, type: 'access' },
      config.jwt.accessSecret,
      { expiresIn: config.jwt.accessExpiration } as any
    );

    const refreshToken = jwt.sign(
      { userId, phone, role, type: 'refresh' },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiration } as any
    );

    return {
      accessToken,
      refreshToken,
    };
  }
}
