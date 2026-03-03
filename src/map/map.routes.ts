import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { MapController } from './map.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const mapController = new MapController();

// ── Dedicated rate limiter for Mapbox calls: 30/min per IP
// Prevents abuse and controls Mapbox billing
const mapLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: 'Too many map requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * @route   GET /api/v1/map/geocode/forward
 * @desc    Forward geocoding — search text → locations
 * @query   q (string, required), limit (number, optional, default 5)
 * @access  Private (rate limited: 30/min)
 */
router.get('/geocode/forward', authenticate, mapLimiter, mapController.geocodeForward);

/**
 * @route   GET /api/v1/map/geocode/reverse
 * @desc    Reverse geocoding — pin drop → address
 * @query   lat (number, required), lng (number, required)
 * @access  Private (rate limited: 30/min)
 */
router.get('/geocode/reverse', authenticate, mapLimiter, mapController.geocodeReverse);

export default router;
