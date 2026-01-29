import { Router } from 'express';
import { TruckController } from './truck.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const truckController = new TruckController();

/**
 * @route   POST /api/v1/trucks
 * @desc    Create a new truck
 * @access  Private
 */
router.post('/', authenticate, truckController.createTruck);

/**
 * @route   GET /api/v1/trucks
 * @desc    Get all trucks (optionally filtered by orgId)
 * @access  Private
 */
router.get('/', authenticate, truckController.getTrucks);

/**
 * @route   GET /api/v1/trucks/:truckId
 * @desc    Get truck by ID
 * @access  Private
 */
router.get('/:truckId', authenticate, truckController.getTruckById);

/**
 * @route   PATCH /api/v1/trucks/:truckId
 * @desc    Update truck
 * @access  Private
 */
router.patch('/:truckId', authenticate, truckController.updateTruck);

/**
 * @route   DELETE /api/v1/trucks/:truckId
 * @desc    Delete truck
 * @access  Private
 */
router.delete('/:truckId', authenticate, truckController.deleteTruck);

export default router;
