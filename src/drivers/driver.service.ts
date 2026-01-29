import prisma from '../config/database';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/errors';
import { CreateDriverDto, UpdateDriverDto } from './driver.dto';
import { UserRole } from '@prisma/client';

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

    // Create driver profile
    const driver = await prisma.driverProfile.create({
      data: {
        userId: data.userId,
        orgId: data.orgId,
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
        org: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return driver;
  }

  async getDrivers(orgId?: string) {
    const where = orgId ? { orgId } : {};

    const drivers = await prisma.driverProfile.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        org: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return drivers;
  }

  async getDriverById(driverId: string) {
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
        org: {
          select: {
            id: true,
            name: true,
            city: true,
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

    return driver;
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

    return { success: true };
  }
}
