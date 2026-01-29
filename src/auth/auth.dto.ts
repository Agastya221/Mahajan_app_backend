import { z } from 'zod';
import { phoneSchema } from '../utils/validators';
import { UserRole } from '@prisma/client';

// ✅ SECURITY FIX: Strong password validation
export const registerSchema = z.object({
  phone: phoneSchema,
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.nativeEnum(UserRole).default(UserRole.MAHAJAN_STAFF),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
