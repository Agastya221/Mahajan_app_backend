import { z } from 'zod';

export const presignedUrlRequestSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
  fileSize: z.number().positive('File size must be positive').max(10 * 1024 * 1024, 'File size cannot exceed 10MB'),
  purpose: z.enum(['LOAD_CARD', 'RECEIVE_CARD', 'INVOICE', 'CHAT_ATTACHMENT']).optional(),
});

export const confirmUploadSchema = z.object({
  fileId: z.cuid('Invalid file ID'),
  s3Key: z.string().min(1, 'S3 key is required'),
});

export type PresignedUrlRequestDto = z.infer<typeof presignedUrlRequestSchema>;
export type ConfirmUploadDto = z.infer<typeof confirmUploadSchema>;
