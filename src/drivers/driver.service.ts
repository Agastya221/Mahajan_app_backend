import prisma from '../config/database';
import { redisClient } from '../config/redis';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/errors';
import { CreateDriverDto, UpdateDriverDto } from './driver.dto';
import { UserRole, Prisma } from '@prisma/client';

export class DriverService {
  async createDriver(data: CreateDriverDto, createdBy: string) {
    // Verify user exists and is a driver
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.role !== UserRole.DRIVER) {
      throw new ForbiddenError('User must have DRIVER role');
    }

    // Check if driver profile already exists
    const existing = await prisma.driverProfile.findUnique({
      where: { userId: data.userId },
    });

    if (existing) {
      throw new ConflictError('Driver profile already exists for this user');
    }

    // If deviceId provided, check if it's unique
    if (data.deviceId) {
      const existingDevice = await prisma.driverProfile.findUnique({
        where: { deviceId: data.deviceId },
      });

      if (existingDevice) {
        throw new ConflictError('Device ID already in use');
      }
    }

    // Create driver profile (no org binding — drivers are independent)
    const driver = await prisma.driverProfile.create({
      data: {
        userId: data.userId,
        licenseNo: data.licenseNo,
        emergencyPhone: data.emergencyPhone,
        notes: data.notes,
        deviceId: data.deviceId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            role: true,
          },
        },
      },
    });

    // Invalidate driver list cache
    // Wildcard invalidation isn't natively supported for simple keys, 
    // so we just clear the most common full list.
    await redisClient.del('drivers:list:all:1:20');

    return driver;
  }

  async getDrivers(filters: { phone?: string; page?: number; limit?: number }) {
    const { phone, page = 1, limit = 20 } = filters;
    const safeLimit = Math.min(limit, 100);

    const cacheKey = `drivers:list:${phone || 'all'}:${page}:${safeLimit}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const where: Prisma.DriverProfileWhereInput = {};

    // Search by phone number
    if (phone) {
      where.user = {
        phone: { contains: phone },
      };
    }

    const [drivers, total] = await Promise.all([
      prisma.driverProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.driverProfile.count({ where }),
    ]);

    const result = {
      drivers,
      pagination: { page, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    };

    // Cache for 30 minutes
    await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 1800);

    return result;
  }

  async getDriverById(driverId: string) {
    const cacheKey = `driver:${driverId}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            role: true,
          },
        },
        trips: {
          where: {
            status: {
              in: ['CREATED', 'ASSIGNED', 'LOADED', 'IN_TRANSIT'],
            },
          },
          select: {
            id: true,
            status: true,
            startPoint: true,
            endPoint: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!driver) {
      throw new NotFoundError('Driver not found');
    }

    // Cache specific driver - 1 hour
    await redisClient.set(cacheKey, JSON.stringify(driver), 'EX', 3600);

    return driver;
  }

  async findDriverByPhone(phone: string) {
    const user = await prisma.user.findUnique({
      where: { phone },
      include: {
        driverProfile: true,
      },
    });

    if (!user) return null;
    if (user.role !== UserRole.DRIVER) return null;

    return user.driverProfile;
  }

  /**
   * Search driver by phone — used by trip creation screen
   * Returns structured response for frontend to decide next step
   */
  async searchDriverByPhone(phone: string) {
    // Search by exact match or partial match
    const user = await prisma.user.findFirst({
      where: {
        phone: { contains: phone },
        role: UserRole.DRIVER,
      },
      include: {
        driverProfile: true,
      },
    });

    if (!user || !user.driverProfile) {
      return {
        found: false,
        message: 'No registered driver found with this phone number. You can still create the trip — driver will be added as a guest.',
      };
    }

    return {
      found: true,
      driver: {
        id: user.driverProfile.id,
        userId: user.id,
        name: user.name,
        phone: user.phone,
        licenseNo: user.driverProfile.licenseNo,
        emergencyPhone: user.driverProfile.emergencyPhone,
        altPhone: user.driverProfile.altPhone,
        deviceId: user.driverProfile.deviceId,
      },
    };
  }

  async updateDriver(driverId: string, data: UpdateDriverDto) {
    // Check if deviceId is being updated and is unique
    if (data.deviceId) {
      const existingDevice = await prisma.driverProfile.findFirst({
        where: {
          deviceId: data.deviceId,
          id: { not: driverId },
        },
      });

      if (existingDevice) {
        throw new ConflictError('Device ID already in use');
      }
    }

    const driver = await prisma.driverProfile.update({
      where: { id: driverId },
      data,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    });

    // Invalidate caches
    await redisClient.del(`driver:${driverId}`);
    // We can't easily query all list keys, so we might let them expire naturally or use a pattern delete if we had a helper.
    // For now, let's just accept 30 min staleness on lists or implement a 'version' key strategy if critical.
    // Simpler: just clear the main list key if no filters
    await redisClient.del('drivers:list:all:1:20');

    return driver;
  }

  async deleteDriver(driverId: string) {
    // Check if driver has active trips
    const activeTrips = await prisma.trip.count({
      where: {
        driverId,
        status: {
          in: ['CREATED', 'ASSIGNED', 'LOADED', 'IN_TRANSIT'],
        },
      },
    });

    if (activeTrips > 0) {
      throw new ForbiddenError('Cannot delete driver with active trips');
    }

    await prisma.driverProfile.delete({
      where: { id: driverId },
    });

    // Invalidate caches
    await redisClient.del(`driver:${driverId}`);
    await redisClient.del('drivers:list:all:1:20');

    return { success: true };
  }
}
