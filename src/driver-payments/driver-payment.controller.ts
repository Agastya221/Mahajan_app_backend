import { Response } from 'express';
import { DriverPaymentService } from './driver-payment.service';
import { createDriverPaymentSchema, recordDriverPaymentSchema } from './driver-payment.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const driverPaymentService = new DriverPaymentService();

export class DriverPaymentController {
  createOrUpdate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const data = createDriverPaymentSchema.parse(req.body);
    const payment = await driverPaymentService.createOrUpdateDriverPayment(tripId, data, req.user!.id);

    res.status(201).json({
      success: true,
      data: payment,
    });
  });

  recordPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const data = recordDriverPaymentSchema.parse(req.body);
    const payment = await driverPaymentService.recordDriverPayment(tripId, data, req.user!.id);

    res.json({
      success: true,
      data: payment,
    });
  });

  getStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const payment = await driverPaymentService.getDriverPaymentStatus(tripId, req.user!.id);

    res.json({
      success: true,
      data: payment,
    });
  });

  getPending = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId } = req.params;
    const payments = await driverPaymentService.getPendingDriverPayments(orgId, req.user!.id);

    res.json({
      success: true,
      data: payments,
    });
  });
}
