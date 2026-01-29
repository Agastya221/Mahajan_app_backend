import { Queue, Worker } from 'bullmq';
import { redisClient } from '../config/redis';
import prisma from '../config/database';
import { logger } from '../utils/logger';

interface LocationUpdate {
  tripId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  timestamp: Date;
}

// Queue for batching location updates
export const locationBatchQueue = new Queue('location-batch', {
  connection: redisClient as any,
});

// Worker processes batches every 10 seconds
const batchWorker = new Worker<LocationUpdate>(
  'location-batch',
  async (job) => {
    const update = job.data;

    try {
      await prisma.tripLatestLocation.upsert({
        where: { tripId: update.tripId },
        create: {
          tripId: update.tripId,
          lat: update.latitude,
          lng: update.longitude,
          accuracy: update.accuracy,
          speed: update.speed,
          capturedAt: update.timestamp,
        },
        update: {
          lat: update.latitude,
          lng: update.longitude,
          accuracy: update.accuracy,
          speed: update.speed,
          capturedAt: update.timestamp,
        },
      });

      logger.debug('Batched location update completed', { tripId: update.tripId });
    } catch (error) {
      logger.error('Failed to batch update location', { error, tripId: update.tripId });
      throw error; // Let BullMQ retry
    }
  },
  {
    connection: redisClient as any,
    concurrency: 5, // Process 5 trips concurrently
  }
);

// Helper to queue location update with 10-second delay
export async function queueLocationUpdate(data: LocationUpdate) {
  await locationBatchQueue.add(
    'update',
    data,
    {
      delay: 10000, // 10 second delay for batching
      removeOnComplete: 100, // Keep last 100 for debugging
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    }
  );
}

// Export worker for graceful shutdown
export { batchWorker };
