import { z } from 'zod';
import { TripStatus, QuantityUnit } from '@prisma/client';

export const createTripSchema = z.object({
  sourceOrgId: z.string().cuid('Invalid source organization ID'),
  destinationOrgId: z.string().cuid('Invalid destination organization ID'),
  truckNumber: z.string().min(1, 'Truck number is required'),
  driverPhone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number'),
  startPoint: z.string().min(1, 'Start point is required'),
  endPoint: z.string().min(1, 'End point is required'),
  estimatedDistance: z.number().positive().optional(),
  estimatedArrival: z.string().datetime().optional(),
  notes: z.string().optional(),
  // Driver payment config
  driverPaymentAmount: z.number().positive().optional(),
  driverPaymentPaidBy: z.enum(['SOURCE', 'DESTINATION', 'SPLIT']).optional(),
  driverPaymentSplitSourceAmount: z.number().positive().optional(),
  driverPaymentSplitDestAmount: z.number().positive().optional(),
});

export const updateTripStatusSchema = z.object({
  status: z.nativeEnum(TripStatus),
  remarks: z.string().optional(),
});

// Single load item schema
export const loadItemSchema = z.object({
  itemId: z.string().cuid().optional(),
  itemName: z.string().min(1, 'Item name is required').max(200),
  itemNameHindi: z.string().max(200).optional(),
  quantity: z.number().positive('Quantity must be positive'),
  unit: z.nativeEnum(QuantityUnit),
  customUnit: z.string().max(50).optional(),
  rate: z.number().positive().optional(),
  grade: z.string().max(50).optional(),
  remarks: z.string().max(500).optional(),
}).refine(
  (data) => data.unit !== 'OTHER' || (data.unit === 'OTHER' && data.customUnit),
  { message: 'Custom unit is required when unit is OTHER', path: ['customUnit'] }
);

// Create load card with multiple items
export const createLoadCardSchema = z.object({
  items: z.array(loadItemSchema).min(1, 'At least one item is required').max(100),
  attachmentIds: z.array(z.string().cuid()).min(1, 'At least one photo is required'),
  remarks: z.string().max(1000).optional(),
});

// Single receive item schema
export const receiveItemSchema = z.object({
  loadItemId: z.string().cuid().optional(),
  itemId: z.string().cuid().optional(),
  itemName: z.string().min(1, 'Item name is required').max(200),
  itemNameHindi: z.string().max(200).optional(),
  quantity: z.number().positive('Quantity must be positive'),
  unit: z.nativeEnum(QuantityUnit),
  customUnit: z.string().max(50).optional(),
  rate: z.number().positive().optional(),
  grade: z.string().max(50).optional(),
  qualityIssue: z.string().max(200).optional(),
  remarks: z.string().max(500).optional(),
}).refine(
  (data) => data.unit !== 'OTHER' || (data.unit === 'OTHER' && data.customUnit),
  { message: 'Custom unit is required when unit is OTHER', path: ['customUnit'] }
);

// Create receive card with multiple items
export const createReceiveCardSchema = z.object({
  items: z.array(receiveItemSchema).min(1, 'At least one item is required').max(100),
  attachmentIds: z.array(z.string().cuid()).min(1, 'At least one photo is required'),
  remarks: z.string().max(1000).optional(),
});

export type CreateTripDto = z.infer<typeof createTripSchema>;
export type UpdateTripStatusDto = z.infer<typeof updateTripStatusSchema>;
export type LoadItemDto = z.infer<typeof loadItemSchema>;
export type ReceiveItemDto = z.infer<typeof receiveItemSchema>;
export type CreateLoadCardDto = z.infer<typeof createLoadCardSchema>;
export type CreateReceiveCardDto = z.infer<typeof createReceiveCardSchema>;
