import { S3Client } from '@aws-sdk/client-s3';
import { config } from './env';

// S3-compatible client works with AWS S3 and MinIO (local dev)
export const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
  endpoint: config.aws.s3Endpoint, // MinIO: http://localhost:9000
  forcePathStyle: true, // Required for MinIO
});

// TODO: Enable when adding R2/CDN support
// export function getPublicUrl(key: string): string | null {
//   if (config.aws.publicUrl) {
//     const baseUrl = config.aws.publicUrl.replace(/\/$/, '');
//     return `${baseUrl}/${key}`;
//   }
//   return null;
// }

export default s3Client;
