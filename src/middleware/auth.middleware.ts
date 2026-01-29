import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { UnauthorizedError } from '../utils/errors';
import prisma from '../config/database';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    phone: string;
    role: string;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    // ✅ SECURITY FIX: Verify access token with access secret
    const decoded = jwt.verify(token, config.jwt.accessSecret) as {
      userId: string;
      phone: string;
      role: string;
    };

    // ✅ SECURITY FIX: Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, phone: true, role: true, status: true },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Account has been suspended or banned');
    }

    req.user = {
      id: user.id,
      phone: user.phone,
      role: user.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else {
      next(error);
    }
  }
};

// Optional auth - doesn't fail if no token
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token) {
      // ✅ SECURITY FIX: Verify access token with access secret
      const decoded = jwt.verify(token, config.jwt.accessSecret) as {
        userId: string;
        phone: string;
        role: string;
      };

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, phone: true, role: true, status: true },
      });

      // ✅ SECURITY FIX: Check user status in optional auth too
      if (user && user.status === 'ACTIVE') {
        req.user = {
          id: user.id,
          phone: user.phone,
          role: user.role,
        };
      }
    }

    next();
  } catch (error) {
    // Ignore auth errors in optional auth
    next();
  }
};
