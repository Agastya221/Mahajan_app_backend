import { z } from 'zod';

export const updateNameSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(100),
});

export const updateBioSchema = z.object({
    bio: z.string().max(200, 'Bio cannot exceed 200 characters').default(''),
});

export const photoUploadUrlSchema = z.object({
    filename: z.string().min(1),
    mimeType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
    fileSize: z.number().positive().max(5 * 1024 * 1024, 'Max 5MB'),
});

export const confirmPhotoSchema = z.object({
    fileId: z.string().cuid(),
    s3Key: z.string().min(1),
});
