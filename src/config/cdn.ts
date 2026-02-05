import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { config } from './env';
import { logger } from '../utils/logger';

/**
 * Check if CloudFront is configured
 */
export function isCloudFrontConfigured(): boolean {
  return !!(
    config.cloudfront.domain &&
    config.cloudfront.keyPairId &&
    config.cloudfront.privateKey
  );
}

/**
 * Generate a signed CloudFront URL for secure file access
 *
 * @param s3Key - The S3 object key (e.g., "uploads/abc123.jpg")
 * @param expiresInSeconds - URL validity period (default: 3600 = 1 hour)
 * @returns Signed CloudFront URL
 */
export function generateCloudFrontSignedUrl(s3Key: string, expiresInSeconds: number = 3600): string {
  if (!isCloudFrontConfigured()) {
    throw new Error(
      'CloudFront is not configured. Set CLOUDFRONT_DOMAIN, CLOUDFRONT_KEY_PAIR_ID, and CLOUDFRONT_PRIVATE_KEY.'
    );
  }

  // Decode Base64 private key
  let privateKey: string;
  try {
    privateKey = Buffer.from(config.cloudfront.privateKey, 'base64').toString('utf-8');
  } catch (error) {
    logger.error('Failed to decode CloudFront private key from Base64');
    throw new Error('Invalid CloudFront private key format. Must be Base64 encoded.');
  }

  // Construct the CloudFront URL
  const url = `https://${config.cloudfront.domain}/${s3Key}`;

  // Calculate expiry date
  const expiryDate = new Date(Date.now() + expiresInSeconds * 1000);

  // Generate signed URL
  const signedUrl = getSignedUrl({
    url,
    keyPairId: config.cloudfront.keyPairId,
    privateKey,
    dateLessThan: expiryDate.toISOString(),
  });

  return signedUrl;
}

/**
 * Get the best available CDN/download URL for a file
 * Priority: CloudFront signed URL > Public URL > S3 presigned URL
 *
 * @param s3Key - The S3 object key
 * @param expiresInSeconds - URL validity period
 * @returns Object with URL and metadata
 */
export function getCdnUrl(
  s3Key: string,
  expiresInSeconds: number = 3600
): { url: string; type: 'cloudfront' | 'public' | 's3'; expiresIn: number | null } | null {
  // Option 1: CloudFront signed URL (best for AWS S3 users with CDN)
  if (isCloudFrontConfigured()) {
    try {
      const url = generateCloudFrontSignedUrl(s3Key, expiresInSeconds);
      return {
        url,
        type: 'cloudfront',
        expiresIn: expiresInSeconds,
      };
    } catch (error) {
      logger.warn('CloudFront URL generation failed, falling back', { error });
    }
  }

  // Option 2: Public URL (for R2 public buckets or custom domains)
  if (config.aws.publicUrl) {
    const baseUrl = config.aws.publicUrl.replace(/\/$/, '');
    return {
      url: `${baseUrl}/${s3Key}`,
      type: 'public',
      expiresIn: null, // Public URLs don't expire
    };
  }

  // Return null - caller should fall back to S3 presigned URL
  return null;
}
