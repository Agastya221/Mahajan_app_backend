import prisma from '../config/database';
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

    // Check if truck number already exists for this org
    const existing = await prisma.truck.findUnique({
      where: {
        orgId_number: {
          orgId: data.orgId,
          number: data.number,
        },
      },
    });

    if (existing) {
      throw new ConflictError('Truck with this number already exists in organization');
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

    return truck;
  }

  async getTrucks(orgId?: string) {
    const where = orgId ? { orgId } : {};

    const trucks = await prisma.truck.findMany({
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
    });

    return trucks.map((truck) => ({
      ...truck,
      isActive: truck.trips.length > 0,
      activeTripsCount: truck.trips.length,
    }));
  }

  async getTruckById(truckId: string) {
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

    // If updating number, check uniqueness
    if (data.number) {
      const existing = await prisma.truck.findFirst({
        where: {
          orgId: truck.orgId,
          number: data.number,
          id: { not: truckId },
        },
      });

      if (existing) {
        throw new ConflictError('Truck with this number already exists in organization');
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

    return { success: true };
  }
}
