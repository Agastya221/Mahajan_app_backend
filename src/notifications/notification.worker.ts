import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config/env';
import { NotificationPayload, NotificationType } from './notification.types';
import { logger } from '../utils/logger';
import { sendFcmNotification, sendFcmMulticast } from '../config/firebase';
import prisma from '../config/database';

const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
});

// Suppress BullMQ Redis version warnings
const originalWarn = console.warn;
console.warn = (...args) => {
  if (args[0] && typeof args[0] === 'string' &&
    (args[0].includes('Eviction policy is volatile-lru') || args[0].includes('Redis Version'))) {
    return;
  }
  originalWarn.apply(console, args);
};

// ============================================================
// HELPER: Get FCM token(s) for a user or all users in an org
// ============================================================

async function getFcmTokenForUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fcmToken: true },
  });
  return user?.fcmToken || null;
}

async function getFcmTokensForOrg(orgId: string): Promise<string[]> {
  const members = await prisma.orgMember.findMany({
    where: { orgId },
    include: { user: { select: { fcmToken: true } } },
  });
  return members
    .map((m) => m.user.fcmToken)
    .filter((t): t is string => !!t);
}

// ============================================================
// WORKER
// ============================================================

export const notificationWorker = new Worker<NotificationPayload>(
  'notifications',
  async (job: Job<NotificationPayload>) => {
    const { type, recipientUserId, recipientOrgId, title, body, data } = job.data;

    logger.info(`Processing notification: ${type}`, {
      recipientUserId,
      recipientOrgId,
    });

    // Convert data values to strings (FCM requirement)
    const fcmData: Record<string, string> = {};
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && v !== undefined) {
          fcmData[k] = String(v);
        }
      }
    }
    fcmData['notificationType'] = type;

    try {
      if (recipientUserId) {
        // Send to single user
        const token = await getFcmTokenForUser(recipientUserId);
        if (token) {
          const sent = await sendFcmNotification(token, title, body, fcmData);
          logger.info(`FCM to user ${recipientUserId}: ${sent ? 'sent' : 'skipped (invalid token)'}`);
        } else {
          logger.info(`No FCM token for user ${recipientUserId} — skipping`);
        }
      } else if (recipientOrgId) {
        // Send to all members of org
        const tokens = await getFcmTokensForOrg(recipientOrgId);
        if (tokens.length > 0) {
          const result = await sendFcmMulticast(tokens, title, body, fcmData);
          logger.info(`FCM multicast to org ${recipientOrgId}: ${result.successCount} sent, ${result.failureCount} failed`);
        } else {
          logger.info(`No FCM tokens for org ${recipientOrgId} — skipping`);
        }
      } else {
        logger.warn('Notification has neither recipientUserId nor recipientOrgId — skipping');
      }

      return { success: true };
    } catch (error) {
      logger.error(`Failed to process notification: ${type}`, error);
      throw error; // triggers BullMQ retry
    }
  },
  {
    connection: connection as any,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  }
);

notificationWorker.on('completed', (job) => {
  logger.info(`Notification job ${job.id} completed`);
});

notificationWorker.on('failed', (job, err) => {
  logger.error(`Notification job ${job?.id} failed:`, err);
});

notificationWorker.on('error', (err) => {
  logger.error('Notification worker error:', err);
});

logger.info('✅ Notification worker initialized');

export default notificationWorker;
