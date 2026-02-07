import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
import sharp from 'sharp';
import prisma from '../config/database';
import { s3Client } from '../config/s3';
// TODO: Enable CDN when user base grows
// import { getCdnUrl } from '../config/cdn';
import { config } from '../config/env';
import { NotFoundError, ValidationError } from '../utils/errors';
import { PresignedUrlRequestDto, CompressedUploadDto } from './file.dto';
import { AttachmentType } from '@prisma/client';
import { logger } from '../utils/logger';

// Image compression settings
const IMAGE_COMPRESSION_CONFIG = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 80,
  targetSizeKB: 300, // Target ~300KB output
};

// S3 folder path mapping based on file purpose
const S3_FOLDER_MAPPING: Record<string, string> = {
  LOAD_CARD: 'proofs/load',
  RECEIVE_CARD: 'proofs/receive',
  PAYMENT_PROOF: 'proofs/payments',
  INVOICE: 'documents/invoices',
  CHAT_ATTACHMENT: 'chat',
};

const DEFAULT_S3_FOLDER = 'uploads';

/**
 * Get the S3 key prefix (folder path) based on file purpose
 */
function getS3KeyPrefix(purpose?: string): string {
  if (!purpose) return DEFAULT_S3_FOLDER;
  return S3_FOLDER_MAPPING[purpose] || DEFAULT_S3_FOLDER;
}

/**
 * Generate a full S3 key with folder structure and date-based subfolder
 * Format: {folder}/{YYYY}/{MM}/{uuid}.{extension}
 */
function generateS3Key(purpose: string | undefined, fileExtension: string): string {
  const prefix = getS3KeyPrefix(purpose);
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const uniqueId = uuid();

  return `${prefix}/${year}/${month}/${uniqueId}.${fileExtension}`;
}

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

    // Generate unique S3 key with purpose-based folder structure
    const fileExt = data.filename.split('.').pop() || 'unknown';
    const s3Key = generateS3Key(data.purpose, fileExt);

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
        type: this.mapPurposeToType(data.purpose, data.mimeType),
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

    // SECURITY: Verify file actually exists in S3 before marking as COMPLETED
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: s3Key,
      });

      const s3Response = await s3Client.send(headCommand);

      // Optionally verify file size matches (allow 10% tolerance for encoding differences)
      if (file.sizeBytes && s3Response.ContentLength) {
        const expectedSize = file.sizeBytes;
        const actualSize = s3Response.ContentLength;
        const sizeDiff = Math.abs(expectedSize - actualSize);
        const tolerance = expectedSize * 0.1; // 10% tolerance

        if (sizeDiff > tolerance && sizeDiff > 1024) {
          // Only warn if diff > 10% AND > 1KB
          logger.warn('File size mismatch on upload confirmation', {
            fileId,
            expectedSize,
            actualSize,
            diff: sizeDiff,
          });
        }
      }

      // Update with actual size from S3
      const actualSizeBytes = s3Response.ContentLength || file.sizeBytes;

      await prisma.attachment.update({
        where: { id: fileId },
        data: {
          status: 'COMPLETED',
          sizeBytes: actualSizeBytes,
        },
      });

      logger.info('File upload confirmed', { fileId, s3Key, sizeBytes: actualSizeBytes });

      return {
        id: file.id,
        url: file.url,
        filename: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: actualSizeBytes,
      };
    } catch (error: any) {
      // Handle S3 NotFound error specifically
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        logger.warn('Upload confirmation failed - file not found in S3', { fileId, s3Key });
        throw new ValidationError('File not found in S3. Please upload the file and try again.');
      }

      // Re-throw other errors
      logger.error('S3 HeadObject failed during upload confirmation', {
        fileId,
        s3Key,
        error: error.message,
      });
      throw new ValidationError('Failed to verify file upload. Please try again.');
    }
  }

  async generateDownloadUrl(fileId: string, userId: string) {
    const file = await prisma.attachment.findUnique({
      where: { id: fileId },
      include: {
        loadCard: { select: { tripId: true } },
        receiveCard: { select: { tripId: true } },
        invoice: { select: { accountId: true } },
        payment: { select: { accountId: true } },
      },
    });

    if (!file) {
      throw new NotFoundError('File not found');
    }

    // Verify user has access to this file via ownership or related entity membership
    if (file.uploadedBy !== userId) {
      let hasAccess = false;

      // Check via trip (load card or receive card)
      const tripId = file.loadCard?.tripId || file.receiveCard?.tripId;
      if (tripId) {
        const trip = await prisma.trip.findUnique({ where: { id: tripId } });
        if (trip) {
          const membership = await prisma.orgMember.findFirst({
            where: { userId, orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] } },
          });
          if (membership) hasAccess = true;
        }
      }

      // Check via account (invoice or payment)
      const accountId = file.invoice?.accountId || file.payment?.accountId;
      if (!hasAccess && accountId) {
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        if (account) {
          const membership = await prisma.orgMember.findFirst({
            where: { userId, orgId: { in: [account.ownerOrgId, account.counterpartyOrgId] } },
          });
          if (membership) hasAccess = true;
        }
      }

      if (!hasAccess) {
        throw new ValidationError('Not authorized to download this file');
      }
    }

    // TODO: Enable CDN URL logic when user base grows
    // Priority will be: CloudFront signed URL > Public URL (R2) > S3 presigned URL

    // Use S3 presigned URL for downloads (1 hour expiry)
    const command = new GetObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: file.s3Key || undefined,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return {
      downloadUrl,
      filename: file.fileName,
      expiresIn: 3600,
      isPublic: false,
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

    // Delete from S3 first
    if (file.s3Key) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: config.aws.s3Bucket,
          Key: file.s3Key,
        }));
      } catch {
        // Log but don't block deletion if S3 cleanup fails
      }
    }

    await prisma.attachment.delete({
      where: { id: fileId },
    });

    return { success: true };
  }

  private mapPurposeToType(purpose?: string, mimeType?: string): AttachmentType {
    if (!purpose) return AttachmentType.OTHER;

    const mapping: Record<string, AttachmentType> = {
      LOAD_CARD: AttachmentType.LOAD_PHOTO,
      RECEIVE_CARD: AttachmentType.RECEIVE_PHOTO,
      PAYMENT_PROOF: AttachmentType.PAYMENT_PROOF,
      INVOICE: AttachmentType.INVOICE,
      RECEIPT: AttachmentType.RECEIPT,
    };

    if (purpose === 'CHAT_ATTACHMENT') {
      if (mimeType?.startsWith('image/')) return AttachmentType.CHAT_IMAGE;
      return AttachmentType.CHAT_DOCUMENT;
    }

    return mapping[purpose] || AttachmentType.OTHER;
  }

  /**
   * Compress an image buffer using Sharp
   * - Resize to max 1920x1920 (maintains aspect ratio, won't enlarge)
   * - Output as JPEG with quality 80
   * - Target ~300KB output size
   */
  async compressImage(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
    // Only compress images
    if (!mimeType.startsWith('image/')) {
      return { buffer, mimeType };
    }

    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      logger.debug('Image compression started', {
        originalSize: buffer.length,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      });

      // Calculate if resize is needed
      const { maxWidth, maxHeight, quality } = IMAGE_COMPRESSION_CONFIG;
      const needsResize =
        (metadata.width && metadata.width > maxWidth) ||
        (metadata.height && metadata.height > maxHeight);

      let pipeline = image;

      // Resize if needed (maintains aspect ratio, won't enlarge)
      if (needsResize) {
        pipeline = pipeline.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Convert to JPEG with compression
      const compressedBuffer = await pipeline
        .jpeg({
          quality,
          progressive: true,
          mozjpeg: true, // Use mozjpeg for better compression
        })
        .toBuffer();

      const compressionRatio = ((buffer.length - compressedBuffer.length) / buffer.length) * 100;

      logger.info('Image compressed successfully', {
        originalSize: buffer.length,
        compressedSize: compressedBuffer.length,
        compressionRatio: `${compressionRatio.toFixed(1)}%`,
        wasResized: needsResize,
      });

      return {
        buffer: compressedBuffer,
        mimeType: 'image/jpeg',
      };
    } catch (error) {
      logger.error('Image compression failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        mimeType,
      });
      // Return original if compression fails
      return { buffer, mimeType };
    }
  }

  /**
   * Upload a file with server-side compression
   * Accepts multipart form data, compresses images, uploads to S3
   */
  async uploadCompressed(
    data: CompressedUploadDto,
    fileBuffer: Buffer,
    uploadedByUserId: string
  ): Promise<{
    fileId: string;
    url: string;
    filename: string;
    mimeType: string;
    originalSize: number;
    compressedSize: number;
    compressionRatio: string;
  }> {
    // Validate file size (max 10MB for original)
    if (fileBuffer.length > 10 * 1024 * 1024) {
      throw new ValidationError('File size exceeds 10MB limit');
    }

    const originalSize = fileBuffer.length;
    let finalBuffer = fileBuffer;
    let finalMimeType = data.mimeType;

    // Compress if it's an image and compression is not skipped
    if (data.mimeType.startsWith('image/') && !data.skipCompression) {
      const compressed = await this.compressImage(fileBuffer, data.mimeType);
      finalBuffer = compressed.buffer;
      finalMimeType = compressed.mimeType;
    }

    // Generate unique S3 key with purpose-based folder structure
    // Use jpg extension for compressed images
    const fileExt = finalMimeType === 'image/jpeg' ? 'jpg' : data.filename.split('.').pop() || 'unknown';
    const s3Key = generateS3Key(data.purpose, fileExt);

    // Generate S3 URL
    const url = config.aws.s3Endpoint
      ? `${config.aws.s3Endpoint}/${config.aws.s3Bucket}/${s3Key}`
      : `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${s3Key}`;

    // Upload to S3
    const putCommand = new PutObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: s3Key,
      Body: finalBuffer,
      ContentType: finalMimeType,
    });

    await s3Client.send(putCommand);

    // Create file record with COMPLETED status (since we uploaded directly)
    const file = await prisma.attachment.create({
      data: {
        fileName: data.filename,
        s3Key,
        url,
        mimeType: finalMimeType,
        sizeBytes: finalBuffer.length,
        uploadedBy: uploadedByUserId,
        type: this.mapPurposeToType(data.purpose, finalMimeType),
        status: 'COMPLETED',
      },
    });

    const compressionRatio = ((originalSize - finalBuffer.length) / originalSize) * 100;

    logger.info('Compressed file uploaded', {
      fileId: file.id,
      originalSize,
      compressedSize: finalBuffer.length,
      compressionRatio: `${compressionRatio.toFixed(1)}%`,
    });

    return {
      fileId: file.id,
      url,
      filename: data.filename,
      mimeType: finalMimeType,
      originalSize,
      compressedSize: finalBuffer.length,
      compressionRatio: `${compressionRatio.toFixed(1)}%`,
    };
  }
}
