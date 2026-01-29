import { z } from 'zod';

export const createTruckSchema = z.object({
  orgId: z.string().cuid('Invalid organization ID'),
  number: z.string().min(3, 'Truck number must be at least 3 characters'),
  type: z.string().optional(),
  capacity: z.number().positive().optional(),
});

export const updateTruckSchema = z.object({
  number: z.string().min(3).optional(),
  type: z.string().optional(),
  capacity: z.number().positive().optional(),
});

export type CreateTruckDto = z.infer<typeof createTruckSchema>;
export type UpdateTruckDto = z.infer<typeof updateTruckSchema>;
