# Task: Implement CloudFront CDN Signed URL Support

## Context

The Mahajan Network Platform already has:
- S3/R2 file upload working with presigned URLs
- HeadObject verification on upload confirmation
- Server-side image compression with Sharp
- Public URL support via `S3_PUBLIC_URL` env var
- File cleanup job for stale uploads

**What's Missing:** CloudFront signed URL generation for users who want to use AWS S3 + CloudFront CDN instead of Cloudflare R2.

## Current File Locations

```
src/config/env.ts          - Environment configuration
src/config/s3.ts           - S3 client configuration
src/files/file.service.ts  - File upload/download service
```

## Implementation Steps

---

### Step 1: Install CloudFront Signer Package

Run this command:

```bash
npm install @aws-sdk/cloudfront-signer
```

This package provides `getSignedUrl` function for CloudFront signed URLs.

---

### Step 2: Update `src/config/env.ts`

Add CloudFront configuration to the `config` object.

**Find this section:**
```typescript
aws: {
  region: process.env.AWS_REGION || 'auto',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  s3Bucket: process.env.AWS_S3_BUCKET!,
  s3Endpoint: process.env.AWS_S3_ENDPOINT,
  publicUrl: process.env.S3_PUBLIC_URL,
},
```

**Replace with:**
```typescript
aws: {
  region: process.env.AWS_REGION || 'auto',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  s3Bucket: process.env.AWS_S3_BUCKET!,
  s3Endpoint: process.env.AWS_S3_ENDPOINT,
  publicUrl: process.env.S3_PUBLIC_URL,
},

cloudfront: {
  domain: process.env.CLOUDFRONT_DOMAIN || '',           // e.g., d1234abcd.cloudfront.net
  keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID || '',   // e.g., K2JCJMDEHXQW5F
  privateKey: process.env.CLOUDFRONT_PRIVATE_KEY || '',  // Base64 encoded PEM private key
},
```

---

### Step 3: Create `src/config/cdn.ts` (NEW FILE)

Create a new file with CloudFront URL generation logic:

```typescript
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
export function generateCloudFrontSignedUrl(
  s3Key: string,
  expiresInSeconds: number = 3600
): string {
  if (!isCloudFrontConfigured()) {
    throw new Error('CloudFront is not configured. Set CLOUDFRONT_DOMAIN, CLOUDFRONT_KEY_PAIR_ID, and CLOUDFRONT_PRIVATE_KEY.');
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
```

---

### Step 4: Update `src/files/file.service.ts`

Modify the `generateDownloadUrl` method to use CloudFront when configured.

**Add import at top of file:**
```typescript
import { getCdnUrl } from '../config/cdn';
```

**Find the `generateDownloadUrl` method and replace the download URL generation logic.**

**Find this code block:**
```typescript
// Try to use public CDN URL first (R2 public bucket or custom domain)
// This avoids egress fees and provides faster delivery
const publicUrl = file.s3Key ? getPublicUrl(file.s3Key) : null;
if (publicUrl) {
  return {
    downloadUrl: publicUrl,
    filename: file.fileName,
    expiresIn: null, // Public URL doesn't expire
    isPublic: true,
  };
}

// Fall back to presigned URL if no public URL configured
const command = new GetObjectCommand({
  Bucket: config.aws.s3Bucket,
  Key: file.s3Key || undefined,
});

const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

return {
  downloadUrl,
  filename: file.fileName,
  expiresIn: 3600, // seconds
  isPublic: false,
};
```

**Replace with:**
```typescript
// Try CDN URL first (CloudFront > Public URL)
// This provides better performance and lower egress costs
if (file.s3Key) {
  const cdnResult = getCdnUrl(file.s3Key, 3600);
  
  if (cdnResult) {
    return {
      downloadUrl: cdnResult.url,
      filename: file.fileName,
      expiresIn: cdnResult.expiresIn,
      isPublic: cdnResult.type === 'public',
      cdnType: cdnResult.type,
    };
  }
}

// Fall back to S3 presigned URL if no CDN configured
const command = new GetObjectCommand({
  Bucket: config.aws.s3Bucket,
  Key: file.s3Key || undefined,
});

const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

return {
  downloadUrl,
  filename: file.fileName,
  expiresIn: 3600, // seconds
  isPublic: false,
  cdnType: 's3',
};
```

---

### Step 5: Update `.env.example`

Add the new CloudFront environment variables to `.env.example`:

```env
# ===========================================
# STORAGE CONFIGURATION
# ===========================================

# AWS S3 / Cloudflare R2 Configuration
AWS_REGION=ap-south-1                    # Use 'auto' for R2
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=mahajan-logistics

# For Cloudflare R2 (optional - leave empty for AWS S3)
AWS_S3_ENDPOINT=                         # e.g., https://account_id.r2.cloudflarestorage.com

# Public CDN URL for R2 public buckets (optional)
S3_PUBLIC_URL=                           # e.g., https://pub-xxx.r2.dev

# ===========================================
# CLOUDFRONT CDN (for AWS S3 users)
# ===========================================
# Leave all three empty to disable CloudFront and use S3 presigned URLs

CLOUDFRONT_DOMAIN=                       # e.g., d1234abcd.cloudfront.net
CLOUDFRONT_KEY_PAIR_ID=                  # e.g., K2JCJMDEHXQW5F
CLOUDFRONT_PRIVATE_KEY=                  # Base64 encoded PEM private key

# To encode your private key:
# cat private_key.pem | base64 -w 0 > private_key_base64.txt
```

---

### Step 6: Create `src/config/storage.ts` (NEW FILE - Unified Interface)

Create a unified storage configuration file:

```typescript
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
  
  console.log('📦 Storage Configuration:');
  console.log(`   Provider: ${cfg.provider}`);
  console.log(`   Bucket: ${cfg.bucket}`);
  console.log(`   Region: ${cfg.region}`);
  console.log(`   CDN: ${cfg.cdnEnabled ? cfg.cdnType : 'disabled'}`);
  
  if (cfg.endpoint) {
    console.log(`   Endpoint: ${cfg.endpoint}`);
  }
  if (cfg.publicUrl) {
    console.log(`   Public URL: ${cfg.publicUrl}`);
  }
}
```

---

### Step 7: Update `src/index.ts` to Log Storage Config

Add storage config logging on server startup.

**Add import:**
```typescript
import { logStorageConfig } from './config/storage';
```

**Add after the WebSocket initialization log:**
```typescript
// Log storage configuration
logStorageConfig();
```

---

## File Structure After Changes

```
src/config/
├── env.ts              ✏️  (add cloudfront config)
├── s3.ts               (no changes needed)
├── cdn.ts              🆕  (CloudFront signed URL generation)
└── storage.ts          🆕  (unified storage interface)

src/files/
├── file.service.ts     ✏️  (use getCdnUrl for downloads)
└── ... (other files unchanged)

.env.example            ✏️  (add CloudFront variables)
```

---

## Testing Checklist

After implementation, verify:

### Without CloudFront (existing behavior):
- [ ] R2 public URL works if `S3_PUBLIC_URL` is set
- [ ] S3 presigned URL works if no CDN configured
- [ ] File upload → confirm → download flow works

### With CloudFront:
- [ ] Set all three CLOUDFRONT_* env vars
- [ ] Download URL returns CloudFront signed URL
- [ ] URL is accessible and serves the file
- [ ] URL expires after 1 hour

### Edge cases:
- [ ] Invalid Base64 private key → clear error message
- [ ] Missing one CloudFront var → falls back to S3 presigned
- [ ] Server startup logs correct storage provider

---

## How to Encode CloudFront Private Key

When setting up CloudFront, you'll have a `.pem` private key file. Encode it to Base64:

```bash
# On Linux/Mac:
cat private_key.pem | base64 -w 0

# On Windows (PowerShell):
[Convert]::ToBase64String([IO.File]::ReadAllBytes("private_key.pem"))
```

Copy the output (single line, no line breaks) to `CLOUDFRONT_PRIVATE_KEY` env var.

---

## Priority

1. Install package (`npm install @aws-sdk/cloudfront-signer`)
2. Create `src/config/cdn.ts`
3. Update `src/config/env.ts`
4. Update `src/files/file.service.ts`
5. Create `src/config/storage.ts`
6. Update `.env.example`
7. Update `src/index.ts` (optional - for logging)

Start with steps 1-4 which are required. Steps 5-7 are nice-to-have for better DX.
