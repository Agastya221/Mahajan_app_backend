import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { UserRole } from '@prisma/client';

export class UserService {
  async submitGstin(userId: string, gstin: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.role !== UserRole.MAHAJAN) {
      throw new ForbiddenError('Only mahajans can submit GSTIN');
    }

    // Check if GSTIN is already used by another user
    const existing = await prisma.user.findUnique({
      where: { gstin },
    });

    if (existing && existing.id !== userId) {
      throw new ValidationError('This GSTIN is already registered to another user');
    }

    // Store GSTIN — isVerified stays false until admin/system verifies
    return prisma.user.update({
      where: { id: userId },
      data: { gstin, isVerified: false },
      select: {
        id: true,
        name: true,
        phone: true,
        gstin: true,
        isVerified: true,
      },
    });
  }

  async getGstinStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        gstin: true,
        isVerified: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  async verifyGstin(userId: string) {
    // Admin-only — sets isVerified = true
    return prisma.user.update({
      where: { id: userId },
      data: { isVerified: true },
      select: {
        id: true,
        name: true,
        phone: true,
        gstin: true,
        isVerified: true,
      },
    });
  }
}
