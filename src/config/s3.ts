import { S3Client } from '@aws-sdk/client-s3';
import { config } from './env';

// S3-compatible client works with AWS S3, Cloudflare R2, and MinIO
export const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
  endpoint: config.aws.s3Endpoint, // R2: https://<account_id>.r2.cloudflarestorage.com | MinIO: http://localhost:9000
  forcePathStyle: true, // Required for MinIO and R2
});

/**
 * Get public CDN URL for a file
 * Uses S3_PUBLIC_URL if configured (R2 public bucket or custom domain)
 * Falls back to presigned URL generation if not set
 */
export function getPublicUrl(key: string): string | null {
  if (config.aws.publicUrl) {
    // Remove trailing slash if present
    const baseUrl = config.aws.publicUrl.replace(/\/$/, '');
    return `${baseUrl}/${key}`;
  }
  return null;
}

export default s3Client;
