import { z } from 'zod';

/**
 * Verify MSG91 widget/SDK access token
 * - Mobile App: MSG91 React Native SDK returns this token after OTP verification
 * - Web Testing: MSG91 Web Widget returns this token after OTP verification
 */
export const verifyWidgetTokenSchema = z.object({
  accessToken: z.string().min(1, 'Widget access token is required'),
});

/**
 * Complete registration for new users (after OTP verification)
 * SaaS model: role is always MAHAJAN_STAFF on self-registration.
 * MAHAJAN_OWNER requires payment verification (admin-only upgrade).
 * DRIVER accounts are created by org admins, not self-registered.
 */
export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  verificationToken: z.string().min(1, 'Verification token is required'),
});

/**
 * Refresh access token using refresh token
 */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export type VerifyWidgetTokenDto = z.infer<typeof verifyWidgetTokenSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
