import { Response } from 'express';
import { TripService } from './trip.service';
import {
  createTripSchema,
  updateTripSchema,
  createLoadCardSchema,
  createReceiveCardSchema,
} from './trip.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';
import { TripStatus } from '@prisma/client';

const tripService = new TripService();

export class TripController {
  // ════════════════════════════════════════════
  // TRIPS — CRUD
  // ════════════════════════════════════════════

  /**
   * POST /api/v1/trips
   * Create a new trip.
   */
  createTrip = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = createTripSchema.parse(req.body);
    const trip = await tripService.createTrip(data, req.user!.id);

    res.status(201).json({
      success: true,
      data: trip,
    });
  });

  /**
   * GET /api/v1/trips
   * List all trips (paginated).
   * Query: ?orgId=xxx&status=IN_TRANSIT&page=1&limit=20
   */
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

  /**
   * GET /api/v1/trips/:tripId
   * Get trip by ID with full details.
   */
  getTripById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const trip = await tripService.getTripById(tripId, req.user!.id);

    res.json({
      success: true,
      data: trip,
    });
  });

  /**
   * PATCH /api/v1/trips/:tripId
   * Unified trip update endpoint.
   * Handles: status transitions, editing fields, cancelling, and changing drivers.
   */
  updateTrip = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const data = updateTripSchema.parse(req.body);

    const trip = await tripService.updateTrip(tripId, data, req.user!.id);

    res.json({
      success: true,
      data: trip,
    });
  });

  // ════════════════════════════════════════════
  // LOAD & RECEIVE CARDS
  // ════════════════════════════════════════════

  /**
   * POST /api/v1/trips/:tripId/load-cards
   * Create a load card for the trip.
   */
  createLoadCard = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const data = createLoadCardSchema.parse(req.body);
    const loadCard = await tripService.createLoadCard(tripId, data, req.user!.id);

    res.status(201).json({
      success: true,
      data: loadCard,
    });
  });

  /**
   * POST /api/v1/trips/:tripId/receive-cards
   * Create a receive card for the trip.
   */
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
