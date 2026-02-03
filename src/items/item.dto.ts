import { z } from 'zod';
import { QuantityUnit } from '@prisma/client';

export const createItemSchema = z.object({
  name: z.string().min(1, 'Item name is required').max(100),
  nameHindi: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  hsn: z.string().max(20).optional(),
  defaultUnit: z.nativeEnum(QuantityUnit).default('KG'),
  defaultCustomUnit: z.string().max(50).optional(),
});

export const updateItemSchema = createItemSchema.partial();

export const listItemsSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  includeInactive: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().positive()),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50))
    .pipe(z.number().int().positive().max(100)),
});

export type CreateItemDto = z.infer<typeof createItemSchema>;
export type UpdateItemDto = z.infer<typeof updateItemSchema>;
export type ListItemsDto = z.infer<typeof listItemsSchema>;
