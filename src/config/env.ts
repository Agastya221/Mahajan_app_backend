import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL!,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    // ✅ SECURITY FIX: Separate secrets for access and refresh tokens
    accessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET!,
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!,
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    s3Bucket: process.env.AWS_S3_BUCKET!,
    s3Endpoint: process.env.AWS_S3_ENDPOINT,
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  },

  fileUpload: {
    maxSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB
  },
};

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET', // Can use single secret, but JWT_ACCESS_SECRET + JWT_REFRESH_SECRET recommended
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_S3_BUCKET',
];

// Warn if using same secret for both
if (process.env.JWT_SECRET && (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)) {
  console.warn('⚠️  SECURITY WARNING: Using same JWT_SECRET for both access and refresh tokens. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET for better security.');
}

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}
