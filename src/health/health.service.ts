import prisma from '../config/database';
import { redisClient } from '../config/redis';
import { TripStatus } from '@prisma/client';

export class HealthService {
  async checkHealth() {
    const checks = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      system: await this.getSystemMetrics(),
    };

    const isHealthy = checks.database.status === 'healthy' && checks.redis.status === 'healthy';

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabase() {
    try {
      const start = Date.now();

      // Simple query to check connectivity
      await prisma.$queryRaw`SELECT 1`;

      const latency = Date.now() - start;

      return {
        status: 'healthy',
        latency: `${latency}ms`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async checkRedis() {
    try {
      const start = Date.now();

      // Ping Redis
      await redisClient.ping();

      const latency = Date.now() - start;

      return {
        status: 'healthy',
        latency: `${latency}ms`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async getSystemMetrics() {
    try {
      // Count active trips
      const activeTrips = await prisma.trip.count({
        where: {
          status: {
            in: [TripStatus.LOADED, TripStatus.IN_TRANSIT],
          },
        },
      });

      // Count total organizations
      const totalOrgs = await prisma.org.count();

      // Count total users
      const totalUsers = await prisma.user.count();

      // Get memory usage
      const memoryUsage = process.memoryUsage();

      return {
        activeTrips,
        totalOrgs,
        totalUsers,
        memory: {
          heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
          rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        },
        uptime: `${Math.round(process.uptime())}s`,
        nodeVersion: process.version,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to get metrics',
      };
    }
  }
}
