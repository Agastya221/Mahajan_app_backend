import { Response } from 'express';
import { TripService } from './trip.service';
import {
  createTripSchema,
  updateTripStatusSchema,
  createLoadCardSchema,
  createReceiveCardSchema,
} from './trip.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { TripStatus } from '@prisma/client';

const tripService = new TripService();

export class TripController {
  createTrip = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createTripSchema.parse(req.body);
    const trip = await tripService.createTrip(data, req.user!.id);

    res.status(201).json({
      success: true,
      data: trip,
    });
  });

  getTrips = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { orgId, status, page, limit } = req.query;

    const result = await tripService.getTrips({
      orgId: orgId as string | undefined,
      status: status as TripStatus | undefined,
      userId: req.user!.id,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    res.json({
      success: true,
      data: result.trips,
      pagination: result.pagination,
    });
  });

  getTripById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const trip = await tripService.getTripById(tripId, req.user!.id);

    res.json({
      success: true,
      data: trip,
    });
  });

  updateTripStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const data = updateTripStatusSchema.parse(req.body);
    const trip = await tripService.updateTripStatus(tripId, data, req.user!.id);

    res.json({
      success: true,
      data: trip,
    });
  });

  createLoadCard = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const data = createLoadCardSchema.parse(req.body);
    const loadCard = await tripService.createLoadCard(tripId, data, req.user!.id);

    res.status(201).json({
      success: true,
      data: loadCard,
    });
  });

  createReceiveCard = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const data = createReceiveCardSchema.parse(req.body);
    const receiveCard = await tripService.createReceiveCard(tripId, data, req.user!.id);

    res.status(201).json({
      success: true,
      data: receiveCard,
    });
  });
}
