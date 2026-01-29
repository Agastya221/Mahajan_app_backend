import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import prisma from '../config/database';
import { UserRole, OrgMemberRole } from '@prisma/client';

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

// Check if user is member of organization
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

      // Attach org role to request
      (req as any).orgRole = membership.role;

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Check if user is owner or admin of organization
export const requireOrgAdmin = (orgIdParam = 'orgId') => {
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

      if (!membership || membership.role !== OrgMemberRole.OWNER) {
        return next(new ForbiddenError('Requires organization admin access'));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
