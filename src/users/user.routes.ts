import { Router } from 'express';
import { UserController } from './user.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const userController = new UserController();

/**
 * @route   POST /api/v1/users/me/gstin
 * @desc    Submit GST number for verification
 * @access  Private (MAHAJAN only)
 */
router.post('/me/gstin', authenticate, userController.submitGstin);

/**
 * @route   GET /api/v1/users/me/gstin
 * @desc    Get GST verification status
 * @access  Private
 */
router.get('/me/gstin', authenticate, userController.getGstinStatus);

export default router;
