import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors';
import { CreateTripDto, UpdateTripStatusDto, CreateLoadCardDto, CreateReceiveCardDto } from './trip.dto';
import { TripStatus, TripEventType, QuantityUnit, Prisma } from '@prisma/client';
import { ChatService } from '../chat/chat.service';
import { logger } from '../utils/logger';

export class TripService {
  async createTrip(data: CreateTripDto, createdBy: string) {
    // Validate user is member of the source organization
    const sourceMembership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: {
          orgId: data.sourceOrgId,
          userId: createdBy,
        },
      },
    });

    if (!sourceMembership) {
      throw new ForbiddenError('Not a member of the source organization');
    }

    // Validate source and destination are different
    if (data.sourceOrgId === data.destinationOrgId) {
      throw new ValidationError('Source and destination organizations must be different');
    }

    // Validate truck belongs to source org
    const truck = await prisma.truck.findUnique({
      where: { id: data.truckId },
    });

    if (!truck) {
      throw new NotFoundError('Truck not found');
    }

    if (truck.orgId !== data.sourceOrgId) {
      throw new ValidationError('Truck does not belong to source organization');
    }

    // Validate driver
    const driver = await prisma.driverProfile.findUnique({
      where: { id: data.driverId },
    });

    if (!driver) {
      throw new NotFoundError('Driver not found');
    }

    if (driver.orgId !== data.sourceOrgId) {
      throw new ValidationError('Driver does not belong to source organization');
    }

    // ✅ RACE CONDITION FIX: Use SELECT FOR UPDATE to actually lock rows and prevent concurrent assignments
    // Create trip + first event in transaction
    const trip = await prisma.$transaction(async (tx) => {
      // Check if driver or truck has active trips with row-level locking (FOR UPDATE)
      const activeTrips = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Trip"
        WHERE (
          "driverId" = ${data.driverId}
          OR "truckId" = ${data.truckId}
        )
        AND "status" IN ('CREATED', 'LOADED', 'IN_TRANSIT')
        FOR UPDATE
      `;

      if (activeTrips.length > 0) {
        throw new ConflictError('Driver or truck already has an active trip');
      }

      const newTrip = await tx.trip.create({
        data: {
          sourceOrgId: data.sourceOrgId,
          destinationOrgId: data.destinationOrgId,
          truckId: data.truckId,
          driverId: data.driverId,
          startPoint: data.startPoint,
          endPoint: data.endPoint,
          estimatedDistance: data.estimatedDistance,
          estimatedArrival: data.estimatedArrival ? new Date(data.estimatedArrival) : null,
          status: TripStatus.CREATED,
          notes: data.notes,
        },
        include: {
          sourceOrg: {
            select: {
              id: true,
              name: true,
              gstin: true,
            },
          },
          destinationOrg: {
            select: {
              id: true,
              name: true,
              gstin: true,
            },
          },
          truck: true,
          driver: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                },
              },
            },
          },
        },
      });

      await tx.tripEvent.create({
        data: {
          tripId: newTrip.id,
          eventType: TripEventType.TRIP_CREATED,
          description: `Trip created from ${data.startPoint} to ${data.endPoint}`,
        },
      });

      return newTrip;
    });

    // TODO: Broadcast via WebSocket
    // TODO: Queue notification to destination org

    return trip;
  }

  async getTrips(filters: {
    orgId?: string;
    status?: TripStatus;
    userId?: string;
  }) {
    const { orgId, status, userId } = filters;

    // ✅ CRITICAL FIX: Verify user has access to requested org
    if (orgId && userId) {
      const hasAccess = await prisma.orgMember.findFirst({
        where: {
          userId,
          orgId,
        },
      });

      if (!hasAccess) {
        throw new ForbiddenError('Not authorized to view trips for this organization');
      }
    }

    // ✅ TYPE SAFETY FIX: Use proper Prisma types instead of any
    const where: Prisma.TripWhereInput = {};

    if (orgId) {
      where.OR = [
        { sourceOrgId: orgId },
        { destinationOrgId: orgId },
      ];
    }

    if (status) {
      where.status = status;
    }

    const trips = await prisma.trip.findMany({
      where,
      include: {
        sourceOrg: {
          select: {
            id: true,
            name: true,
          },
        },
        destinationOrg: {
          select: {
            id: true,
            name: true,
          },
        },
        truck: true,
        driver: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
          },
        },
        latestLoc: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return trips;
  }

  async getTripById(tripId: string, userId: string) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        sourceOrg: {
          select: {
            id: true,
            name: true,
            gstin: true,
            city: true,
          },
        },
        destinationOrg: {
          select: {
            id: true,
            name: true,
            gstin: true,
            city: true,
          },
        },
        truck: true,
        driver: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
          },
        },
        events: {
          orderBy: {
            atTime: 'desc',
          },
        },
        loadCard: {
          include: {
            attachments: true,
          },
        },
        receiveCard: {
          include: {
            attachments: true,
          },
        },
        latestLoc: true,
      },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Verify user has access to this trip
    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to view this trip');
    }

    return trip;
  }

  async updateTripStatus(tripId: string, data: UpdateTripStatusDto, userId: string) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Verify user has access
    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to update this trip');
    }

    // Validate status transition
    this.validateStatusTransition(trip.status, data.status);

    // Update trip + create event
    const updated = await prisma.$transaction(async (tx) => {
      const updatedTrip = await tx.trip.update({
        where: { id: tripId },
        data: { status: data.status },
        include: {
          sourceOrg: true,
          destinationOrg: true,
          truck: true,
          driver: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                },
              },
            },
          },
        },
      });

      await tx.tripEvent.create({
        data: {
          tripId,
          eventType: this.mapStatusToEventType(data.status),
          description: data.remarks || `Status changed to ${data.status}`,
        },
      });

      return updatedTrip;
    });

    // TODO: Broadcast via WebSocket
    // TODO: Queue notification

    return updated;
  }

  async createLoadCard(tripId: string, data: CreateLoadCardDto, userId: string) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        loadCard: true,
      },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // ✅ SECURITY FIX: Validate trip status - cannot create load card for cancelled/completed trips
    if (trip.status === TripStatus.CANCELLED || trip.status === TripStatus.COMPLETED) {
      throw new ValidationError(`Cannot create load card for ${trip.status.toLowerCase()} trip`);
    }

    // Only source mahajan can create load card
    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: trip.sourceOrgId,
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Only source organization can create load card');
    }

    // Check if load card already exists
    if (trip.loadCard) {
      throw new ConflictError('Load card already exists for this trip');
    }

    // Verify attachments exist and belong to user
    const attachments = await prisma.attachment.findMany({
      where: {
        id: { in: data.attachmentIds },
        uploadedBy: userId,
      },
    });

    if (attachments.length !== data.attachmentIds.length) {
      throw new ValidationError('Some attachments not found or unauthorized');
    }

    // Create load card + update trip status + create event
    const loadCard = await prisma.$transaction(async (tx) => {
      const newLoadCard = await tx.tripLoadCard.create({
        data: {
          tripId,
          quantity: data.quantity,
          unit: data.unit as QuantityUnit,
          remarks: data.remarks,
        },
        include: {
          attachments: true,
        },
      });

      // Link attachments to load card
      await tx.attachment.updateMany({
        where: {
          id: { in: data.attachmentIds },
        },
        data: {
          loadCardId: newLoadCard.id,
        },
      });

      // Update trip status to LOADED
      await tx.trip.update({
        where: { id: tripId },
        data: { status: TripStatus.LOADED },
      });

      // Create event
      await tx.tripEvent.create({
        data: {
          tripId,
          eventType: TripEventType.LOAD_COMPLETED,
          description: `Load card created: ${data.quantity} ${data.unit}`,
        },
      });

      return newLoadCard;
    });

    // TODO: Broadcast via WebSocket
    // TODO: Queue notification

    return loadCard;
  }

  async createReceiveCard(tripId: string, data: CreateReceiveCardDto, userId: string) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        loadCard: true,
        receiveCard: true,
        sourceOrg: { select: { id: true, name: true } },
        destinationOrg: { select: { id: true, name: true } },
      },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // ✅ SECURITY FIX: Validate trip status - cannot create receive card for cancelled/completed trips
    if (trip.status === TripStatus.CANCELLED || trip.status === TripStatus.COMPLETED) {
      throw new ValidationError(`Cannot create receive card for ${trip.status.toLowerCase()} trip`);
    }

    // Only destination mahajan can create receive card
    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: trip.destinationOrgId,
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Only destination organization can create receive card');
    }

    // Check if receive card already exists
    if (trip.receiveCard) {
      throw new ConflictError('Receive card already exists for this trip');
    }

    // Load card must exist
    if (!trip.loadCard) {
      throw new ValidationError('Load card must be created before receive card');
    }

    // Verify attachments
    const attachments = await prisma.attachment.findMany({
      where: {
        id: { in: data.attachmentIds },
        uploadedBy: userId,
      },
    });

    if (attachments.length !== data.attachmentIds.length) {
      throw new ValidationError('Some attachments not found or unauthorized');
    }

    // ✅ Calculate shortage (receiving Mahajan manually enters what they received)
    const loadQuantity = Number(trip.loadCard.quantity);
    const receivedQuantity = Number(data.receivedQuantity);
    const shortage = loadQuantity - receivedQuantity;
    const shortagePercent = shortage > 0 ? (Number(shortage) / loadQuantity) * 100 : 0;

    // Validate received quantity is reasonable
    if (receivedQuantity > loadQuantity * 1.05) {
      throw new ValidationError(
        `Received quantity (${receivedQuantity}) exceeds loaded quantity (${loadQuantity}) by >5%. ` +
        `Please verify the quantity entered.`
      );
    }

    // Log shortage for business tracking
    const hasShortage = shortage > 0;
    if (hasShortage) {
      logger.info('📦 Shortage detected on delivery', {
        tripId,
        loadedQuantity: loadQuantity,
        receivedQuantity,
        shortage: Number(shortage),
        shortagePercent: shortagePercent.toFixed(2) + '%',
        sourceOrg: trip.sourceOrg.name,
        destinationOrg: trip.destinationOrg.name,
      });
    }

    // Create receive card + notify source Mahajan about shortage
    const receiveCard = await prisma.$transaction(async (tx) => {
      const newReceiveCard = await tx.tripReceiveCard.create({
        data: {
          tripId,
          quantity: data.receivedQuantity,
          unit: data.unit as QuantityUnit,
          shortage,
          remarks: data.remarks,
        },
        include: {
          attachments: true,
        },
      });

      // Link attachments
      await tx.attachment.updateMany({
        where: {
          id: { in: data.attachmentIds },
        },
        data: {
          receiveCardId: newReceiveCard.id,
        },
      });

      // Update trip status to COMPLETED
      await tx.trip.update({
        where: { id: tripId },
        data: { status: TripStatus.COMPLETED },
      });

      // Create event
      await tx.tripEvent.create({
        data: {
          tripId,
          eventType: TripEventType.TRIP_COMPLETED,
          description: `Receive card created: ${data.receivedQuantity} ${data.unit}${shortage > 0 ? ` (Shortage: ${shortage})` : ''}`,
        },
      });

      return newReceiveCard;
    });

    // ✅ BUSINESS LOGIC FIX: Notify source Mahajan about shortage
    if (hasShortage) {
      try {
        const chatService = new ChatService();
        const shortageMessage = `⚠️ Shortage Alert\n\n` +
          `Trip to ${trip.destinationOrg.name} completed with shortage:\n` +
          `• Loaded: ${loadQuantity} ${trip.loadCard.unit}\n` +
          `• Received: ${receivedQuantity} ${data.unit}\n` +
          `• Shortage: ${shortage} ${data.unit} (${shortagePercent.toFixed(2)}%)\n` +
          (data.remarks ? `\nRemarks: ${data.remarks}` : '');

        await chatService.sendSystemMessage(tripId, shortageMessage);

        logger.info('Shortage notification sent to source Mahajan', {
          tripId,
          shortage: Number(shortage),
          shortagePercent: shortagePercent.toFixed(2) + '%',
        });
      } catch (error) {
        logger.error('Failed to send shortage notification', {
          tripId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Don't fail the transaction if notification fails
      }
    }

    // TODO: Broadcast via WebSocket
    // TODO: Queue notification

    return receiveCard;
  }

  private validateStatusTransition(currentStatus: TripStatus, newStatus: TripStatus) {
    const validTransitions: Record<TripStatus, TripStatus[]> = {
      [TripStatus.CREATED]: [TripStatus.ASSIGNED, TripStatus.LOADED, TripStatus.CANCELLED],
      [TripStatus.ASSIGNED]: [TripStatus.LOADED, TripStatus.CANCELLED],
      [TripStatus.LOADED]: [TripStatus.IN_TRANSIT, TripStatus.CANCELLED],
      [TripStatus.IN_TRANSIT]: [TripStatus.ARRIVED, TripStatus.REACHED, TripStatus.CANCELLED],
      [TripStatus.ARRIVED]: [TripStatus.REACHED, TripStatus.DELIVERED, TripStatus.CANCELLED],
      [TripStatus.REACHED]: [TripStatus.DELIVERED, TripStatus.COMPLETED, TripStatus.CANCELLED],
      [TripStatus.DELIVERED]: [TripStatus.COMPLETED, TripStatus.DISPUTED],
      [TripStatus.COMPLETED]: [TripStatus.CLOSED, TripStatus.DISPUTED],
      [TripStatus.CLOSED]: [],
      [TripStatus.CANCELLED]: [],
      [TripStatus.DISPUTED]: [TripStatus.CLOSED],
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new ValidationError(`Cannot transition from ${currentStatus} to ${newStatus}`);
    }
  }

  private mapStatusToEventType(status: TripStatus): TripEventType {
    const mapping: Record<TripStatus, TripEventType> = {
      [TripStatus.CREATED]: TripEventType.TRIP_CREATED,
      [TripStatus.ASSIGNED]: TripEventType.ASSIGNED,
      [TripStatus.LOADED]: TripEventType.LOAD_COMPLETED,
      [TripStatus.IN_TRANSIT]: TripEventType.IN_TRANSIT,
      [TripStatus.ARRIVED]: TripEventType.ARRIVED,
      [TripStatus.REACHED]: TripEventType.ARRIVED,
      [TripStatus.DELIVERED]: TripEventType.DELIVERED,
      [TripStatus.COMPLETED]: TripEventType.TRIP_COMPLETED,
      [TripStatus.CLOSED]: TripEventType.CLOSED,
      [TripStatus.CANCELLED]: TripEventType.TRIP_CANCELLED,
      [TripStatus.DISPUTED]: TripEventType.DISPUTE_RAISED,
    };
    return mapping[status];
  }
}
