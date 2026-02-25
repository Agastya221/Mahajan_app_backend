import { z } from 'zod';

// Common validators
export const phoneSchema = z.string()
  .min(10, 'Phone number must be at least 10 digits')
  .max(15, 'Phone number too long')
  .regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number. Use format: +91XXXXXXXXXX or 10-15 digits');
export const emailSchema = z.string().email('Invalid email address');
export const cuidSchema = z.string().cuid('Invalid ID format');
export const gstinSchema = z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format').optional();

// Structured address validator (Mandi/Flipkart style)
export const addressSchema = z.object({
  label: z.string().max(100).optional(),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
  landmark: z.string().max(200).optional(),
  contactName: z.string().max(100).optional(),
  contactPhone: z.string().max(15).optional(),
});

// Pagination
export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type PaginationParams = z.infer<typeof paginationSchema>;
