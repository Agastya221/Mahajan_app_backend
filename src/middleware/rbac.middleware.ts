import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import prisma from '../config/database';
import { UserRole } from '@prisma/client';

// Check if user has specific role
export const requireRole = (...roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (!roles.includes(req.user.role as UserRole)) {
      return next(new ForbiddenError('Insufficient permissions'));
    }

    next();
  };
};

// Check if user is member of organization (every mahajan is sole owner of their org)
export const requireOrgMember = (orgIdParam = 'orgId') => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(new UnauthorizedError());
      }

      const orgId = req.params[orgIdParam] || req.body[orgIdParam];

      if (!orgId) {
        return next(new ForbiddenError('Organization ID required'));
      }

      const membership = await prisma.orgMember.findUnique({
        where: {
          orgId_userId: {
            orgId,
            userId: req.user.id,
          },
        },
      });

      if (!membership) {
        return next(new ForbiddenError('Not a member of this organization'));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Alias — every mahajan is the sole owner, so org admin = org member
export const requireOrgAdmin = requireOrgMember;
