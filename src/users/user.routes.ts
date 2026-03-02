import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { UserController } from './user.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const userController = new UserController();

// ── Dedicated rate limiter for contact discovery: 10 requests per minute
const contactCheckLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: 'Too many contact check requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * @route   POST /api/v1/users/check-contacts
 * @desc    Check which phone contacts are registered Mahajans
 * @access  Private (rate limited: 10/min)
 */
router.post('/check-contacts', authenticate, contactCheckLimiter, userController.checkContacts);

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
