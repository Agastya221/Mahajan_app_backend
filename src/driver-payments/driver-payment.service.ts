import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { CreateDriverPaymentDto, RecordDriverPaymentDto } from './driver-payment.dto';
import { Prisma, DriverPaymentStatus } from '@prisma/client';

const { Decimal } = Prisma;

export class DriverPaymentService {
  async createOrUpdateDriverPayment(tripId: string, data: CreateDriverPaymentDto, userId: string) {
    // Validate trip exists and user has access
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Check user is member of source or destination org
    const hasAccess = await prisma.orgMember.findFirst({
      where: {
        userId,
        orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] },
      },
    });

    if (!hasAccess) {
      throw new ForbiddenError('Not authorized to manage driver payments for this trip');
    }

    // Validate split amounts if paidBy is SPLIT
    if (data.paidBy === 'SPLIT') {
      if (!data.splitSourceAmount || !data.splitDestAmount) {
        throw new ValidationError('Split amounts are required when paidBy is SPLIT');
      }
      const splitTotal = new Decimal(data.splitSourceAmount).add(new Decimal(data.splitDestAmount));
      if (!splitTotal.equals(new Decimal(data.totalAmount))) {
        throw new ValidationError('Split amounts must add up to the total amount');
      }
    }

    // Upsert driver payment
    const driverPayment = await prisma.driverPayment.upsert({
      where: { tripId },
      create: {
        tripId,
        totalAmount: data.totalAmount,
        paidBy: data.paidBy,
        splitSourceAmount: data.splitSourceAmount,
        splitDestAmount: data.splitDestAmount,
        remarks: data.remarks,
        status: 'PENDING',
      },
      update: {
        totalAmount: data.totalAmount,
        paidBy: data.paidBy,
        splitSourceAmount: data.splitSourceAmount,
        splitDestAmount: data.splitDestAmount,
        remarks: data.remarks,
      },
    });

    return driverPayment;
  }

  async recordDriverPayment(tripId: string, data: RecordDriverPaymentDto, userId: string) {
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
      throw new ForbiddenError('Not authorized to record driver payments for this trip');
    }

    const existing = await prisma.driverPayment.findUnique({
      where: { tripId },
    });

    if (!existing) {
      throw new NotFoundError('No driver payment configured for this trip');
    }

    const newPaidAmount = new Decimal(existing.paidAmount.toString()).add(new Decimal(data.amount));
    const totalAmount = new Decimal(existing.totalAmount.toString());

    let status: DriverPaymentStatus;
    if (newPaidAmount.gte(totalAmount)) {
      status = DriverPaymentStatus.PAID;
    } else if (newPaidAmount.gt(0)) {
      status = DriverPaymentStatus.PARTIALLY_PAID;
    } else {
      status = DriverPaymentStatus.PENDING;
    }

    const updated = await prisma.driverPayment.update({
      where: { tripId },
      data: {
        paidAmount: newPaidAmount.toNumber(),
        status,
        paidAt: status === 'PAID' ? new Date() : null,
        remarks: data.remarks || existing.remarks,
      },
    });

    return updated;
  }

  async getDriverPaymentStatus(tripId: string, userId: string) {
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
      throw new ForbiddenError('Not authorized to view driver payments for this trip');
    }

    const driverPayment = await prisma.driverPayment.findUnique({
      where: { tripId },
      include: {
        trip: {
          select: {
            id: true,
            startPoint: true,
            endPoint: true,
            driver: {
              include: {
                user: { select: { id: true, name: true, phone: true } },
              },
            },
          },
        },
      },
    });

    if (!driverPayment) {
      return null;
    }

    return driverPayment;
  }

  async getPendingDriverPayments(orgId: string, userId: string) {
    // Validate user is member of the org
    const membership = await prisma.orgMember.findUnique({
      where: {
        orgId_userId: { orgId, userId },
      },
    });

    if (!membership) {
      throw new ForbiddenError('Not a member of this organization');
    }

    const pendingPayments = await prisma.driverPayment.findMany({
      where: {
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
        trip: {
          OR: [
            { sourceOrgId: orgId },
            { destinationOrgId: orgId },
          ],
        },
      },
      include: {
        trip: {
          select: {
            id: true,
            startPoint: true,
            endPoint: true,
            status: true,
            createdAt: true,
            sourceOrg: { select: { id: true, name: true } },
            destinationOrg: { select: { id: true, name: true } },
            driver: {
              include: {
                user: { select: { id: true, name: true, phone: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return pendingPayments;
  }
}
