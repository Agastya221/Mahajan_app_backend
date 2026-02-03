import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const authController = new AuthController();

/**
 * @route   GET /api/v1/auth/widget-config
 * @desc    Get MSG91 widget configuration (widgetId, tokenAuth) for frontend initialization
 * @access  Public
 */
router.get('/widget-config', authController.getWidgetConfig);

/**
 * @route   POST /api/v1/auth/verify-widget-token
 * @desc    Verify MSG91 widget/SDK access token
 *          - Mobile: Use MSG91 React Native SDK, send access token here
 *          - Web Testing: Use MSG91 Web Widget, send access token here
 * @access  Public (rate-limited via app.ts)
 */
router.post('/verify-widget-token', authController.verifyWidgetToken);

/**
 * @route   POST /api/v1/auth/register
 * @desc    Complete registration for new users (requires verificationToken from verify-widget-token)
 * @access  Public
 */
router.post('/register', authController.register);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token (rotates refresh token)
 * @access  Public
 */
router.post('/refresh', authController.refreshToken);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user (blacklists access token + revokes refresh token)
 * @access  Private
 */
router.post('/logout', authenticate, authController.logout);

export default router;
