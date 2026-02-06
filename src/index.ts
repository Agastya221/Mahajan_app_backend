import http from 'http';
import { createApp } from './app';
import { config } from './config/env';
import { logger } from './utils/logger';
import prisma from './config/database';
import { redisClient } from './config/redis';

// Fix BigInt serialization for JSON.stringify (used by Express res.json())
// Prisma returns BigInt for balance fields, which JSON.stringify can't handle
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Import WebSocket gateway
import { SocketGateway } from './websocket/socket.gateway';

// Import notification worker
import './notifications/notification.worker';

// Import file cleanup worker
import { scheduleFileCleanup } from './files/file.cleanup';

// TODO: Enable storage config logger when adding CDN/R2 support
// import { logStorageConfig } from './config/storage';

// Retry Redis connection
const connectRedisWithRetry = async (retries = 3, delay = 1000): Promise<boolean> => {
  logger.info('🔌 Connecting to Redis...');

  for (let i = 0; i < retries; i++) {
    try {
      await redisClient.ping();
      logger.info('✅ Redis connected successfully');
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`⚠ Redis connection failed (attempt ${i + 1}/${retries}): ${errorMsg}`);
      if (i < retries - 1) {
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  return false;
};

// Retry database connection
const connectWithRetry = async (retries = 5, delay = 2000) => {
  const dbUrl = process.env.DATABASE_URL || '';
  const dbHost = dbUrl.includes('@') ? dbUrl.split('@')[1]?.split('/')[0] : 'unknown';

  logger.info(`🔌 Connecting to database at: ${dbHost}`);

  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$connect();
      logger.info('✅ Database connected successfully');
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`⚠ Database connection failed (attempt ${i + 1}/${retries}): ${errorMsg}`);
      if (i < retries - 1) {
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  return false;
};

async function startServer() {
  try {
    if (!(await connectWithRetry())) {
      logger.error('❌ CRITICAL: Could not connect to Database after multiple attempts.');
      logger.error('👉 ACTION REQUIRED: Please ensure Docker Desktop is running and execute: npm run docker:up');
      process.exit(1);
    }

    // Check Redis - REQUIRED for production (token blacklisting, caching)
    const redisConnected = await connectRedisWithRetry();
    if (!redisConnected) {
      if (config.nodeEnv === 'production') {
        logger.error('❌ CRITICAL: Redis is required in production for token blacklisting and caching.');
        logger.error('👉 ACTION REQUIRED: Please ensure Redis is running.');
        process.exit(1);
      } else {
        logger.warn('⚠️ WARNING: Redis is not connected. Token blacklisting will not work.');
        logger.warn('⚠️ This is acceptable for development, but MUST be fixed for production.');
      }
    }

    // Create Express app
    const app = createApp();

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize WebSocket (Socket.IO)
    const socketGateway = new SocketGateway(server);
    logger.info('✅ WebSocket gateway initialized');

    // TODO: Enable when adding CDN/R2 support
    // logStorageConfig();

    // Store socketGateway instance for use in services if needed
    (global as any).socketGateway = socketGateway;

    // Schedule file cleanup job (runs hourly to clean stale uploads)
    if (redisConnected) {
      await scheduleFileCleanup();
    }

    // Start server
    server.listen(config.port, () => {
      logger.info(`🚀 Server running on port ${config.port}`);
      logger.info(`📡 Environment: ${config.nodeEnv}`);
      logger.info(`🔗 Health check: http://localhost:${config.port}/health`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          await prisma.$disconnect();
          logger.info('Database disconnected');

          await redisClient.quit();
          logger.info('Redis disconnected');

          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown:', error);
          process.exit(1);
        }
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
