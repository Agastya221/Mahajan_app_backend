import { Response } from 'express';
import { TrackingService } from './tracking.service';
import { batchPingSchema } from './tracking.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const trackingService = new TrackingService();

export class TrackingController {
  ping = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = batchPingSchema.parse(req.body);

    // Verify the authenticated user matches the driverId
    // In practice, drivers would have their driver profile linked to their user account
    const driverProfile = await require('../config/database').default.driverProfile.findUnique({
      where: { id: data.driverId },
    });

    if (!driverProfile || driverProfile.userId !== req.user!.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to send pings for this driver',
      });
    }

    const result = await trackingService.storePings(
      data.tripId,
      data.driverId,
      data.locations
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  });

  getLocationHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await trackingService.getLocationHistory(
      tripId,
      req.user!.id,
      limit,
      offset
    );

    res.json({
      success: true,
      data: result,
    });
  });

  getLatestLocation = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { tripId } = req.params;
    const location = await trackingService.getLatestLocation(tripId, req.user!.id);

    res.json({
      success: true,
      data: location,
    });
  });

  getActiveTrips = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { driverId } = req.params;

    // Verify the authenticated user is the driver
    const driverProfile = await require('../config/database').default.driverProfile.findUnique({
      where: { id: driverId },
    });

    if (!driverProfile || driverProfile.userId !== req.user!.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view trips for this driver',
      });
    }

    const trips = await trackingService.getActiveTripsForDriver(driverId);

    res.json({
      success: true,
      data: trips,
    });
  });
}
