import prisma from '../config/database';
import { s3Client } from '../config/s3';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/env';
import { NotFoundError, ValidationError } from '../utils/errors';
import { FileService } from '../files/file.service';

const fileService = new FileService();

export class UserProfileService {

    // ─── GET PROFILE ──────────────────────────────
    async getProfile(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                phone: true,
                role: true,
                bio: true,
                photoUrl: true,
                gstin: true,
                isVerified: true,
                status: true,
                createdAt: true,
                memberships: {
                    select: {
                        org: {
                            select: { id: true, name: true, city: true, phone: true, gstin: true },
                        },
                    },
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
            memberships: undefined, // clean up nested field
        };
    }

    // ─── EDIT NAME ────────────────────────────────
    async updateName(userId: string, name: string) {
        if (!name || name.trim().length < 2) {
            throw new ValidationError('Name must be at least 2 characters');
        }
        if (name.trim().length > 100) {
            throw new ValidationError('Name cannot exceed 100 characters');
        }

        const updated = await prisma.user.update({
            where: { id: userId },
            data: { name: name.trim() },
            select: { id: true, name: true },
        });

        return updated;
    }

    // ─── EDIT BIO ─────────────────────────────────
    async updateBio(userId: string, bio: string) {
        if (bio.length > 200) {
            throw new ValidationError('Bio cannot exceed 200 characters');
        }

        const updated = await prisma.user.update({
            where: { id: userId },
            data: { bio: bio.trim() || null },
            select: { id: true, bio: true },
        });

        return updated;
    }

    // ─── UPLOAD PROFILE PHOTO ─────────────────────
    // Flow:
    // 1. Frontend calls POST /profile/photo/upload-url to get presigned URL
    // 2. Frontend uploads directly to S3
    // 3. Frontend calls POST /profile/photo/confirm with fileId
    // 4. Backend saves URL to user.photoUrl, deletes old photo from S3 if exists

    async getPhotoUploadUrl(userId: string, filename: string, mimeType: string, fileSize: number) {
        // Validate mime type — only images
        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowedMimes.includes(mimeType)) {
            throw new ValidationError('Profile photo must be JPEG, PNG, or WebP');
        }

        // Validate file size — max 5MB for profile photos
        if (fileSize > 5 * 1024 * 1024) {
            throw new ValidationError('Profile photo must be under 5MB');
        }

        // Use existing file service to generate presigned URL
        const result = await fileService.generatePresignedUrl(
            { filename, mimeType, fileSize, purpose: 'PROFILE_PHOTO', skipCompression: false },
            userId
        );

        return result;
    }

    async confirmPhotoUpload(userId: string, fileId: string, s3Key: string) {
        // 1. Confirm the upload exists and belongs to user
        await fileService.confirmUpload(fileId, s3Key, userId);

        // 2. Fetch user's current photo s3Key for cleanup
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { photoS3Key: true },
        });

        // 3. Update user with new photo
        const attachment = await prisma.attachment.findUnique({
            where: { id: fileId },
            select: { url: true, s3Key: true },
        });

        if (!attachment) throw new NotFoundError('Attachment not found');

        await prisma.user.update({
            where: { id: userId },
            data: {
                photoUrl: attachment.url,
                photoS3Key: attachment.s3Key,
            },
        });

        // 4. Delete old photo from S3 (non-blocking, best-effort)
        if (user?.photoS3Key && user.photoS3Key !== attachment.s3Key) {
            s3Client.send(new DeleteObjectCommand({
                Bucket: config.aws.s3Bucket,
                Key: user.photoS3Key,
            })).catch(() => {
                // Silently ignore S3 cleanup failure
            });
        }

        return {
            success: true,
            photoUrl: attachment.url,
        };
    }

    // ─── REMOVE PROFILE PHOTO ─────────────────────
    async removePhoto(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { photoS3Key: true, photoUrl: true },
        });

        if (!user?.photoUrl) {
            throw new ValidationError('No profile photo to remove');
        }

        // Remove from S3 (non-blocking)
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
}
