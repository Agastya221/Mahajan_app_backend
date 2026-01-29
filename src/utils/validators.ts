import { z } from 'zod';

// Common validators
export const phoneSchema = z.string().regex(/^\+?[\d\s-()]+$/, 'Invalid phone number');
export const emailSchema = z.string().email('Invalid email address');
export const cuidSchema = z.string().cuid('Invalid ID format');
export const gstinSchema = z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format').optional();

// Pagination
export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type PaginationParams = z.infer<typeof paginationSchema>;
