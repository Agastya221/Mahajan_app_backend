import { z } from 'zod';
import { phoneSchema } from '../utils/validators';

// Step 1: Send OTP to phone
export const sendOtpSchema = z.object({
  phone: phoneSchema,
});

// Step 2: Verify OTP
export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().min(4).max(8),
});

// Step 3: Register (only for new users, after OTP verified)
// SaaS model: role is always MAHAJAN_STAFF on self-registration.
// MAHAJAN_OWNER requires payment verification (admin-only upgrade).
// DRIVER accounts are created by org admins, not self-registered.
export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  verificationToken: z.string().min(1, 'Verification token is required'),
});

// Resend OTP
export const resendOtpSchema = z.object({
  phone: phoneSchema,
  retryType: z.enum(['voice', 'text']).optional(),
});

// Refresh token
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export type SendOtpDto = z.infer<typeof sendOtpSchema>;
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
export type ResendOtpDto = z.infer<typeof resendOtpSchema>;
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
