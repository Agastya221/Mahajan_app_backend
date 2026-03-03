import { Router } from 'express';
import { TripController } from './trip.controller';
import { authenticate } from '../middleware/auth.middleware';
import { TrackingController } from '../tracking/tracking.controller';
import { MapController } from '../map/map.controller';

const router = Router();
const tripController = new TripController();
const trackingController = new TrackingController();
const mapController = new MapController();

// ════════════════════════════════════════════
// TRIPS
// ════════════════════════════════════════════

/**
 * @route   POST /api/v1/trips
 * @desc    Create a new trip
 * @access  Private
 */
router.post('/', authenticate, tripController.createTrip);

/**
 * @route   GET /api/v1/trips
 * @desc    Get all trips (filtered by orgId/status)
 * @access  Private
 */
router.get('/', authenticate, tripController.getTrips);

/**
 * @route   GET /api/v1/trips/:tripId
 * @desc    Get trip by ID with full details
 * @access  Private
 */
router.get('/:tripId', authenticate, tripController.getTripById);

/**
 * @route   PATCH /api/v1/trips/:tripId
 * @desc    Unified patch endpoint (edit, change status, cancel, modify driver)
 * @access  Private (source or dest org member depending on action)
 * @body    { status?, cancelReason?, startPoint?, driverPhone?, etc }
 */
router.patch('/:tripId', authenticate, tripController.updateTrip);

// ════════════════════════════════════════════
// TRIP DOCUMENTS / CARDS / LOCATIONS
// ════════════════════════════════════════════

/**
 * @route   GET /api/v1/trips/:tripId/locations
 * @desc    Get location history for a trip
 * @access  Private
 */
router.get('/:tripId/locations', authenticate, trackingController.getLocationHistory);

/**
 * @route   GET /api/v1/trips/:tripId/latest
 * @desc    Get latest location for a trip
 * @access  Private
 */
router.get('/:tripId/latest', authenticate, trackingController.getLatestLocation);

/**
 * @route   GET /api/v1/trips/:tripId/route
 * @desc    Get driving route polyline (Mapbox Directions — cached 24h)
 * @access  Private (source org, dest org, or driver)
 */
router.get('/:tripId/route', authenticate, mapController.getTripRoute);

/**
 * @route   POST /api/v1/trips/:tripId/load-cards
 * @desc    Create load card for trip
 * @access  Private (Source Mahajan only)
 */
router.post('/:tripId/load-cards', authenticate, tripController.createLoadCard);

/**
 * @route   POST /api/v1/trips/:tripId/receive-cards
 * @desc    Create receive card for trip
 * @access  Private (Destination Mahajan only)
 */
router.post('/:tripId/receive-cards', authenticate, tripController.createReceiveCard);

export default router;
