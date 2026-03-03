import { Response } from 'express';
import { MapService } from './map.service';
import { geocodeForwardSchema, geocodeReverseSchema } from './map.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const mapService = new MapService();

export class MapController {

    /**
     * GET /trips/:tripId/route
     * Fetch route polyline for a trip (like Swiggy/Zomato map view)
     * Both sender and receiver can call this
     */
    getTripRoute = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { tripId } = req.params;
        const route = await mapService.getTripRoute(tripId, req.user!.id);

        res.json({
            success: true,
            data: route,
        });
    });

    /**
     * GET /map/geocode/forward?q=Nashik+APMC&limit=5
     * Forward geocoding — search text → lat/lng results
     * Used in trip creation for unregistered receivers
     */
    geocodeForward = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { q, limit } = geocodeForwardSchema.parse(req.query);
        const results = await mapService.geocodeForward(q, limit);

        res.json({
            success: true,
            data: results,
        });
    });

    /**
     * GET /map/geocode/reverse?lat=20.0063&lng=73.7910
     * Reverse geocoding — pin drop → address
     * Used when user places pin on map
     */
    geocodeReverse = asyncHandler(async (req: AuthRequest, res: Response) => {
        const { lat, lng } = geocodeReverseSchema.parse(req.query);
        const result = await mapService.geocodeReverse(lat, lng);

        res.json({
            success: true,
            data: result,
        });
    });
}
