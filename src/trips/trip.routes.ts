import { Router } from 'express';
import { TripController } from './trip.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const tripController = new TripController();

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
 * @route   PATCH /api/v1/trips/:tripId/status
 * @desc    Update trip status
 * @access  Private
 */
router.patch('/:tripId/status', authenticate, tripController.updateTripStatus);

/**
 * @route   POST /api/v1/trips/:tripId/load-card
 * @desc    Create load card for trip
 * @access  Private (Source Mahajan only)
 */
router.post('/:tripId/load-card', authenticate, tripController.createLoadCard);

/**
 * @route   POST /api/v1/trips/:tripId/receive-card
 * @desc    Create receive card for trip
 * @access  Private (Destination Mahajan only)
 */
router.post('/:tripId/receive-card', authenticate, tripController.createReceiveCard);

export default router;
