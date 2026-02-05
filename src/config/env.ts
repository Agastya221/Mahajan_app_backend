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
    // JWT_ACCESS_SECRET takes precedence, falls back to JWT_SECRET
    // Both are validated below to ensure at least one is set
    accessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || '',
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
    refreshTokenExpiryDays: parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '30'),
  },

  msg91: {
    authKey: process.env.MSG91_AUTH_KEY!,
    widgetId: process.env.MSG91_WIDGET_ID!,
    tokenAuth: process.env.MSG91_TOKEN_AUTH!, // Token for widget initialization
  },

  aws: {
    region: process.env.AWS_REGION || 'auto', // 'auto' for R2
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    s3Bucket: process.env.AWS_S3_BUCKET!,
    s3Endpoint: process.env.AWS_S3_ENDPOINT, // R2: https://<account_id>.r2.cloudflarestorage.com
    publicUrl: process.env.S3_PUBLIC_URL, // R2 public bucket URL or custom domain for CDN
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
  'MSG91_AUTH_KEY',
  'MSG91_WIDGET_ID',
  'MSG91_TOKEN_AUTH',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_S3_BUCKET',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Validate JWT secret - at least one must be set
if (!process.env.JWT_SECRET && !process.env.JWT_ACCESS_SECRET) {
  throw new Error('Missing required environment variable: JWT_SECRET or JWT_ACCESS_SECRET must be set');
}

// Validate JWT secret strength in production
if (config.nodeEnv === 'production') {
  const jwtSecret = config.jwt.accessSecret;
  if (jwtSecret.length < 32) {
    throw new Error('JWT secret must be at least 32 characters in production');
  }

  // Validate CORS is not wildcard in production
  if (config.cors.origin === '*') {
    throw new Error('CORS origin cannot be "*" in production. Set CORS_ORIGIN to your frontend domain(s).');
  }
}
