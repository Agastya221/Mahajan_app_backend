import { Router } from 'express';
import { DriverController } from './driver.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const driverController = new DriverController();

/**
 * @route   POST /api/v1/drivers
 * @desc    Create a new driver profile
 * @access  Private
 */
router.post('/', authenticate, driverController.createDriver);

/**
 * @route   GET /api/v1/drivers
 * @desc    Get all drivers (optionally filtered by orgId)
 * @access  Private
 */
router.get('/', authenticate, driverController.getDrivers);

/**
 * @route   GET /api/v1/drivers/:driverId
 * @desc    Get driver by ID
 * @access  Private
 */
router.get('/:driverId', authenticate, driverController.getDriverById);

/**
 * @route   PATCH /api/v1/drivers/:driverId
 * @desc    Update driver profile
 * @access  Private
 */
router.patch('/:driverId', authenticate, driverController.updateDriver);

/**
 * @route   DELETE /api/v1/drivers/:driverId
 * @desc    Delete driver profile
 * @access  Private
 */
router.delete('/:driverId', authenticate, driverController.deleteDriver);

export default router;
