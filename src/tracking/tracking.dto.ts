import { z } from 'zod';

export const locationPingSchema = z.object({
  latitude: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  accuracy: z.number().positive().optional(),
  speed: z.number().nonnegative().optional(),
  timestamp: z.string().datetime(),
  batchId: z.string().optional(),
});

export const batchPingSchema = z.object({
  tripId: z.string().cuid('Invalid trip ID'),
  driverId: z.string().cuid('Invalid driver ID'),
  locations: z.array(locationPingSchema).min(1, 'At least one location is required').max(500, 'Maximum 500 locations per batch'),
});

export type LocationPingDto = z.infer<typeof locationPingSchema>;
export type BatchPingDto = z.infer<typeof batchPingSchema>;
