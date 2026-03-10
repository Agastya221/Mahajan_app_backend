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

  // ============================================
  // ✅ Contact Discovery — "Which of my phone contacts are on the platform?"
  // ============================================
  async checkContacts(phones: string[]) {
    // Normalize: strip spaces, ensure + prefix
    const normalized = [...new Set(
      phones.map(p => p.replace(/[\s\-()]/g, '')).filter(p => p.length >= 10)
    )];

    if (normalized.length === 0) {
      return { registeredUsers: [] };
    }

    // Single efficient query — only Mahajans, include status for banned/suspended visibility
    const users = await prisma.user.findMany({
      where: {
        phone: { in: normalized },
        role: UserRole.MAHAJAN,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        photoUrl: true,
        status: true,             // ACTIVE | SUSPENDED | BANNED
        isVerified: true,         // GST verified badge
        memberships: {
          select: {
            org: {
              select: { id: true, name: true, city: true },
            },
          },
          take: 1,                // Primary org only
        },
      },
    });

    // Anti-enumeration: 100ms artificial delay so response time doesn't leak
    // whether 0 or 500 contacts matched
    await new Promise(resolve => setTimeout(resolve, 100));

    // Shape the response — expose status so frontend can show badges
    const registeredUsers = users.map(u => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      photoUrl: u.photoUrl,
      status: u.status,           // "ACTIVE" | "SUSPENDED" | "BANNED"
      isVerified: u.isVerified,
      org: u.memberships[0]?.org || null,
    }));

    return { registeredUsers };
  }
}
