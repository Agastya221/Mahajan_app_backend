import ExcelJS from 'exceljs';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import prisma from '../config/database';
import { s3Client } from '../config/s3';
import { config } from '../config/env';
import { ExportRequestDto } from './export.dto';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';

export class ExportService {
  async generateTripsExport(orgId: string, data: ExportRequestDto, userId: string) {
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);

    const where: Prisma.TripWhereInput = {
      OR: [
        { sourceOrgId: orgId },
        { destinationOrgId: orgId },
      ],
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (data.counterpartyOrgId) {
      where.AND = [
        {
          OR: [
            { sourceOrgId: data.counterpartyOrgId },
            { destinationOrgId: data.counterpartyOrgId },
          ],
        },
      ];
    }

    const trips = await prisma.trip.findMany({
      where,
      include: {
        sourceOrg: { select: { id: true, name: true, city: true } },
        destinationOrg: { select: { id: true, name: true, city: true } },
        truck: { select: { number: true } },
        driver: {
          include: {
            user: { select: { name: true } },
          },
        },
        loadCard: {
          include: {
            items: { orderBy: { sortOrder: 'asc' } },
          },
        },
        receiveCard: {
          include: {
            items: { orderBy: { sortOrder: 'asc' } },
          },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Mahajan Network';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Trips', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'Trip ID', key: 'tripId', width: 15 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Source Mahajan', key: 'sourceMahajan', width: 20 },
      { header: 'Source City', key: 'sourceCity', width: 15 },
      { header: 'Dest Mahajan', key: 'destMahajan', width: 20 },
      { header: 'Dest City', key: 'destCity', width: 15 },
      { header: 'Truck No', key: 'truckNo', width: 12 },
      { header: 'Driver', key: 'driver', width: 15 },
      { header: 'Item', key: 'itemName', width: 20 },
      { header: 'Item (Hindi)', key: 'itemNameHindi', width: 20 },
      { header: 'Loaded Qty', key: 'loadedQty', width: 12 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Rate (₹)', key: 'rate', width: 12 },
      { header: 'Load Amount (₹)', key: 'loadAmount', width: 15 },
      { header: 'Received Qty', key: 'receivedQty', width: 12 },
      { header: 'Shortage', key: 'shortage', width: 12 },
      { header: 'Shortage %', key: 'shortagePercent', width: 12 },
      { header: 'Receive Amount (₹)', key: 'receiveAmount', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Payment Status', key: 'paymentStatus', width: 15 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    let rowCount = 0;
    for (const trip of trips) {
      const loadItems = trip.loadCard?.items || [];
      const receiveItems = trip.receiveCard?.items || [];
      const driverName = trip.driver?.user.name || '-';

      if (loadItems.length === 0) {
        sheet.addRow({
          tripId: trip.id.slice(-8).toUpperCase(),
          date: trip.createdAt.toLocaleDateString('en-IN'),
          sourceMahajan: trip.sourceOrg.name,
          sourceCity: trip.sourceOrg.city || '',
          destMahajan: trip.destinationOrg.name,
          destCity: trip.destinationOrg.city || '',
          truckNo: trip.truck.number,
          driver: driverName,
          itemName: '-',
          status: trip.status,
          paymentStatus: this.getPaymentStatus(trip),
        });
        rowCount++;
        continue;
      }

      for (const loadItem of loadItems) {
        const receiveItem = receiveItems.find((ri) => ri.loadItemId === loadItem.id);

        sheet.addRow({
          tripId: trip.id.slice(-8).toUpperCase(),
          date: trip.createdAt.toLocaleDateString('en-IN'),
          sourceMahajan: trip.sourceOrg.name,
          sourceCity: trip.sourceOrg.city || '',
          destMahajan: trip.destinationOrg.name,
          destCity: trip.destinationOrg.city || '',
          truckNo: trip.truck.number,
          driver: driverName,
          itemName: loadItem.itemName,
          itemNameHindi: loadItem.itemNameHindi || '',
          loadedQty: Number(loadItem.quantity),
          unit: loadItem.customUnit || loadItem.unit,
          rate: loadItem.rate ? Number(loadItem.rate) : '',
          loadAmount: loadItem.amount ? Number(loadItem.amount) : '',
          receivedQty: receiveItem ? Number(receiveItem.quantity) : '',
          shortage: receiveItem?.shortage ? Number(receiveItem.shortage) : '',
          shortagePercent: receiveItem?.shortagePercent
            ? `${Number(receiveItem.shortagePercent)}%`
            : '',
          receiveAmount: receiveItem?.amount ? Number(receiveItem.amount) : '',
          status: trip.status,
          paymentStatus: this.getPaymentStatus(trip),
        });
        rowCount++;
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const dateRange = `${startDate.toISOString().slice(0, 10)}_to_${endDate.toISOString().slice(0, 10)}`;
    const fileName = `trips_${orgId.slice(-6)}_${dateRange}.xlsx`;
    const s3Key = `exports/${orgId}/${fileName}`;

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: s3Key,
      Body: Buffer.from(buffer as ArrayBuffer),
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await s3Client.send(uploadCommand);

    // Generate download URL (24 hours)
    const downloadCommand = new GetObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: s3Key,
    });
    const downloadUrl = await getSignedUrl(s3Client, downloadCommand, {
      expiresIn: 24 * 60 * 60,
    });

    const exportLog = await prisma.exportLog.create({
      data: {
        orgId,
        exportType: data.exportType,
        format: data.format,
        startDate,
        endDate,
        counterpartyOrgId: data.counterpartyOrgId,
        filtersJson: data as unknown as Prisma.JsonObject,
        fileName,
        s3Key,
        fileSize: (buffer as ArrayBuffer).byteLength,
        rowCount,
        createdByUserId: userId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    logger.info('Export generated', {
      exportId: exportLog.id,
      orgId,
      rowCount,
      fileSize: (buffer as ArrayBuffer).byteLength,
    });

    return {
      exportId: exportLog.id,
      fileName,
      downloadUrl,
      rowCount,
      expiresAt: exportLog.expiresAt,
    };
  }

  async getExportHistory(orgId: string) {
    return prisma.exportLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        exportType: true,
        format: true,
        startDate: true,
        endDate: true,
        fileName: true,
        fileSize: true,
        rowCount: true,
        createdAt: true,
        expiresAt: true,
        createdByUser: {
          select: { id: true, name: true },
        },
      },
    });
  }

  private getPaymentStatus(trip: {
    loadCard: { totalAmount: any } | null;
    payments: { amount: bigint }[];
  }): string {
    const totalAmount = trip.loadCard?.totalAmount
      ? Number(trip.loadCard.totalAmount)
      : 0;
    const paidAmount = trip.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );

    if (paidAmount === 0) return 'UNPAID';
    if (totalAmount > 0 && paidAmount >= totalAmount) return 'PAID';
    if (paidAmount > 0) return 'PARTIAL';
    return 'UNPAID';
  }
}

export const exportService = new ExportService();
