import { z } from 'zod';
import { TripStatus, QuantityUnit } from '@prisma/client';
import { addressSchema } from '../utils/validators';

export const createTripSchema = z.object({
  sourceOrgId: z.string().cuid('Invalid source organization ID'),
  destinationOrgId: z.string().cuid('Invalid destination organization ID').optional(),
  receiverPhone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number').optional(),
  truckNumber: z.string().min(1, 'Truck number is required'),
  driverPhone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number'),
  startPoint: z.string().min(1, 'Start point is required'),
  endPoint: z.string().min(1, 'End point is required'),
  estimatedDistance: z.number().positive().optional(),
  estimatedArrival: z.string().datetime().optional(),
  notes: z.string().optional(),
  sourceAddress: addressSchema.optional(),
  destinationAddress: addressSchema.optional(),
  // ✅ Coordinates for map route (from geocoder or map pin)
  sourceLat: z.number().min(-90).max(90).optional(),
  sourceLng: z.number().min(-180).max(180).optional(),
  destLat: z.number().min(-90).max(90).optional(),
  destLng: z.number().min(-180).max(180).optional(),
  driverPaymentAmount: z.number().positive().optional(),
  driverPaymentPaidBy: z.enum(['SOURCE', 'DESTINATION', 'SPLIT']).optional(),
  driverPaymentSplitSourceAmount: z.number().positive().optional(),
  driverPaymentSplitDestAmount: z.number().positive().optional(),
}).refine(
  (data) => data.destinationOrgId || data.receiverPhone,
  { message: 'Either destinationOrgId or receiverPhone is required', path: ['destinationOrgId'] }
);

// ✅ v3 Unified Edit Schema (Handles Status, Edits, Cancel, and Driver Change)
export const updateTripSchema = z.object({
  // Status transition or Cancel
  status: z.nativeEnum(TripStatus).optional(),
  cancelReason: z.string().max(500).optional(),           // Used if status = CANCELLED
  remarks: z.string().max(500).optional(),                // Used for standard status changes

  // Data edits
  startPoint: z.string().min(1).optional(),
  endPoint: z.string().min(1).optional(),
  sourceAddress: addressSchema.optional(),
  destinationAddress: addressSchema.optional(),
  // ✅ Coordinates for map route
  sourceLat: z.number().min(-90).max(90).optional(),
  sourceLng: z.number().min(-180).max(180).optional(),
  destLat: z.number().min(-90).max(90).optional(),
  destLng: z.number().min(-180).max(180).optional(),
  notes: z.string().optional(),
  estimatedDistance: z.number().positive().optional(),
  estimatedArrival: z.string().datetime().nullable().optional(),

  // Driver/Truck changes
  driverPhone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number').optional(),
  truckNumber: z.string().min(1).optional(),
  changeReason: z.string().max(500).optional(),           // Required if driver/truck changed
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided to update' }
).refine(
  (data) => {
    if (data.status === 'CANCELLED') return !!data.cancelReason;
    return true;
  },
  { message: 'cancelReason is required when cancelling a trip', path: ['cancelReason'] }
).refine(
  (data) => {
    if (data.driverPhone || data.truckNumber) return !!data.changeReason;
    return true;
  },
  { message: 'changeReason is required when changing driver or truck', path: ['changeReason'] }
);

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

export const createReceiveCardSchema = z.object({
  items: z.array(receiveItemSchema).min(1, 'At least one item is required').max(100),
  attachmentIds: z.array(z.string().cuid()).min(1, 'At least one photo is required'),
  remarks: z.string().max(1000).optional(),
});

export type CreateTripDto = z.infer<typeof createTripSchema>;
export type UpdateTripDto = z.infer<typeof updateTripSchema>;
export type AddressDto = z.infer<typeof addressSchema>;
export type LoadItemDto = z.infer<typeof loadItemSchema>;
export type ReceiveItemDto = z.infer<typeof receiveItemSchema>;
export type CreateLoadCardDto = z.infer<typeof createLoadCardSchema>;
export type CreateReceiveCardDto = z.infer<typeof createReceiveCardSchema>;
