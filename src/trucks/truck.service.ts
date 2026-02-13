import prisma from '../config/database';
import { redisClient } from '../config/redis';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/errors';
import { CreateTruckDto, UpdateTruckDto } from './truck.dto';

export class TruckService {
  async createTruck(data: CreateTruckDto, createdBy: string) {
    // Verify user is member of the organization
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId: data.orgId,
          userId: createdBy,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('Not a member of this organization');
    }

    // Check if truck number already exists (truck numbers are globally unique)
    const existing = await prisma.truck.findUnique({
      where: { number: data.number },
    });

    if (existing) {
      throw new ConflictError('Truck with this number already exists');
    }

    const truck = await prisma.truck.create({
      data,
      include: {
        org: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Invalidate list caches
    await redisClient.del(`trucks:list:${data.orgId}:1:20`); // Clear first page default
    // Ideally clear all pages, but pattern delete is complex. TTL will handle others.

    return truck;
  }

  async getTrucks(orgId?: string, page = 1, limit = 20) {
    const safeLimit = Math.min(limit, 100);
    const where = orgId ? { orgId } : {};

    const cacheKey = `trucks:list:${orgId || 'all'}:${page}:${safeLimit}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const [trucks, total] = await Promise.all([
      prisma.truck.findMany({
        where,
        include: {
          org: {
            select: {
              id: true,
              name: true,
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
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.truck.count({ where }),
    ]);

    const result = {
      trucks: trucks.map((truck) => ({
        ...truck,
        isActive: truck.trips.length > 0,
        activeTripsCount: truck.trips.length,
      })),
      pagination: { page, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
    };

    // Cache list for 30 minutes
    await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 1800);

    return result;
  }

  async getTruckById(truckId: string) {
    const cacheKey = `truck:${truckId}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const truck = await prisma.truck.findUnique({
      where: { id: truckId },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
        trips: {
          select: {
            id: true,
            status: true,
            startPoint: true,
            endPoint: true,
            createdAt: true,
            driver: {
              select: {
                id: true,
                user: {
                  select: {
                    name: true,
                    phone: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
        },
      },
    });

    if (!truck) {
      throw new NotFoundError('Truck not found');
    }

    // Cache detail - 1 hour
    await redisClient.set(cacheKey, JSON.stringify(truck), 'EX', 3600);

    return truck;
  }

  async updateTruck(truckId: string, data: UpdateTruckDto, userId: string) {
    const truck = await prisma.truck.findUnique({
      where: { id: truckId },
    });

    if (!truck) {
      throw new NotFoundError('Truck not found');
    }

    // Verify user is member of the organization
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId: truck.orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('Not a member of this organization');
    }

    // If updating number, check uniqueness (truck numbers are globally unique)
    if (data.number) {
      const existing = await prisma.truck.findFirst({
        where: {
          number: data.number,
          id: { not: truckId },
        },
      });

      if (existing) {
        throw new ConflictError('Truck with this number already exists');
      }
    }

    const updated = await prisma.truck.update({
      where: { id: truckId },
      data,
      include: {
        org: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Invalidate caches
    await redisClient.del(`truck:${truckId}`);
    await redisClient.del(`trucks:list:${updated.orgId}:1:20`);

    return updated;
  }

  async deleteTruck(truckId: string, userId: string) {
    const truck = await prisma.truck.findUnique({
      where: { id: truckId },
    });

    if (!truck) {
      throw new NotFoundError('Truck not found');
    }

    // Verify user is member of the organization
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId: truck.orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('Not a member of this organization');
    }

    // Check if truck has active trips
    const activeTrips = await prisma.trip.count({
      where: {
        truckId,
        status: {
          in: ['CREATED', 'ASSIGNED', 'LOADED', 'IN_TRANSIT'],
        },
      },
    });

    if (activeTrips > 0) {
      throw new ForbiddenError('Cannot delete truck with active trips');
    }

    await prisma.truck.delete({
      where: { id: truckId },
    });

    // Invalidate caches
    await redisClient.del(`truck:${truckId}`);
    await redisClient.del(`trucks:list:${truck.orgId}:1:20`);

    return { success: true };
  }
}
