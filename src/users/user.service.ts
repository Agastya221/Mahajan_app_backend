import prisma from '../config/database';
import { s3Client } from '../config/s3';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/env';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError, UnauthorizedError } from '../utils/errors';
import { FileService } from '../files/file.service';
import { msg91Service } from '../auth/msg91.service';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { UserRole } from '@prisma/client';

const fileService = new FileService();
const VALID_REPORT_REASONS = ['SPAM', 'FRAUD', 'HARASSMENT', 'FAKE_ACCOUNT', 'OTHER'];

export class UserService {

  // ============================================
  // GSTIN
  // ============================================

  async submitGstin(userId: string, gstin: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');
    if (user.role !== UserRole.MAHAJAN) throw new ForbiddenError('Only mahajans can submit GSTIN');

    const existing = await prisma.user.findUnique({ where: { gstin } });
    if (existing && existing.id !== userId) {
      throw new ValidationError('This GSTIN is already registered to another user');
    }

    return prisma.user.update({
      where: { id: userId },
      data: { gstin, isVerified: false },
      select: { id: true, name: true, phone: true, gstin: true, isVerified: true },
    });
  }

  async getGstinStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, gstin: true, isVerified: true },
    });
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  async verifyGstin(userId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { isVerified: true },
      select: { id: true, name: true, phone: true, gstin: true, isVerified: true },
    });
  }

  // ============================================
  // CONTACT DISCOVERY
  // ============================================

  async checkContacts(phones: string[]) {
    const normalized = [...new Set(
      phones.map(p => p.replace(/[\s\-()]/g, '')).filter(p => p.length >= 10)
    )];

    if (normalized.length === 0) return { registeredUsers: [] };

    const users = await prisma.user.findMany({
      where: { phone: { in: normalized }, role: UserRole.MAHAJAN },
      select: {
        id: true, name: true, phone: true, photoUrl: true,
        status: true, isVerified: true,
        memberships: {
          select: { org: { select: { id: true, name: true, city: true } } },
          take: 1,
        },
      },
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const registeredUsers = users.map(u => ({
      id: u.id, name: u.name, phone: u.phone, photoUrl: u.photoUrl,
      status: u.status, isVerified: u.isVerified,
      org: u.memberships[0]?.org || null,
    }));

    return { registeredUsers };
  }

  // ============================================
  // PROFILE
  // ============================================

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, phone: true, role: true, bio: true,
        photoUrl: true, gstin: true, isVerified: true, status: true, createdAt: true,
        memberships: {
          select: { org: { select: { id: true, name: true, city: true, phone: true, gstin: true } } },
          take: 1,
        },
        driverProfile: {
          select: { id: true, licenseNo: true, emergencyPhone: true },
        },
      },
    });

    if (!user) throw new NotFoundError('User not found');

    return {
      ...user,
      org: user.memberships[0]?.org || null,
      memberships: undefined,
    };
  }

  async updateName(userId: string, name: string) {
    if (!name || name.trim().length < 2) throw new ValidationError('Name must be at least 2 characters');
    if (name.trim().length > 100) throw new ValidationError('Name cannot exceed 100 characters');

    return prisma.user.update({
      where: { id: userId },
      data: { name: name.trim() },
      select: { id: true, name: true },
    });
  }

  async updateBio(userId: string, bio: string) {
    if (bio.length > 200) throw new ValidationError('Bio cannot exceed 200 characters');

    return prisma.user.update({
      where: { id: userId },
      data: { bio: bio.trim() || null },
      select: { id: true, bio: true },
    });
  }

  // ============================================
  // PROFILE PHOTO
  // ============================================

  async getPhotoUploadUrl(userId: string, filename: string, mimeType: string, fileSize: number) {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(mimeType)) throw new ValidationError('Profile photo must be JPEG, PNG, or WebP');
    if (fileSize > 5 * 1024 * 1024) throw new ValidationError('Profile photo must be under 5MB');

    return fileService.generatePresignedUrl(
      { filename, mimeType, fileSize, purpose: 'PROFILE_PHOTO', skipCompression: false },
      userId
    );
  }

  async confirmPhotoUpload(userId: string, fileId: string, s3Key: string) {
    await fileService.confirmUpload(fileId, s3Key, userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { photoS3Key: true },
    });

    const attachment = await prisma.attachment.findUnique({
      where: { id: fileId },
      select: { url: true, s3Key: true },
    });
    if (!attachment) throw new NotFoundError('Attachment not found');

    await prisma.user.update({
      where: { id: userId },
      data: { photoUrl: attachment.url, photoS3Key: attachment.s3Key },
    });

    if (user?.photoS3Key && user.photoS3Key !== attachment.s3Key) {
      s3Client.send(new DeleteObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: user.photoS3Key,
      })).catch(() => { });
    }

    return { success: true, photoUrl: attachment.url };
  }

  async removePhoto(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { photoS3Key: true, photoUrl: true },
    });

    if (!user?.photoUrl) throw new ValidationError('No profile photo to remove');

    if (user.photoS3Key) {
      s3Client.send(new DeleteObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: user.photoS3Key,
      })).catch(() => { });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { photoUrl: null, photoS3Key: null },
    });

    return { success: true };
  }

  // ============================================
  // PHONE CHANGE (OTP RE-VERIFICATION)
  // ============================================

  async requestPhoneChange(userId: string, newPhone: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user) throw new NotFoundError('User not found');

    if (user.phone === newPhone) {
      throw new ValidationError('New phone must be different from current phone');
    }

    const existing = await prisma.user.findUnique({ where: { phone: newPhone } });
    if (existing) throw new ConflictError('Phone number already in use');

    const phoneChangeToken = jwt.sign(
      { userId, newPhone, type: 'phone_change' },
      config.jwt.accessSecret,
      { expiresIn: '10m' } as any,
    );

    logger.info('Phone change requested', { userId, newPhone });
    return { phoneChangeToken };
  }

  async confirmPhoneChange(userId: string, phoneChangeToken: string, msg91AccessToken: string) {
    let payload: { userId: string; newPhone: string; type: string };
    try {
      payload = jwt.verify(phoneChangeToken, config.jwt.accessSecret) as typeof payload;
    } catch {
      throw new UnauthorizedError('Invalid or expired phone change token');
    }

    if (payload.type !== 'phone_change') throw new UnauthorizedError('Invalid token type');
    if (payload.userId !== userId) throw new UnauthorizedError('Token does not belong to this user');

    const { phone: verifiedPhone } = await msg91Service.verifyWidgetToken(msg91AccessToken);

    if (verifiedPhone.replace(/\s/g, '') !== payload.newPhone.replace(/\s/g, '')) {
      throw new ValidationError('OTP verified phone does not match requested phone');
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!currentUser) throw new NotFoundError('User not found');

    const taken = await prisma.user.findUnique({ where: { phone: payload.newPhone } });
    if (taken && taken.id !== userId) throw new ConflictError('Phone number was taken while verifying OTP');

    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { phone: payload.newPhone } }),
      prisma.org.updateMany({
        where: { phone: currentUser.phone, members: { some: { userId } } },
        data: { phone: payload.newPhone },
      }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    logger.info('Phone number changed', { userId, newPhone: payload.newPhone });
    return { success: true };
  }

  // ============================================
  // REPORT USER
  // ============================================

  async reportUser(reportedByUserId: string, reportedUserId: string, reason: string, details?: string) {
    if (reportedByUserId === reportedUserId) throw new ValidationError('Cannot report yourself');
    if (!VALID_REPORT_REASONS.includes(reason)) {
      throw new ValidationError(`Invalid reason. Must be one of: ${VALID_REPORT_REASONS.join(', ')}`);
    }
    if (details && details.length > 500) throw new ValidationError('Details cannot exceed 500 characters');

    const reportedUser = await prisma.user.findUnique({
      where: { id: reportedUserId },
      select: { id: true },
    });
    if (!reportedUser) throw new NotFoundError('User not found');

    const report = await prisma.userReport.upsert({
      where: {
        reportedByUserId_reportedUserId: { reportedByUserId, reportedUserId },
      },
      create: { reportedByUserId, reportedUserId, reason, details: details || null, status: 'PENDING' },
      update: { reason, details: details || null, status: 'PENDING', updatedAt: new Date() },
    });

    logger.info('User reported', { reportedByUserId, reportedUserId, reason, reportId: report.id });
    return report;
  }
}
