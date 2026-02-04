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

    // Check Redis
    try {
      await redisClient.ping();
      logger.info('✅ Redis connected');
    } catch (error) {
      logger.warn('⚠ Redis connection failed. Checking if Docker is up...');
      // Don't exit, but functionality will be limited
    }

    // Create Express app
    const app = createApp();

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize WebSocket (Socket.IO)
    const socketGateway = new SocketGateway(server);
    logger.info('✅ WebSocket gateway initialized');

    // Store socketGateway instance for use in services if needed
    (global as any).socketGateway = socketGateway;

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
