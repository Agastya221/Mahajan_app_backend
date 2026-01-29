import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config/env';
import { NotificationPayload, NotificationType } from './notification.types';
import { logger } from '../utils/logger';

const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
});

// Worker to process notification jobs
export const notificationWorker = new Worker<NotificationPayload>(
  'notifications',
  async (job: Job<NotificationPayload>) => {
    const { type, recipientUserId, recipientOrgId, data } = job.data;

    logger.info(`Processing notification: ${type} for user ${recipientUserId || 'org ' + recipientOrgId}`);

    try {
      switch (type) {
        case NotificationType.TRIP_CREATED:
          await sendTripCreatedNotification(recipientUserId!, data);
          break;

        case NotificationType.TRIP_STATUS_CHANGED:
          await sendTripStatusNotification(recipientUserId!, data);
          break;

        case NotificationType.LOAD_CARD_CREATED:
          await sendLoadCardNotification(recipientOrgId!, data);
          break;

        case NotificationType.RECEIVE_CARD_CREATED:
          await sendReceiveCardNotification(recipientOrgId!, data);
          break;

        case NotificationType.PAYMENT_RECEIVED:
          await sendPaymentNotification(recipientOrgId!, data);
          break;

        case NotificationType.INVOICE_CREATED:
          await sendInvoiceNotification(recipientOrgId!, data);
          break;

        case NotificationType.CHAT_MESSAGE:
          await sendChatMessageNotification(recipientUserId!, data);
          break;

        default:
          logger.warn('Unknown notification type:', type);
      }

      logger.info(`Notification sent successfully: ${type}`);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to send notification: ${type}`, error);
      throw error; // Re-throw to trigger retry
    }
  },
  {
    connection: connection as any,
    concurrency: 5, // Process up to 5 jobs concurrently
    limiter: {
      max: 10, // Max 10 jobs
      duration: 1000, // per 1 second
    },
  }
);

// Notification sending functions (placeholders for actual implementation)

async function sendTripCreatedNotification(userId: string, data: any) {
  // TODO: Integrate with Firebase Cloud Messaging or AWS SNS
  logger.info(`[PUSH] Trip created notification to user ${userId}:`, {
    title: 'New Trip Assigned',
    body: `Trip from ${data.startPoint} to ${data.endPoint}`,
    data,
  });

  // Example FCM implementation:
  // await admin.messaging().sendToDevice(userToken, {
  //   notification: {
  //     title: 'New Trip Assigned',
  //     body: `Trip from ${data.startPoint} to ${data.endPoint}`,
  //   },
  //   data: {
  //     tripId: data.tripId,
  //     type: 'TRIP_CREATED',
  //   },
  // });
}

async function sendTripStatusNotification(userId: string, data: any) {
  logger.info(`[PUSH] Trip status notification to user ${userId}:`, {
    title: 'Trip Status Updated',
    body: `Trip status changed to ${data.status}`,
    data,
  });
}

async function sendLoadCardNotification(orgId: string, data: any) {
  logger.info(`[PUSH] Load card notification to org ${orgId}:`, {
    title: 'Load Card Created',
    body: `${data.quantity} ${data.unit} loaded`,
    data,
  });
}

async function sendReceiveCardNotification(orgId: string, data: any) {
  logger.info(`[PUSH] Receive card notification to org ${orgId}:`, {
    title: 'Goods Received',
    body: `${data.receivedQuantity} ${data.unit} received${data.shortage > 0 ? ` (Shortage: ${data.shortage})` : ''}`,
    data,
  });
}

async function sendPaymentNotification(orgId: string, data: any) {
  logger.info(`[PUSH] Payment notification to org ${orgId}:`, {
    title: 'Payment Received',
    body: `₹${data.amount} received via ${data.paymentMethod}`,
    data,
  });
}

async function sendInvoiceNotification(orgId: string, data: any) {
  logger.info(`[PUSH] Invoice notification to org ${orgId}:`, {
    title: 'New Invoice',
    body: `Invoice ${data.invoiceNumber} for ₹${data.amount}`,
    data,
  });
}

async function sendChatMessageNotification(userId: string, data: any) {
  logger.info(`[PUSH] Chat message notification to user ${userId}:`, {
    title: data.senderName || 'New Message',
    body: data.content || 'Sent an attachment',
    data,
  });
}

// Worker event handlers
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
