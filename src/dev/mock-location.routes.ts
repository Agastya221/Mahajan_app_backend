/**
 * Mock Location API Routes
 * Development-only endpoints for testing real-time location tracking
 *
 * Usage:
 *   POST /api/dev/mock-location/start/:tripId   - Start simulation
 *   POST /api/dev/mock-location/stop/:tripId    - Stop simulation
 *   GET  /api/dev/mock-location/status          - Get all active simulations
 */

import { Router, Request, Response } from 'express';
import { mockLocationService } from './mock-location.service';
import { config } from '../config/env';

const router = Router();

// Development-only middleware
router.use((req: Request, res: Response, next) => {
  if (config.nodeEnv === 'production') {
    return res.status(403).json({
      success: false,
      error: 'Mock location API is not available in production',
    });
  }
  next();
});

/**
 * Start mock location simulation for a trip
 * POST /api/dev/mock-location/start/:tripId
 *
 * Query params:
 *   - interval: Update interval in ms (default: 3000)
 *   - speed: Simulated speed in km/h (default: 50)
 */
router.post('/start/:tripId', async (req: Request, res: Response) => {
  try {
    const { tripId } = req.params;
    const interval = parseInt(req.query.interval as string) || 3000;
    const speed = parseInt(req.query.speed as string) || 50;

    const result = await mockLocationService.startSimulation(tripId, {
      intervalMs: interval,
      speedKmh: speed,
    });

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        tripId,
        config: { intervalMs: interval, speedKmh: speed },
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.message,
      });
    }
  } catch (error) {
    console.error('Error starting mock location:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start mock location simulation',
    });
  }
});

/**
 * Stop mock location simulation for a trip
 * POST /api/dev/mock-location/stop/:tripId
 */
router.post('/stop/:tripId', (req: Request, res: Response) => {
  try {
    const { tripId } = req.params;
    const result = mockLocationService.stopSimulation(tripId);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        tripId,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.message,
      });
    }
  } catch (error) {
    console.error('Error stopping mock location:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop mock location simulation',
    });
  }
});

/**
 * Get status of all active simulations
 * GET /api/dev/mock-location/status
 */
router.get('/status', (req: Request, res: Response) => {
  try {
    const simulations = mockLocationService.getActiveSimulations();

    res.json({
      success: true,
      activeSimulations: simulations.length,
      simulations,
    });
  } catch (error) {
    console.error('Error getting simulation status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get simulation status',
    });
  }
});

/**
 * Stop all simulations
 * POST /api/dev/mock-location/stop-all
 */
router.post('/stop-all', (req: Request, res: Response) => {
  try {
    mockLocationService.stopAllSimulations();

    res.json({
      success: true,
      message: 'All simulations stopped',
    });
  } catch (error) {
    console.error('Error stopping all simulations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop all simulations',
    });
  }
});

export default router;
