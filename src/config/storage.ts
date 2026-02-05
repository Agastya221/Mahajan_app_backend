/**
 * Storage Configuration Summary
 *
 * This module provides a unified view of the storage configuration.
 * The platform supports multiple storage backends:
 *
 * 1. AWS S3 + CloudFront (recommended for production)
 *    - Set: AWS_* variables + CLOUDFRONT_* variables
 *    - Benefits: Global CDN, signed URLs, low latency
 *
 * 2. AWS S3 only (simple setup)
 *    - Set: AWS_* variables only
 *    - Uses S3 presigned URLs for downloads
 *
 * 3. Cloudflare R2 (cost-effective)
 *    - Set: AWS_* variables + AWS_S3_ENDPOINT + S3_PUBLIC_URL
 *    - Benefits: No egress fees, S3-compatible API
 *
 * 4. MinIO (local development)
 *    - Set: AWS_S3_ENDPOINT=http://localhost:9000
 */

import { config } from './env';
import { isCloudFrontConfigured } from './cdn';
import { logger } from '../utils/logger';

export type StorageProvider = 'aws-s3' | 'aws-cloudfront' | 'cloudflare-r2' | 'minio' | 'unknown';

export interface StorageConfig {
  provider: StorageProvider;
  bucket: string;
  region: string;
  endpoint: string | null;
  cdnEnabled: boolean;
  cdnType: 'cloudfront' | 'r2-public' | 'none';
  publicUrl: string | null;
}

/**
 * Detect the current storage provider based on environment configuration
 */
export function detectStorageProvider(): StorageProvider {
  const { s3Endpoint, region } = config.aws;

  // Check for MinIO (localhost endpoint)
  if (s3Endpoint?.includes('localhost') || s3Endpoint?.includes('127.0.0.1')) {
    return 'minio';
  }

  // Check for Cloudflare R2 (r2.cloudflarestorage.com endpoint)
  if (s3Endpoint?.includes('r2.cloudflarestorage.com')) {
    return 'cloudflare-r2';
  }

  // Check for AWS S3 with CloudFront
  if (isCloudFrontConfigured()) {
    return 'aws-cloudfront';
  }

  // Check for plain AWS S3
  if (region && region !== 'auto' && !s3Endpoint) {
    return 'aws-s3';
  }

  return 'unknown';
}

/**
 * Get the current storage configuration
 */
export function getStorageConfig(): StorageConfig {
  const provider = detectStorageProvider();

  let cdnType: 'cloudfront' | 'r2-public' | 'none' = 'none';

  if (isCloudFrontConfigured()) {
    cdnType = 'cloudfront';
  } else if (config.aws.publicUrl) {
    cdnType = 'r2-public';
  }

  return {
    provider,
    bucket: config.aws.s3Bucket,
    region: config.aws.region,
    endpoint: config.aws.s3Endpoint || null,
    cdnEnabled: cdnType !== 'none',
    cdnType,
    publicUrl: config.aws.publicUrl || null,
  };
}

/**
 * Log storage configuration on startup (for debugging)
 */
export function logStorageConfig(): void {
  const cfg = getStorageConfig();

  logger.info('📦 Storage Configuration:', {
    provider: cfg.provider,
    bucket: cfg.bucket,
    region: cfg.region,
    cdn: cfg.cdnEnabled ? cfg.cdnType : 'disabled',
    endpoint: cfg.endpoint || 'default',
    publicUrl: cfg.publicUrl || 'none',
  });
}
