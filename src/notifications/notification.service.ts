import { notificationQueue } from '../config/queue';
import { NotificationPayload } from './notification.types';
import { logger } from '../utils/logger';

export class NotificationService {
  async enqueueNotification(payload: NotificationPayload) {
    try {
      await notificationQueue.add('notification', payload, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      });

      logger.info(`Notification queued: ${payload.type} for ${payload.recipientUserId || payload.recipientOrgId}`);
    } catch (error) {
      logger.error('Failed to queue notification:', error);
      throw error;
    }
  }

  async enqueueBulkNotifications(payloads: NotificationPayload[]) {
    try {
      const jobs = payloads.map((payload) => ({
        name: 'notification',
        data: payload,
        opts: {
          attempts: 3,
          backoff: {
            type: 'exponential' as const,
            delay: 2000,
          },
        },
      }));

      await notificationQueue.addBulk(jobs);

      logger.info(`${payloads.length} notifications queued`);
    } catch (error) {
      logger.error('Failed to queue bulk notifications:', error);
      throw error;
    }
  }
}

export const notificationService = new NotificationService();
