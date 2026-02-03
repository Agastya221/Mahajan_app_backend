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
    } catch (error: any) {
      // Clean error for user consumption
      let message = 'Unknown error';
      if (error?.code) message = `Prisma Error ${error.code}: ${error.message.split('\n').pop()}`;
      else if (error instanceof Error) message = error.message;

      return {
        status: 'unhealthy',
        error: message,
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
    } catch (error: any) {
      return {
        status: 'unhealthy',
        error: error.message || 'Redis unreachable',
      };
    }
  }

  private async getSystemMetrics() {
    try {
      // Safe DB stats
      const [activeTrips, totalOrgs, totalUsers] = await Promise.all([
        prisma.trip.count({
          where: { status: { in: [TripStatus.LOADED, TripStatus.IN_TRANSIT] } },
        }).catch(() => -1), // Return -1 if table/query fails
        prisma.org.count().catch(() => -1),
        prisma.user.count().catch(() => -1),
      ]);

      // Get memory usage
      const memoryUsage = process.memoryUsage();

      return {
        activeTrips: activeTrips === -1 ? 'N/A' : activeTrips,
        totalOrgs: totalOrgs === -1 ? 'N/A' : totalOrgs,
        totalUsers: totalUsers === -1 ? 'N/A' : totalUsers,
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
