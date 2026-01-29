import { Router } from 'express';
import { TrackingController } from './tracking.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const trackingController = new TrackingController();

/**
 * @route   POST /api/v1/tracking/ping
 * @desc    Submit batched GPS location pings
 * @access  Private (Driver only)
 */
router.post('/ping', authenticate, trackingController.ping);

/**
 * @route   GET /api/v1/tracking/trips/:tripId/locations
 * @desc    Get location history for a trip
 * @access  Private
 */
router.get('/trips/:tripId/locations', authenticate, trackingController.getLocationHistory);

/**
 * @route   GET /api/v1/tracking/trips/:tripId/latest
 * @desc    Get latest location for a trip
 * @access  Private
 */
router.get('/trips/:tripId/latest', authenticate, trackingController.getLatestLocation);

/**
 * @route   GET /api/v1/tracking/drivers/:driverId/active-trips
 * @desc    Get active trips for a driver
 * @access  Private (Driver only)
 */
router.get('/drivers/:driverId/active-trips', authenticate, trackingController.getActiveTrips);

export default router;
