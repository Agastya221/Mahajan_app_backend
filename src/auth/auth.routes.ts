import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const authController = new AuthController();

/**
 * @route   POST /api/v1/auth/send-otp
 * @desc    Send OTP to phone number
 * @access  Public (rate-limited via app.ts)
 */
router.post('/send-otp', authController.sendOtp);

/**
 * @route   POST /api/v1/auth/resend-otp
 * @desc    Resend OTP (voice or text)
 * @access  Public (rate-limited via app.ts)
 */
router.post('/resend-otp', authController.resendOtp);

/**
 * @route   POST /api/v1/auth/verify-otp
 * @desc    Verify OTP - returns tokens for existing users, verificationToken for new users
 * @access  Public (rate-limited via app.ts)
 */
router.post('/verify-otp', authController.verifyOtp);

/**
 * @route   POST /api/v1/auth/register
 * @desc    Complete registration for new users (requires verificationToken from verify-otp)
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
