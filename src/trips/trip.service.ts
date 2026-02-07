import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors';
import { CreateTripDto, UpdateTripStatusDto, CreateLoadCardDto, CreateReceiveCardDto } from './trip.dto';
import { TripStatus, TripEventType, UserRole, Prisma } from '@prisma/client';
import { ChatService } from '../chat/chat.service';
import { logger } from '../utils/logger';

const { Decimal } = Prisma;

export class TripService {
  async createTrip(data: CreateTripDto, createdBy: string) {
    // 1. Validate user is member of the source org
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

    // 2. Validate source ≠ destination
    if (data.sourceOrgId === data.destinationOrgId) {
      throw new ValidationError('Source and destination organizations must be different');
    }

    // 3. Find or create Truck by number
    let truck = await prisma.truck.findUnique({
      where: { number: data.truckNumber },
    });
    if (!truck) {
      truck = await prisma.truck.create({
        data: { number: data.truckNumber, orgId: data.sourceOrgId },
      });
    }

    // 4. Find driver by phone number
    const driverUser = await prisma.user.findUnique({
      where: { phone: data.driverPhone },
      include: { driverProfile: true },
    });

    let driverProfileId: string | null = null;

    if (driverUser) {
      if (driverUser.role !== UserRole.DRIVER || !driverUser.driverProfile) {
        throw new ValidationError('The phone number does not belong to a registered driver');
      }
      driverProfileId = driverUser.driverProfile.id;
    }
    // If driver doesn't exist yet, trip is created without driver (CREATED status)

    // 5. Create the trip
    const trip = await prisma.$transaction(async (tx) => {
      const newTrip = await tx.trip.create({
        data: {
          sourceOrgId: data.sourceOrgId,
          destinationOrgId: data.destinationOrgId,
          truckId: truck.id,
          driverId: driverProfileId,
          pendingDriverPhone: driverProfileId ? null : data.driverPhone,
          startPoint: data.startPoint,
          endPoint: data.endPoint,
          estimatedDistance: data.estimatedDistance,
          estimatedArrival: data.estimatedArrival ? new Date(data.estimatedArrival) : null,
          status: driverProfileId ? TripStatus.ASSIGNED : TripStatus.CREATED,
          notes: data.notes,
        },
        include: {
          sourceOrg: {
            select: { id: true, name: true, gstin: true },
          },
          destinationOrg: {
            select: { id: true, name: true, gstin: true },
          },
          truck: true,
          driver: {
            include: {
              user: {
                select: { id: true, name: true, phone: true },
              },
            },
          },
        },
      });

      // 6. Create TripEvent
      await tx.tripEvent.create({
        data: {
          tripId: newTrip.id,
          eventType: driverProfileId ? TripEventType.ASSIGNED : TripEventType.TRIP_CREATED,
          description: driverProfileId
            ? `Trip created and assigned to driver ${data.driverPhone}`
            : `Trip created, driver ${data.driverPhone} not yet registered`,
          createdByUserId: createdBy,
        },
      });

      // 7. Create DriverPayment record if payment info provided
      if (data.driverPaymentAmount) {
        await tx.driverPayment.create({
          data: {
            tripId: newTrip.id,
            totalAmount: data.driverPaymentAmount,
            paidBy: data.driverPaymentPaidBy || 'SOURCE',
            splitSourceAmount: data.driverPaymentSplitSourceAmount,
            splitDestAmount: data.driverPaymentSplitDestAmount,
            status: 'PENDING',
          },
        });
      }

      return newTrip;
    });

    return trip;
  }

  async getTrips(filters: {
    orgId?: string;
    status?: TripStatus;
    userId: string;
    page?: number;
    limit?: number;
  }) {
    const { orgId, status, userId, page = 1, limit = 20 } = filters;
    const safeLimit = Math.min(limit, 100);

    const where: Prisma.TripWhereInput = {};

    if (orgId) {
      // Verify user is member of the requested org
      const hasAccess = await prisma.orgMember.findFirst({
        where: { userId, orgId },
      });

      if (!hasAccess) {
        throw new ForbiddenError('Not authorized to view trips for this organization');
      }

      where.OR = [
        { sourceOrgId: orgId },
        { destinationOrgId: orgId },
      ];
    } else {
      // No orgId provided — scope to all orgs the user belongs to
      const memberships = await prisma.orgMember.findMany({
        where: { userId },
        select: { orgId: true },
      });

      const orgIds = memberships.map((m) => m.orgId);

      if (orgIds.length === 0) {
        return { trips: [], pagination: { page, limit: safeLimit, total: 0, totalPages: 0 } };
      }

      where.OR = [
        { sourceOrgId: { in: orgIds } },
        { destinationOrgId: { in: orgIds } },
      ];
    }

    if (status) {
      where.status = status;
    }

    const [trips, total] = await Promise.all([
      prisma.trip.findMany({
        where,
        include: {
          sourceOrg: {
            select: { id: true, name: true },
          },
          destinationOrg: {
            select: { id: true, name: true },
          },
          truck: true,
          driver: {
            include: {
              user: {
                select: { id: true, name: true, phone: true },
              },
            },
          },
          latestLoc: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.trip.count({ where }),
    ]);

    return {
      trips,
      pagination: {
        page,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getTripById(tripId: string, userId: string) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        sourceOrg: {
          select: { id: true, name: true, gstin: true, city: true },
        },
        destinationOrg: {
          select: { id: true, name: true, gstin: true, city: true },
        },
        truck: true,
        driver: {
          include: {
            user: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
        events: {
          orderBy: { atTime: 'desc' },
          take: 20,
        },
        loadCard: {
          include: {
            items: { orderBy: { sortOrder: 'asc' } },
            attachments: true,
            createdByUser: {
              select: { id: true, name: true },
            },
          },
        },
        receiveCard: {
          include: {
            items: {
              orderBy: { sortOrder: 'asc' },
              include: { loadItem: true },
            },
            attachments: true,
            createdByUser: {
              select: { id: true, name: true },
            },
            approvedByUser: {
              select: { id: true, name: true },
            },
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

    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to update this trip');
    }

    this.validateStatusTransition(trip.status, data.status);

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
                select: { id: true, name: true, phone: true },
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

    return updated;
  }

  async createLoadCard(tripId: string, data: CreateLoadCardDto, userId: string) {
    // Pre-validate trip exists and user has access (cheap checks outside transaction)
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        sourceOrg: { select: { id: true, name: true } },
      },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Only source mahajan can create load card
    const hasAccess = await prisma.orgMember.findFirst({
      where: { userId, orgId: trip.sourceOrgId },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Only source organization can create load card');
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

    const loadCard = await prisma.$transaction(async (tx) => {
      // Row lock: re-read trip with FOR UPDATE to prevent race conditions
      const [lockedTrip] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM "Trip" WHERE id = ${tripId} FOR UPDATE
      `;

      // Whitelist: only allow load card creation in these states
      const allowedForLoad = ['CREATED', 'ASSIGNED'];
      if (!allowedForLoad.includes(lockedTrip.status)) {
        throw new ValidationError(`Cannot create load card when trip is ${lockedTrip.status.toLowerCase()}. Trip must be in CREATED or ASSIGNED state.`);
      }

      // Check for existing load card inside transaction
      const existingLoadCard = await tx.tripLoadCard.findUnique({
        where: { tripId },
      });

      if (existingLoadCard) {
        throw new ConflictError('Load card already exists for this trip');
      }
      // Calculate totals from items
      let totalAmount = new Decimal(0);
      let totalQuantity = new Decimal(0);

      const itemsToCreate = data.items.map((item, index) => {
        const qty = new Decimal(item.quantity);
        const amount = item.rate
          ? qty.mul(new Decimal(item.rate))
          : null;

        if (amount) totalAmount = totalAmount.add(amount);
        totalQuantity = totalQuantity.add(qty);

        return {
          itemId: item.itemId || null,
          itemName: item.itemName,
          itemNameHindi: item.itemNameHindi || null,
          quantity: item.quantity,
          unit: item.unit,
          customUnit: item.unit === 'OTHER' ? item.customUnit || null : null,
          rate: item.rate || null,
          amount: amount ? amount.toNumber() : null,
          grade: item.grade || null,
          remarks: item.remarks || null,
          sortOrder: index,
        };
      });

      const newLoadCard = await tx.tripLoadCard.create({
        data: {
          tripId,
          totalItems: data.items.length,
          totalQuantity: totalQuantity.toNumber(),
          totalAmount: totalAmount.isZero() ? null : totalAmount.toNumber(),
          remarks: data.remarks,
          createdByUserId: userId,
          items: {
            create: itemsToCreate,
          },
        },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          attachments: true,
        },
      });

      // Link attachments to load card
      if (data.attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: { id: { in: data.attachmentIds } },
          data: { loadCardId: newLoadCard.id },
        });
      }

      // Update trip status to LOADED
      await tx.trip.update({
        where: { id: tripId },
        data: { status: TripStatus.LOADED },
      });

      // Create timeline event
      const itemsSummary = data.items
        .map((i) => `${i.itemName} ${i.quantity} ${i.unit}`)
        .join(', ');

      await tx.tripEvent.create({
        data: {
          tripId,
          eventType: TripEventType.LOAD_COMPLETED,
          description: `Loaded ${data.items.length} items: ${itemsSummary}`,
          metaJson: {
            itemCount: data.items.length,
            totalQuantity: totalQuantity.toNumber(),
            totalAmount: totalAmount.toNumber(),
          },
          createdByUserId: userId,
        },
      });

      return newLoadCard;
    });

    // Send system message to trip chat (non-blocking)
    try {
      const itemsSummary = data.items
        .map((i) => `${i.itemName} ${i.quantity} ${i.unit}`)
        .join(', ');
      const chatService = new ChatService();
      await chatService.sendSystemMessage(
        tripId,
        `📦 Load completed: ${data.items.length} items loaded\n${itemsSummary}`
      );
    } catch (error) {
      logger.error('Failed to send load card chat notification', {
        tripId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    logger.info('Load card created with items', {
      tripId,
      loadCardId: loadCard.id,
      itemCount: data.items.length,
    });

    return loadCard;
  }

  async createReceiveCard(tripId: string, data: CreateReceiveCardDto, userId: string) {
    // Pre-validate trip exists with load card and user has access
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        loadCard: {
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        },
        sourceOrg: { select: { id: true, name: true } },
        destinationOrg: { select: { id: true, name: true } },
      },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Only destination mahajan can create receive card
    const hasAccess = await prisma.orgMember.findFirst({
      where: { userId, orgId: trip.destinationOrgId },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Only destination organization can create receive card');
    }

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

    // Build map of loaded items for shortage calculation
    const loadedItemsMap = new Map(
      trip.loadCard.items.map((item) => [item.id, item])
    );

    const receiveCard = await prisma.$transaction(async (tx) => {
      // Row lock: re-read trip with FOR UPDATE to prevent race conditions
      const [lockedTrip] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM "Trip" WHERE id = ${tripId} FOR UPDATE
      `;

      // Whitelist: only allow receive card creation in these states
      const allowedForReceive = ['IN_TRANSIT', 'ARRIVED', 'REACHED'];
      if (!allowedForReceive.includes(lockedTrip.status)) {
        throw new ValidationError(`Cannot create receive card when trip is ${lockedTrip.status.toLowerCase()}. Trip must be IN_TRANSIT, ARRIVED, or REACHED.`);
      }

      // Check for existing receive card inside transaction
      const existingReceiveCard = await tx.tripReceiveCard.findUnique({
        where: { tripId },
      });

      if (existingReceiveCard) {
        throw new ConflictError('Receive card already exists for this trip');
      }
      let totalAmount = new Decimal(0);
      let totalQuantity = new Decimal(0);
      let totalShortage = new Decimal(0);

      const itemsToCreate = data.items.map((item, index) => {
        const receivedQty = new Decimal(item.quantity);

        // Find corresponding loaded item for shortage calc
        const loadedItem = item.loadItemId
          ? loadedItemsMap.get(item.loadItemId)
          : null;

        const loadedQty = loadedItem
          ? new Decimal(loadedItem.quantity.toString())
          : receivedQty;

        // Calculate shortage
        const shortage = loadedQty.minus(receivedQty);
        const shortagePercent = loadedQty.gt(0)
          ? shortage.div(loadedQty).mul(100)
          : new Decimal(0);

        // Calculate amount
        const amount = item.rate
          ? receivedQty.mul(new Decimal(item.rate))
          : null;

        if (amount) totalAmount = totalAmount.add(amount);
        totalQuantity = totalQuantity.add(receivedQty);
        if (shortage.gt(0)) totalShortage = totalShortage.add(shortage);

        return {
          loadItemId: item.loadItemId || null,
          itemId: item.itemId || null,
          itemName: item.itemName,
          itemNameHindi: item.itemNameHindi || null,
          quantity: item.quantity,
          unit: item.unit,
          customUnit: item.unit === 'OTHER' ? item.customUnit || null : null,
          shortage: shortage.gt(0) ? shortage.toNumber() : null,
          shortagePercent: shortage.gt(0)
            ? parseFloat(shortagePercent.toFixed(2))
            : null,
          rate: item.rate || null,
          amount: amount ? amount.toNumber() : null,
          grade: item.grade || null,
          qualityIssue: item.qualityIssue || null,
          remarks: item.remarks || null,
          sortOrder: index,
        };
      });

      // Calculate overall shortage percentage
      const totalLoadedQty = trip.loadCard!.items.reduce(
        (sum, item) => sum.add(new Decimal(item.quantity.toString())),
        new Decimal(0)
      );
      const overallShortagePercent = totalLoadedQty.gt(0)
        ? totalShortage.div(totalLoadedQty).mul(100)
        : new Decimal(0);

      const hasShortage = totalShortage.gt(0);

      const newReceiveCard = await tx.tripReceiveCard.create({
        data: {
          tripId,
          totalItems: data.items.length,
          totalQuantity: totalQuantity.toNumber(),
          totalAmount: totalAmount.isZero() ? null : totalAmount.toNumber(),
          totalShortage: hasShortage ? totalShortage.toNumber() : null,
          shortagePercent: hasShortage
            ? parseFloat(overallShortagePercent.toFixed(2))
            : null,
          remarks: data.remarks,
          status: hasShortage ? 'PENDING' : 'APPROVED',
          createdByUserId: userId,
          items: {
            create: itemsToCreate,
          },
        },
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
            include: { loadItem: true },
          },
          attachments: true,
        },
      });

      // Link attachments
      if (data.attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: { id: { in: data.attachmentIds } },
          data: { receiveCardId: newReceiveCard.id },
        });
      }

      // Update trip status
      const newStatus = hasShortage ? TripStatus.DISPUTED : TripStatus.COMPLETED;
      await tx.trip.update({
        where: { id: tripId },
        data: { status: newStatus },
      });

      // Create timeline event
      const shortageInfo = hasShortage
        ? ` | Shortage: ${totalShortage.toNumber()} (${overallShortagePercent.toFixed(2)}%)`
        : '';

      await tx.tripEvent.create({
        data: {
          tripId,
          eventType: TripEventType.TRIP_COMPLETED,
          description: `Received ${data.items.length} items${shortageInfo}`,
          metaJson: {
            itemCount: data.items.length,
            totalQuantity: totalQuantity.toNumber(),
            totalShortage: totalShortage.toNumber(),
            shortagePercent: parseFloat(overallShortagePercent.toFixed(2)),
            hasShortage,
          },
          createdByUserId: userId,
        },
      });

      return { newReceiveCard, hasShortage, totalShortage, overallShortagePercent, itemsToCreate };
    });

    // Send shortage alert to source Mahajan (non-blocking)
    if (receiveCard.hasShortage) {
      try {
        const shortageItems = receiveCard.itemsToCreate
          .filter((i) => i.shortage && i.shortage > 0)
          .map(
            (i) =>
              `• ${i.itemName}: ${i.shortage} ${i.unit} short (${i.shortagePercent}%)`
          )
          .join('\n');

        const alertMessage =
          `⚠️ Shortage Alert\n\n` +
          `Trip to ${trip.destinationOrg.name} completed with shortage:\n\n` +
          `${shortageItems}\n\n` +
          `Total shortage: ${receiveCard.totalShortage.toNumber()} (${receiveCard.overallShortagePercent.toFixed(2)}%)`;

        const chatService = new ChatService();
        await chatService.sendSystemMessage(tripId, alertMessage);

        logger.warn('Shortage detected on delivery', {
          tripId,
          totalShortage: receiveCard.totalShortage.toNumber(),
          shortagePercent: parseFloat(receiveCard.overallShortagePercent.toFixed(2)),
          itemsWithShortage: receiveCard.itemsToCreate.filter(
            (i) => i.shortage && i.shortage > 0
          ).length,
        });
      } catch (error) {
        logger.error('Failed to send shortage notification', {
          tripId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return receiveCard.newReceiveCard;
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
