import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config/env';
import { errorHandler } from './middleware/error.middleware';
import { logger } from './utils/logger';

// Import routes
import authRoutes from './auth/auth.routes';
import orgRoutes from './org/org.routes';
import driverRoutes from './drivers/driver.routes';
import truckRoutes from './trucks/truck.routes';
import fileRoutes from './files/file.routes';
import tripRoutes from './trips/trip.routes';
import trackingRoutes from './tracking/tracking.routes';
import ledgerRoutes from './ledger/ledger.routes';
import chatRoutes from './chat/chat.routes';
import itemRoutes from './items/item.routes';
import exportRoutes from './export/export.routes';
import healthRoutes from './health/health.routes';
import mockLocationRoutes from './dev/mock-location.routes';

export function createApp(): Application {
  const app = express();

  // Trust proxy (required when behind load balancer / reverse proxy for correct rate limiting and IP detection)
  app.set('trust proxy', 1);

  // Security middleware
  app.use(helmet());

  // CORS configuration - properly configured for production
  const allowedOrigins = config.cors.origin.split(',').map(o => o.trim());
  app.use(cors({
    origin:"*", // Allow all origins for development; in production, set CORS_ORIGIN to specific domains
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later',
  });
  app.use('/api/', limiter);

  // Auth rate limiting: prevent brute force on token verification
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Max 20 auth requests per IP per 15 minutes
    message: 'Too many authentication requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/v1/auth/verify-widget-token', authLimiter);

  // Refresh token rate limiting
  const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // Max 30 refresh requests per IP per 15 minutes
    message: 'Too many token refresh requests',
  });
  app.use('/api/v1/auth/refresh', refreshLimiter);

  // ✅ CRITICAL FIX: Strict rate limiting for high-volume tracking endpoint
  const trackingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Max 10 batch uploads per minute per IP
    message: 'Too many location updates, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/v1/tracking/ping', trackingLimiter);

  // Body parsing — 1MB is sufficient for JSON payloads (files use presigned S3 URLs)
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request logging (development only)
  if (config.nodeEnv === 'development') {
    app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.path}`);
      next();
    });
  }

  // Health check endpoint (comprehensive)
  app.use('/health', healthRoutes);

  // API routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/orgs', orgRoutes);
  app.use('/api/v1/drivers', driverRoutes);
  app.use('/api/v1/trucks', truckRoutes);
  app.use('/api/v1/files', fileRoutes);
  app.use('/api/v1/trips', tripRoutes);
  app.use('/api/v1/tracking', trackingRoutes);
  app.use('/api/v1/ledger', ledgerRoutes);
  app.use('/api/v1/chat', chatRoutes);
  app.use('/api/v1/items', itemRoutes);
  app.use('/api/v1/exports', exportRoutes);

  // Development-only routes (mock location simulator)
  if (config.nodeEnv === 'development') {
    app.use('/api/dev/mock-location', mockLocationRoutes);
  }

  // 404 handler
  app.use('/{*path}', (req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
    });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
