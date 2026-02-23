import { Router } from 'express';
import { TrackingController } from './tracking.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { UserRole } from '@prisma/client';

const router = Router();
const trackingController = new TrackingController();

/**
 * @route   POST /api/v1/tracking/ping
 * @desc    Submit batched GPS location pings
 * @access  Private (Driver only)
 */
router.post('/ping', authenticate, requireRole(UserRole.DRIVER), trackingController.ping);



export default router;
