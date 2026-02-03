/**
 * Mock Location Simulator Service
 * Simulates real driver movement for testing the tracking system
 *
 * Features:
 * - Simulates realistic route movement (Nashik → Mumbai)
 * - Broadcasts location updates via Redis Pub/Sub → WebSocket
 * - Configurable speed and update intervals
 * - Multiple simultaneous trip simulations
 */

import { redisPublisher, redisClient } from '../config/redis';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { TripStatus } from '@prisma/client';

interface SimulationConfig {
  tripId: string;
  intervalMs: number; // Update interval in milliseconds
  speedKmh: number; // Simulated speed in km/h
}

interface RoutePoint {
  lat: number;
  lng: number;
}

// Predefined routes for simulation
const ROUTES: Record<string, RoutePoint[]> = {
  // Nashik to Mumbai (Highway route via Kasara Ghat)
  'NASHIK_MUMBAI': [
    { lat: 19.9975, lng: 73.7898 }, // Nashik Market Yard
    { lat: 19.9500, lng: 73.7500 }, // Nashik outskirts
    { lat: 19.8800, lng: 73.6800 }, // Sinnar
    { lat: 19.7500, lng: 73.5500 }, // Igatpuri approach
    { lat: 19.6970, lng: 73.5130 }, // Igatpuri
    { lat: 19.6200, lng: 73.4800 }, // Kasara Ghat start
    { lat: 19.5500, lng: 73.4500 }, // Kasara Ghat middle
    { lat: 19.4800, lng: 73.4200 }, // Kasara
    { lat: 19.4000, lng: 73.3500 }, // Asangaon
    { lat: 19.3500, lng: 73.2800 }, // Shahapur
    { lat: 19.2800, lng: 73.1500 }, // Kalyan approach
    { lat: 19.2400, lng: 73.1300 }, // Kalyan
    { lat: 19.2000, lng: 73.0800 }, // Dombivli
    { lat: 19.1500, lng: 73.0200 }, // Thane approach
    { lat: 19.1000, lng: 72.9500 }, // Thane
    { lat: 19.0760, lng: 72.8777 }, // APMC Navi Mumbai
  ],

  // Nashik to Pune
  'NASHIK_PUNE': [
    { lat: 19.9975, lng: 73.7898 }, // Nashik
    { lat: 19.8500, lng: 73.9000 }, // Sinnar
    { lat: 19.7000, lng: 74.0500 }, // Ahmednagar Road
    { lat: 19.5000, lng: 74.2000 }, // Sangamner
    { lat: 19.2000, lng: 74.5000 }, // Shirdi
    { lat: 18.9500, lng: 74.6000 }, // Ahmednagar
    { lat: 18.7000, lng: 74.4000 }, // Approach Pune
    { lat: 18.5204, lng: 73.8567 }, // Pune Market Yard
  ],
};

// Active simulations tracking
const activeSimulations: Map<string, NodeJS.Timeout> = new Map();
const simulationState: Map<string, { currentIndex: number; route: RoutePoint[] }> = new Map();

export class MockLocationService {
  /**
   * Start simulating location updates for a trip
   */
  async startSimulation(
    tripId: string,
    options: Partial<SimulationConfig> = {}
  ): Promise<{ success: boolean; message: string }> {
    // Check if already simulating
    if (activeSimulations.has(tripId)) {
      return { success: false, message: 'Simulation already running for this trip' };
    }

    // Get trip details
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        driver: {
          include: {
            user: { select: { id: true, name: true, phone: true } }
          }
        },
        truck: { select: { id: true, number: true, type: true } },
        sourceOrg: { select: { city: true } },
        destinationOrg: { select: { city: true } },
      },
    });

    if (!trip) {
      return { success: false, message: 'Trip not found' };
    }

    // Determine route based on source/destination
    let routeKey = 'NASHIK_MUMBAI'; // Default route
    if (trip.sourceOrg.city?.toLowerCase().includes('nashik') &&
        trip.destinationOrg.city?.toLowerCase().includes('pune')) {
      routeKey = 'NASHIK_PUNE';
    }

    const route = ROUTES[routeKey];
    if (!route) {
      return { success: false, message: 'No route available for this trip' };
    }

    const config: SimulationConfig = {
      tripId,
      intervalMs: options.intervalMs || 3000, // Default 3 seconds
      speedKmh: options.speedKmh || 50, // Default 50 km/h
    };

    // Initialize simulation state
    simulationState.set(tripId, {
      currentIndex: 0,
      route: route,
    });

    // Start the simulation interval
    const intervalId = setInterval(async () => {
      await this.sendLocationUpdate(tripId, trip);
    }, config.intervalMs);

    activeSimulations.set(tripId, intervalId);

    logger.info(`🚗 Mock location simulation started for trip ${tripId}`, {
      route: routeKey,
      intervalMs: config.intervalMs,
      totalPoints: route.length,
    });

    // Send first location immediately
    await this.sendLocationUpdate(tripId, trip);

    return {
      success: true,
      message: `Simulation started: ${routeKey} route with ${route.length} waypoints`,
    };
  }

  /**
   * Stop simulating location updates for a trip
   */
  stopSimulation(tripId: string): { success: boolean; message: string } {
    const intervalId = activeSimulations.get(tripId);

    if (!intervalId) {
      return { success: false, message: 'No active simulation for this trip' };
    }

    clearInterval(intervalId);
    activeSimulations.delete(tripId);
    simulationState.delete(tripId);

    logger.info(`🛑 Mock location simulation stopped for trip ${tripId}`);

    return { success: true, message: 'Simulation stopped' };
  }

  /**
   * Get status of all active simulations
   */
  getActiveSimulations(): Array<{ tripId: string; currentIndex: number; totalPoints: number }> {
    const simulations: Array<{ tripId: string; currentIndex: number; totalPoints: number }> = [];

    simulationState.forEach((state, tripId) => {
      simulations.push({
        tripId,
        currentIndex: state.currentIndex,
        totalPoints: state.route.length,
      });
    });

    return simulations;
  }

  /**
   * Send a single location update
   */
  private async sendLocationUpdate(tripId: string, trip: any): Promise<void> {
    const state = simulationState.get(tripId);
    if (!state) return;

    const { currentIndex, route } = state;

    // Check if we've reached the end
    if (currentIndex >= route.length) {
      // Loop back to start or stop
      simulationState.set(tripId, { ...state, currentIndex: 0 });
      logger.info(`🔄 Mock simulation for trip ${tripId} completed route, restarting from beginning`);
      return;
    }

    const currentPoint = route[currentIndex];
    const nextPoint = route[Math.min(currentIndex + 1, route.length - 1)];

    // Add realistic GPS jitter
    const jitter = 0.0005;
    const lat = currentPoint.lat + (Math.random() - 0.5) * jitter;
    const lng = currentPoint.lng + (Math.random() - 0.5) * jitter;

    // Calculate heading to next point
    const heading = this.calculateHeading(currentPoint, nextPoint);

    // Simulate speed (40-70 km/h with variation)
    const speed = 40 + Math.random() * 30;

    // Prepare location data
    const locationData = {
      tripId,
      latitude: lat,
      longitude: lng,
      accuracy: 10 + Math.random() * 15,
      speed,
      heading,
      timestamp: new Date().toISOString(),
      driverId: trip.driver?.id,
      driverName: trip.driver?.user?.name || 'Mock Driver',
      driverPhone: trip.driver?.user?.phone || '+919999999999',
      truckNumber: trip.truck?.number || 'MH14XX0000',
      truckType: trip.truck?.type || 'TRUCK',
      status: trip.status,
      lastUpdated: new Date().toISOString(),
      // Mock-specific fields
      _mock: true,
      _routeProgress: `${currentIndex + 1}/${route.length}`,
    };

    try {
      // Store in Redis (latest location cache)
      const redisKey = `trip:${tripId}:latest`;
      await redisClient.setex(redisKey, 24 * 60 * 60, JSON.stringify(locationData));

      // Publish to Redis Pub/Sub for WebSocket broadcast
      await redisPublisher.publish(`trip:${tripId}:location`, JSON.stringify(locationData));

      // Update TripLatestLocation in database (every 5th update to reduce DB writes)
      if (currentIndex % 5 === 0) {
        await prisma.tripLatestLocation.upsert({
          where: { tripId },
          update: {
            lat,
            lng,
            speed,
            heading,
            accuracy: locationData.accuracy,
            capturedAt: new Date(),
          },
          create: {
            tripId,
            lat,
            lng,
            speed,
            heading,
            accuracy: locationData.accuracy,
            capturedAt: new Date(),
          },
        });
      }

      logger.debug(`📍 Mock location sent for trip ${tripId}: [${currentIndex + 1}/${route.length}]`, {
        lat: lat.toFixed(6),
        lng: lng.toFixed(6),
        speed: speed.toFixed(1),
      });

      // Move to next point
      simulationState.set(tripId, { ...state, currentIndex: currentIndex + 1 });

    } catch (error) {
      logger.error(`Failed to send mock location for trip ${tripId}`, { error });
    }
  }

  /**
   * Calculate heading between two points (in degrees)
   */
  private calculateHeading(from: RoutePoint, to: RoutePoint): number {
    const dLng = (to.lng - from.lng) * Math.PI / 180;
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    let heading = Math.atan2(y, x) * 180 / Math.PI;
    heading = (heading + 360) % 360;

    return Math.round(heading);
  }

  /**
   * Stop all active simulations (for cleanup)
   */
  stopAllSimulations(): void {
    activeSimulations.forEach((intervalId, tripId) => {
      clearInterval(intervalId);
      logger.info(`Stopped simulation for trip ${tripId}`);
    });
    activeSimulations.clear();
    simulationState.clear();
  }
}

// Singleton instance
export const mockLocationService = new MockLocationService();
