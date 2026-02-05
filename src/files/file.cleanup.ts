import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import prisma from '../config/database';
import { s3Client } from '../config/s3';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// Redis connection for BullMQ
const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
});

// Queue name
const QUEUE_NAME = 'file-cleanup';

// Create queue
export const fileCleanupQueue = new Queue(QUEUE_NAME, {
  connection: connection as any,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100, // Keep last 100 failed jobs for debugging
  },
});

// Cleanup job processor
async function processCleanupJob() {
  const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

  logger.info('Starting file cleanup job', { cutoffDate: cutoffDate.toISOString() });

  try {
    // Find all PENDING attachments older than 24 hours
    const pendingFiles = await prisma.attachment.findMany({
      where: {
        status: 'PENDING',
        createdAt: {
          lt: cutoffDate,
        },
      },
      select: {
        id: true,
        s3Key: true,
        fileName: true,
        createdAt: true,
      },
    });

    if (pendingFiles.length === 0) {
      logger.info('File cleanup job completed - no stale files found');
      return { cleaned: 0 };
    }

    logger.info(`Found ${pendingFiles.length} stale PENDING files to clean up`);

    let deletedFromS3 = 0;
    let deletedFromDb = 0;
    const errors: string[] = [];

    for (const file of pendingFiles) {
      try {
        // Try to delete from S3 (may not exist if upload was never started)
        if (file.s3Key) {
          try {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: config.aws.s3Bucket,
                Key: file.s3Key,
              })
            );
            deletedFromS3++;
          } catch (s3Error: any) {
            // S3 delete is best-effort - file may not exist
            if (s3Error.name !== 'NotFound') {
              logger.warn('Failed to delete file from S3', {
                fileId: file.id,
                s3Key: file.s3Key,
                error: s3Error.message,
              });
            }
          }
        }

        // Delete from database
        await prisma.attachment.delete({
          where: { id: file.id },
        });
        deletedFromDb++;
      } catch (error: any) {
        const errorMsg = `Failed to clean up file ${file.id}: ${error.message}`;
        errors.push(errorMsg);
        logger.error('File cleanup error', { fileId: file.id, error: error.message });
      }
    }

    const result = {
      cleaned: deletedFromDb,
      s3Deleted: deletedFromS3,
      errors: errors.length,
      errorMessages: errors.slice(0, 5), // Only include first 5 errors
    };

    logger.info('File cleanup job completed', result);
    return result;
  } catch (error: any) {
    logger.error('File cleanup job failed', { error: error.message });
    throw error;
  }
}

// Create worker
export const fileCleanupWorker = new Worker(
  QUEUE_NAME,
  async () => {
    return await processCleanupJob();
  },
  {
    connection: connection as any,
    concurrency: 1, // Only one cleanup job at a time
  }
);

// Worker event handlers
fileCleanupWorker.on('completed', (job, result) => {
  logger.info('File cleanup job completed', { jobId: job?.id, result });
});

fileCleanupWorker.on('failed', (job, error) => {
  logger.error('File cleanup job failed', { jobId: job?.id, error: error.message });
});

// Schedule cleanup job to run every hour
export async function scheduleFileCleanup() {
  try {
    // Remove existing repeatable jobs first
    const existingJobs = await fileCleanupQueue.getRepeatableJobs();
    for (const job of existingJobs) {
      await fileCleanupQueue.removeRepeatableByKey(job.key);
    }

    // Add new repeatable job - runs every hour
    await fileCleanupQueue.add(
      'cleanup-stale-files',
      {},
      {
        repeat: {
          pattern: '0 * * * *', // Every hour at minute 0
        },
      }
    );

    logger.info('File cleanup job scheduled (hourly)');
  } catch (error: any) {
    logger.error('Failed to schedule file cleanup job', { error: error.message });
  }
}

// Run cleanup immediately (for manual trigger)
export async function runCleanupNow() {
  return await processCleanupJob();
}

logger.info('File cleanup worker initialized');
