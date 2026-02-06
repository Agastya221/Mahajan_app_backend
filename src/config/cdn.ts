/**
 * CloudFront CDN URL Generation
 *
 * TODO: Uncomment and enable when user base grows and CloudFront CDN is needed.
 * This module provides signed URL generation for CloudFront distributions.
 *
 * To enable:
 * 1. Add cloudfront config back to env.ts
 * 2. Add publicUrl back to aws config in env.ts
 * 3. Set CLOUDFRONT_DOMAIN, CLOUDFRONT_KEY_PAIR_ID, CLOUDFRONT_PRIVATE_KEY env vars
 * 4. Uncomment the code below
 * 5. Import getCdnUrl in file.service.ts
 */

// import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
// import { config } from './env';
// import { logger } from '../utils/logger';
//
// export function isCloudFrontConfigured(): boolean {
//   return !!(
//     config.cloudfront.domain &&
//     config.cloudfront.keyPairId &&
//     config.cloudfront.privateKey
//   );
// }
//
// export function generateCloudFrontSignedUrl(s3Key: string, expiresInSeconds: number = 3600): string {
//   if (!isCloudFrontConfigured()) {
//     throw new Error(
//       'CloudFront is not configured. Set CLOUDFRONT_DOMAIN, CLOUDFRONT_KEY_PAIR_ID, and CLOUDFRONT_PRIVATE_KEY.'
//     );
//   }
//
//   let privateKey: string;
//   try {
//     privateKey = Buffer.from(config.cloudfront.privateKey, 'base64').toString('utf-8');
//   } catch (error) {
//     logger.error('Failed to decode CloudFront private key from Base64');
//     throw new Error('Invalid CloudFront private key format. Must be Base64 encoded.');
//   }
//
//   const url = `https://${config.cloudfront.domain}/${s3Key}`;
//   const expiryDate = new Date(Date.now() + expiresInSeconds * 1000);
//
//   const signedUrl = getSignedUrl({
//     url,
//     keyPairId: config.cloudfront.keyPairId,
//     privateKey,
//     dateLessThan: expiryDate.toISOString(),
//   });
//
//   return signedUrl;
// }
//
// export function getCdnUrl(
//   s3Key: string,
//   expiresInSeconds: number = 3600
// ): { url: string; type: 'cloudfront' | 'public' | 's3'; expiresIn: number | null } | null {
//   if (isCloudFrontConfigured()) {
//     try {
//       const url = generateCloudFrontSignedUrl(s3Key, expiresInSeconds);
//       return { url, type: 'cloudfront', expiresIn: expiresInSeconds };
//     } catch (error) {
//       logger.warn('CloudFront URL generation failed, falling back', { error });
//     }
//   }
//
//   if (config.aws.publicUrl) {
//     const baseUrl = config.aws.publicUrl.replace(/\/$/, '');
//     return { url: `${baseUrl}/${s3Key}`, type: 'public', expiresIn: null };
//   }
//
//   return null;
// }
