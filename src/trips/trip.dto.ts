import { z } from 'zod';
import { TripStatus, QuantityUnit } from '@prisma/client';

// ✅ Structured address (mandi-style, like Flipkart)
export const addressSchema = z.object({
  label: z.string().max(100).optional(),        // "Azadpur Mandi", "Godown #2"
  line1: z.string().min(1).max(200),            // Building/Shop: "Shop 45, Block B"
  line2: z.string().max(200).optional(),         // Area/Street: "Azadpur Mandi Road"
  city: z.string().min(1).max(100),             // "New Delhi"
  state: z.string().min(1).max(100),            // "Delhi"
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
  landmark: z.string().max(200).optional(),      // "Near Gate 4"
  contactName: z.string().max(100).optional(),   // Person at this location
  contactPhone: z.string().max(15).optional(),   // Phone at this location
});

export const createTripSchema = z.object({
  sourceOrgId: z.string().cuid('Invalid source organization ID'),
  destinationOrgId: z.string().cuid('Invalid destination organization ID').optional(),
  // ✅ Guest receiver: provide phone if receiver is not registered
  receiverPhone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number').optional(),
  truckNumber: z.string().min(1, 'Truck number is required'),
  driverPhone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number'),
  startPoint: z.string().min(1, 'Start point is required'),
  endPoint: z.string().min(1, 'End point is required'),
  estimatedDistance: z.number().positive().optional(),
  estimatedArrival: z.string().datetime().optional(),
  notes: z.string().optional(),
  // ✅ Structured addresses
  sourceAddress: addressSchema.optional(),
  destinationAddress: addressSchema.optional(),
  // Driver payment config
  driverPaymentAmount: z.number().positive().optional(),
  driverPaymentPaidBy: z.enum(['SOURCE', 'DESTINATION', 'SPLIT']).optional(),
  driverPaymentSplitSourceAmount: z.number().positive().optional(),
  driverPaymentSplitDestAmount: z.number().positive().optional(),
}).refine(
  (data) => data.destinationOrgId || data.receiverPhone,
  { message: 'Either destinationOrgId or receiverPhone is required', path: ['destinationOrgId'] }
);

export const updateTripStatusSchema = z.object({
  status: z.nativeEnum(TripStatus),
  remarks: z.string().optional(),
});

// ✅ Edit trip schema — only editable fields
export const editTripSchema = z.object({
  // Points (editable before IN_TRANSIT)
  startPoint: z.string().min(1).optional(),
  endPoint: z.string().min(1).optional(),
  // Structured addresses
  sourceAddress: addressSchema.optional(),
  destinationAddress: addressSchema.optional(),
  // Notes (always editable)
  notes: z.string().optional(),
  // Estimates
  estimatedDistance: z.number().positive().optional(),
  estimatedArrival: z.string().datetime().optional(),
}).refine(
  (data) => Object.values(data).some(v => v !== undefined),
  { message: 'At least one field must be provided to edit' }
);

// ✅ Cancel trip schema
export const cancelTripSchema = z.object({
  reason: z.string().min(1, 'Cancel reason is required').max(500),
});

// ✅ Change driver/truck mid-trip
export const changeTripDriverSchema = z.object({
  driverPhone: z.string().regex(/^\+91\d{10}$/, 'Invalid Indian phone number').optional(),
  truckNumber: z.string().min(1).optional(),
  reason: z.string().min(1, 'Reason for change is required').max(500),
}).refine(
  (data) => data.driverPhone || data.truckNumber,
  { message: 'At least driverPhone or truckNumber is required' }
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
export type EditTripDto = z.infer<typeof editTripSchema>;
export type CancelTripDto = z.infer<typeof cancelTripSchema>;
export type ChangeTripDriverDto = z.infer<typeof changeTripDriverSchema>;
export type AddressDto = z.infer<typeof addressSchema>;
export type LoadItemDto = z.infer<typeof loadItemSchema>;
export type ReceiveItemDto = z.infer<typeof receiveItemSchema>;
export type CreateLoadCardDto = z.infer<typeof createLoadCardSchema>;
export type CreateReceiveCardDto = z.infer<typeof createReceiveCardSchema>;
