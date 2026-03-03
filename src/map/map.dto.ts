import { z } from 'zod';

// ── Route request (trip-based) ──
export const getTripRouteSchema = z.object({
    tripId: z.string().cuid('Invalid trip ID'),
});

// ── Forward geocode (search text → locations) ──
export const geocodeForwardSchema = z.object({
    q: z.string().min(2, 'Query must be at least 2 characters').max(200),
    limit: z.coerce.number().int().min(1).max(10).default(5),
});

// ── Reverse geocode (lat/lng → address) ──
export const geocodeReverseSchema = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
});

export type GetTripRouteDto = z.infer<typeof getTripRouteSchema>;
export type GeocodeForwardDto = z.infer<typeof geocodeForwardSchema>;
export type GeocodeReverseDto = z.infer<typeof geocodeReverseSchema>;
