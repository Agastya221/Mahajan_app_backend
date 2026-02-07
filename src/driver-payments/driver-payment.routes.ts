import { Router } from 'express';
import { DriverPaymentController } from './driver-payment.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const controller = new DriverPaymentController();

/**
 * @route   POST /api/v1/trips/:tripId/driver-payment
 * @desc    Create or update driver payment terms for a trip
 * @access  Private (source or destination mahajan)
 */
router.post('/trips/:tripId/driver-payment', authenticate, controller.createOrUpdate);

/**
 * @route   POST /api/v1/trips/:tripId/driver-payment/record
 * @desc    Record a payment made to the driver
 * @access  Private (source or destination mahajan)
 */
router.post('/trips/:tripId/driver-payment/record', authenticate, controller.recordPayment);

/**
 * @route   GET /api/v1/trips/:tripId/driver-payment
 * @desc    Get driver payment status for a trip
 * @access  Private (source or destination mahajan)
 */
router.get('/trips/:tripId/driver-payment', authenticate, controller.getStatus);

/**
 * @route   GET /api/v1/orgs/:orgId/pending-driver-payments
 * @desc    List all pending driver payments for an org
 * @access  Private (org member)
 */
router.get('/orgs/:orgId/pending-driver-payments', authenticate, controller.getPending);

export default router;
