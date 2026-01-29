import http from 'http';
import { createApp } from './app';
import { config } from './config/env';
import { logger } from './utils/logger';
import prisma from './config/database';
import { redisClient } from './config/redis';

// Import WebSocket gateway
import { SocketGateway } from './websocket/socket.gateway';

// Import notification worker
import './notifications/notification.worker';

async function startServer() {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Test Redis connection
    await redisClient.ping();
    logger.info('✅ Redis connected');

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
