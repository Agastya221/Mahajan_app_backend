import { z } from 'zod';
import { TripStatus } from '@prisma/client';

export const createTripSchema = z.object({
  sourceOrgId: z.string().cuid('Invalid source organization ID'),
  destinationOrgId: z.string().cuid('Invalid destination organization ID'),
  truckId: z.string().cuid('Invalid truck ID'),
  driverId: z.string().cuid('Invalid driver ID'),
  startPoint: z.string().min(1, 'Start point is required'),
  endPoint: z.string().min(1, 'End point is required'),
  estimatedDistance: z.number().positive().optional(),
  estimatedArrival: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export const updateTripStatusSchema = z.object({
  status: z.nativeEnum(TripStatus),
  remarks: z.string().optional(),
});

export const createLoadCardSchema = z.object({
  quantity: z.number().positive('Quantity must be positive'),
  unit: z.string().min(1, 'Unit is required'),
  attachmentIds: z.array(z.string().cuid()).min(1, 'At least one photo is required'),
  remarks: z.string().optional(),
});

export const createReceiveCardSchema = z.object({
  receivedQuantity: z.number().positive('Received quantity must be positive'),
  unit: z.string().min(1, 'Unit is required'),
  attachmentIds: z.array(z.string().cuid()).min(1, 'At least one photo is required'),
  remarks: z.string().optional(),
});

export type CreateTripDto = z.infer<typeof createTripSchema>;
export type UpdateTripStatusDto = z.infer<typeof updateTripStatusSchema>;
export type CreateLoadCardDto = z.infer<typeof createLoadCardSchema>;
export type CreateReceiveCardDto = z.infer<typeof createReceiveCardSchema>;
