import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  registerSchema,
  refreshTokenSchema,
  verifyWidgetTokenSchema,
} from './auth.dto';
import { msg91Service } from './msg91.service';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const authService = new AuthService();

export class AuthController {
  /**
   * Get MSG91 widget configuration for frontend initialization
   * Returns widgetId and tokenAuth needed to initialize the OTP widget
   */
  getWidgetConfig = asyncHandler(async (req: Request, res: Response) => {
    const widgetConfig = msg91Service.getWidgetConfig();
    res.json({
      success: true,
      data: widgetConfig,
    });
  });
  /**
   * Verify MSG91 widget access token
   *
   * For Mobile App (React Native):
   * - Use MSG91 React Native SDK to handle OTP UI
   * - SDK returns access token on successful verification
   * - Send that token to this endpoint
   *
   * For Web Testing:
   * - Use MSG91 Web Widget with exposeMethods: true
   * - Call window.sendOtp(), window.verifyOtp()
   * - On success, send the access token here
   *
   * Response:
   * - Existing user: returns { isNewUser: false, user, tokens }
   * - New user: returns { isNewUser: true, phone, verificationToken }
   */
  verifyWidgetToken = asyncHandler(async (req: Request, res: Response) => {
    const { accessToken } = verifyWidgetTokenSchema.parse(req.body);
    const deviceInfo = req.headers['user-agent'];
    const result = await authService.verifyWidgetToken(accessToken, deviceInfo);

    if (result.isNewUser) {
      res.json({
        success: true,
        isNewUser: true,
        phone: result.phone,
        verificationToken: result.verificationToken,
        message: 'Phone verified. Complete registration to create your account.',
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

  /**
   * Complete registration for new users (after OTP verification)
   * Requires verificationToken from verify-widget-token endpoint
   */
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

  /**
   * Refresh access token using refresh token
   * Implements token rotation for security
   */
  refreshToken = asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = refreshTokenSchema.parse(req.body);
    const deviceInfo = req.headers['user-agent'];
    const result = await authService.refreshToken(refreshToken, deviceInfo);

    res.json({
      success: true,
      tokens: result.tokens,
    });
  });

  /**
   * Logout user
   * - Blacklists access token in Redis
   * - Revokes refresh token in DB
   */
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
