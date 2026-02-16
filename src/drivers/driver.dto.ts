import { z } from 'zod';
import { phoneSchema } from '../utils/validators';

export const createDriverSchema = z.object({
  userId: z.string().cuid('Invalid user ID'),
  licenseNo: z.string().optional(),
  emergencyPhone: phoneSchema.optional(),
  altPhone: phoneSchema.optional(),
  notes: z.string().optional(),
  deviceId: z.string().optional(),
});

export const updateDriverSchema = z.object({
  licenseNo: z.string().optional(),
  emergencyPhone: phoneSchema.optional(),
  altPhone: phoneSchema.optional(),
  notes: z.string().optional(),
  deviceId: z.string().optional(),
});

export const searchDriverSchema = z.object({
  phone: z.string().min(4, 'Phone number must be at least 4 characters'),
});

export type CreateDriverDto = z.infer<typeof createDriverSchema>;
export type UpdateDriverDto = z.infer<typeof updateDriverSchema>;
