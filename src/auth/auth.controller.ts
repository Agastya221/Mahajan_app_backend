import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  sendOtpSchema,
  verifyOtpSchema,
  registerSchema,
  resendOtpSchema,
  refreshTokenSchema,
} from './auth.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const authService = new AuthService();

export class AuthController {
  // Step 1: Send OTP to phone number
  sendOtp = asyncHandler(async (req: Request, res: Response) => {
    const { phone } = sendOtpSchema.parse(req.body);
    const result = await authService.sendOtp(phone);

    res.json({
      success: true,
      message: result.message,
    });
  });

  // Resend OTP (voice or text)
  resendOtp = asyncHandler(async (req: Request, res: Response) => {
    const { phone, retryType } = resendOtpSchema.parse(req.body);
    const result = await authService.resendOtp(phone, retryType);

    res.json({
      success: true,
      message: result.message,
    });
  });

  // Step 2: Verify OTP
  // - If existing user: returns tokens
  // - If new user: returns verificationToken for registration
  verifyOtp = asyncHandler(async (req: Request, res: Response) => {
    const { phone, otp } = verifyOtpSchema.parse(req.body);
    const deviceInfo = req.headers['user-agent'];
    const result = await authService.verifyOtp(phone, otp, deviceInfo);

    if (result.isNewUser) {
      res.json({
        success: true,
        isNewUser: true,
        verificationToken: result.verificationToken,
        message: 'OTP verified. Complete registration to create your account.',
      });
    } else {
      res.json({
        success: true,
        isNewUser: false,
        user: result.user,
        tokens: result.tokens,
      });
    }
  });

  // Step 3: Register (only for new users after OTP verification)
  register = asyncHandler(async (req: Request, res: Response) => {
    const data = registerSchema.parse(req.body);
    const deviceInfo = req.headers['user-agent'];
    const result = await authService.register(data, deviceInfo);

    res.status(201).json({
      success: true,
      user: result.user,
      tokens: result.tokens,
    });
  });

  // Refresh token (rotates refresh token)
  refreshToken = asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = refreshTokenSchema.parse(req.body);
    const deviceInfo = req.headers['user-agent'];
    const result = await authService.refreshToken(refreshToken, deviceInfo);

    res.json({
      success: true,
      tokens: result.tokens,
    });
  });

  // Logout (blacklists access token + revokes refresh token)
  logout = asyncHandler(async (req: AuthRequest, res: Response) => {
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    const { refreshToken } = req.body || {};

    if (accessToken) {
      await authService.logout(accessToken, refreshToken);
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  });
}
