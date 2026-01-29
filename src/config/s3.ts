import { S3Client } from '@aws-sdk/client-s3';
import { config } from './env';

export const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
  endpoint: config.aws.s3Endpoint, // For MinIO local development
  forcePathStyle: true, // Required for MinIO
});

export default s3Client;
