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
import healthRoutes from './health/health.routes';

export function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: config.cors.origin,
    credentials: true,
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later',
  });
  app.use('/api/', limiter);

  // ✅ SECURITY FIX: Stricter rate limiting for auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Only 5 login attempts per 15 minutes
    skipSuccessfulRequests: true, // Don't count successful logins
    message: 'Too many login attempts, please try again in 15 minutes',
  });
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/refresh', authLimiter);

  // ✅ CRITICAL FIX: Strict rate limiting for high-volume tracking endpoint
  const trackingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Max 10 batch uploads per minute per IP
    message: 'Too many location updates, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/v1/tracking/ping', trackingLimiter);

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
