import prisma from '../config/database';
import { redisClient } from '../config/redis';
import { config } from '../config/env';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

// ════════════════════════════════════════════
// Mapbox Map Service — Backend Proxy
// Mobile App → Backend → Mapbox API
// Token never exposed to frontend
// ════════════════════════════════════════════

const MAPBOX_BASE = 'https://api.mapbox.com';
const ROUTE_CACHE_TTL = 24 * 60 * 60;       // 24 hours
const GEOCODE_CACHE_TTL = 60 * 60;           // 1 hour

export class MapService {

    // ============================================
    // ✅ Get route polyline for a trip (Swiggy/Zomato style)
    // Used by both sender & receiver to see the route on map
    // ============================================
    async getTripRoute(tripId: string, userId: string) {
        // 1. Fetch trip and verify access
        const trip = await prisma.trip.findUnique({
            where: { id: tripId },
            select: {
                id: true,
                sourceOrgId: true,
                destinationOrgId: true,
                sourceLat: true,
                sourceLng: true,
                destLat: true,
                destLng: true,
                routeDistance: true,
                routeDuration: true,
                driverId: true,
                driver: {
                    select: { userId: true },
                },
            },
        });

        if (!trip) {
            throw new NotFoundError('Trip not found');
        }

        // Access check: sender org, receiver org, or the driver
        const isDriver = trip.driver?.userId === userId;
        if (!isDriver) {
            const membership = await prisma.orgMember.findFirst({
                where: {
                    userId,
                    orgId: { in: [trip.sourceOrgId, trip.destinationOrgId] },
                },
            });
            if (!membership) {
                throw new ForbiddenError('Not authorized to view this trip route');
            }
        }

        // 2. Validate coordinates exist
        if (!trip.sourceLat || !trip.sourceLng || !trip.destLat || !trip.destLng) {
            throw new ValidationError(
                'Trip coordinates not available. Source and destination coordinates are required for route generation.'
            );
        }

        // 3. Check Redis cache first
        const cacheKey = `map:route:${tripId}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                logger.debug(`Route cache HIT for trip ${tripId}`);
                return JSON.parse(cached);
            }
        } catch (err) {
            logger.warn('Redis cache read failed for route, falling back to Mapbox', { error: err });
        }

        // 4. Call Mapbox Directions API
        logger.debug(`Route cache MISS for trip ${tripId}, calling Mapbox`);
        const routeData = await this.fetchMapboxRoute(
            trip.sourceLat, trip.sourceLng,
            trip.destLat, trip.destLng
        );

        // 5. Cache in Redis (24h TTL)
        try {
            await redisClient.setex(cacheKey, ROUTE_CACHE_TTL, JSON.stringify(routeData));
        } catch (err) {
            logger.warn('Redis cache write failed for route', { error: err });
        }

        // 6. Persist distance/duration to DB (first time only)
        if (!trip.routeDistance || !trip.routeDuration) {
            try {
                await prisma.trip.update({
                    where: { id: tripId },
                    data: {
                        routeDistance: routeData.distanceMeters,
                        routeDuration: routeData.durationSeconds,
                    },
                });
            } catch (err) {
                logger.warn('Failed to persist route metadata to trip', { error: err });
            }
        }

        return routeData;
    }

    // ============================================
    // ✅ Forward geocoding — text search → locations
    // Used when creating trips for unregistered receivers
    // ============================================
    async geocodeForward(query: string, limit: number = 5) {
        // Sanitize and create cache key
        const sanitized = query.trim().toLowerCase();
        const cacheKey = `map:geo:fwd:${sanitized}:${limit}`;

        // Check cache
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (err) {
            logger.warn('Redis cache read failed for forward geocode', { error: err });
        }

        // Call Mapbox Geocoding API
        const token = this.getToken();
        const url = `${MAPBOX_BASE}/search/geocode/v6/forward?q=${encodeURIComponent(query)}&country=IN&limit=${limit}&access_token=${token}`;

        const response = await fetch(url);

        if (!response.ok) {
            logger.error(`Mapbox geocode forward failed: ${response.status}`);
            throw new ValidationError('Geocoding service unavailable');
        }

        const data = await response.json() as any;

        const results = (data.features || []).map((f: any) => ({
            id: f.id,
            name: f.properties?.name || f.properties?.full_address || '',
            fullAddress: f.properties?.full_address || '',
            lat: f.geometry?.coordinates?.[1],
            lng: f.geometry?.coordinates?.[0],
            city: f.properties?.context?.place?.name || '',
            state: f.properties?.context?.region?.name || '',
            pincode: f.properties?.context?.postcode?.name || '',
        }));

        // Cache for 1 hour
        try {
            await redisClient.setex(cacheKey, GEOCODE_CACHE_TTL, JSON.stringify(results));
        } catch (err) {
            logger.warn('Redis cache write failed for forward geocode', { error: err });
        }

        return results;
    }

    // ============================================
    // ✅ Reverse geocoding — lat/lng → address
    // Used when user drops a pin on the map
    // ============================================
    async geocodeReverse(lat: number, lng: number) {
        const cacheKey = `map:geo:rev:${lat.toFixed(5)}:${lng.toFixed(5)}`;

        // Check cache
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (err) {
            logger.warn('Redis cache read failed for reverse geocode', { error: err });
        }

        // Call Mapbox Reverse Geocoding API
        const token = this.getToken();
        const url = `${MAPBOX_BASE}/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&country=IN&access_token=${token}`;

        const response = await fetch(url);

        if (!response.ok) {
            logger.error(`Mapbox geocode reverse failed: ${response.status}`);
            throw new ValidationError('Reverse geocoding service unavailable');
        }

        const data = await response.json() as any;
        const feature = data.features?.[0];

        const result = feature
            ? {
                name: feature.properties?.name || '',
                fullAddress: feature.properties?.full_address || '',
                lat,
                lng,
                city: feature.properties?.context?.place?.name || '',
                state: feature.properties?.context?.region?.name || '',
                pincode: feature.properties?.context?.postcode?.name || '',
            }
            : {
                name: '',
                fullAddress: '',
                lat,
                lng,
                city: '',
                state: '',
                pincode: '',
            };

        // Cache for 1 hour
        try {
            await redisClient.setex(cacheKey, GEOCODE_CACHE_TTL, JSON.stringify(result));
        } catch (err) {
            logger.warn('Redis cache write failed for reverse geocode', { error: err });
        }

        return result;
    }

    // ============================================
    // Private: Call Mapbox Directions API
    // ============================================
    private async fetchMapboxRoute(
        sourceLat: number, sourceLng: number,
        destLat: number, destLng: number
    ) {
        const token = this.getToken();

        // Mapbox format: lng,lat (NOT lat,lng)
        const coords = `${sourceLng},${sourceLat};${destLng},${destLat}`;
        const url = `${MAPBOX_BASE}/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${token}`;

        const response = await fetch(url);

        if (!response.ok) {
            logger.error(`Mapbox Directions API failed: ${response.status}`);
            throw new ValidationError('Route service unavailable');
        }

        const data = await response.json() as any;

        if (!data.routes?.length) {
            throw new ValidationError('No driving route found between source and destination');
        }

        const route = data.routes[0];

        return {
            coordinates: route.geometry.coordinates, // [[lng, lat], [lng, lat], ...]
            distanceMeters: route.distance,           // total distance in meters
            durationSeconds: route.duration,          // total duration in seconds
            distanceKm: Math.round(route.distance / 100) / 10,      // e.g. 185.3
            durationMinutes: Math.round(route.duration / 60),         // e.g. 210
        };
    }

    // ============================================
    // Private: Get Mapbox token (never log or expose)
    // ============================================
    private getToken(): string {
        const token = config.mapbox.secretToken;
        if (!token) {
            throw new ValidationError('Mapbox is not configured. Set MAPBOX_SECRET_TOKEN in .env');
        }
        return token;
    }
}
