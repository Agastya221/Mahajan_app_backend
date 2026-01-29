import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
import prisma from '../config/database';
import { s3Client } from '../config/s3';
import { config } from '../config/env';
import { NotFoundError, ValidationError } from '../utils/errors';
import { PresignedUrlRequestDto } from './file.dto';
import { AttachmentType } from '@prisma/client';

export class FileService {
  async generatePresignedUrl(data: PresignedUrlRequestDto, uploadedByUserId: string) {
    // Validate file size (max 10MB)
    if (data.fileSize > 10 * 1024 * 1024) {
      throw new ValidationError('File size exceeds 10MB limit');
    }

    // Validate MIME type (basic validation)
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!allowedTypes.includes(data.mimeType)) {
      throw new ValidationError('Unsupported file type');
    }

    // Generate unique S3 key
    const fileExt = data.filename.split('.').pop() || 'unknown';
    const s3Key = `uploads/${uuid()}.${fileExt}`;

    // Generate S3 URL
    const url = config.aws.s3Endpoint
      ? `${config.aws.s3Endpoint}/${config.aws.s3Bucket}/${s3Key}` // MinIO
      : `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${s3Key}`; // AWS S3

    // Create file record with PENDING status
    const file = await prisma.attachment.create({
      data: {
        fileName: data.filename,
        s3Key,
        url,
        mimeType: data.mimeType,
        sizeBytes: data.fileSize,
        uploadedBy: uploadedByUserId,
        type: this.mapPurposeToType(data.purpose),
      },
    });

    // Generate presigned URL (valid for 15 minutes)
    const command = new PutObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: s3Key,
      ContentType: data.mimeType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    return {
      fileId: file.id,
      uploadUrl,
      s3Key,
      expiresIn: 900, // seconds
    };
  }

  async confirmUpload(fileId: string, s3Key: string, userId: string) {
    // Find the file record
    const file = await prisma.attachment.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundError('File not found');
    }

    // Verify the user who requested the upload is confirming it
    if (file.uploadedBy !== userId) {
      throw new ValidationError('Unauthorized to confirm this upload');
    }

    // Verify s3Key matches
    if (file.s3Key !== s3Key) {
      throw new ValidationError('S3 key mismatch');
    }

    // Update status to COMPLETED
    await prisma.attachment.update({
      where: { id: fileId },
      data: { status: 'COMPLETED' },
    });

    return {
      id: file.id,
      url: file.url,
      filename: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }

  async generateDownloadUrl(fileId: string) {
    const file = await prisma.attachment.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundError('File not found');
    }

    // Generate presigned GET URL (valid for 1 hour)
    const command = new GetObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: file.s3Key || undefined,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return {
      downloadUrl,
      filename: file.fileName,
      expiresIn: 3600, // seconds
    };
  }

  async getFileById(fileId: string) {
    const file = await prisma.attachment.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundError('File not found');
    }

    return file;
  }

  async deleteFile(fileId: string, userId: string) {
    const file = await prisma.attachment.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundError('File not found');
    }

    // Only the uploader can delete
    if (file.uploadedBy !== userId) {
      throw new ValidationError('Unauthorized to delete this file');
    }

    await prisma.attachment.delete({
      where: { id: fileId },
    });

    return { success: true };
  }

  private mapPurposeToType(purpose?: string): AttachmentType {
    if (!purpose) return AttachmentType.OTHER;

    const mapping: Record<string, AttachmentType> = {
      LOAD_CARD: AttachmentType.LOAD_PHOTO,
      RECEIVE_CARD: AttachmentType.RECEIVE_PHOTO,
      INVOICE: AttachmentType.INVOICE,
      RECEIPT: AttachmentType.RECEIPT,
    };

    return mapping[purpose] || AttachmentType.OTHER;
  }
}
