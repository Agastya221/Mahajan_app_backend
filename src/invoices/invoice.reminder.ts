import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { notificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/notification.types';

const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
});

const QUEUE_NAME = 'invoice-reminders';

export const invoiceReminderQueue = new Queue(QUEUE_NAME, {
  connection: connection as any,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

// Days after due date when we send reminders
const REMINDER_DAYS = [1, 3, 7, 14];

function shouldSendReminder(daysOverdue: number): boolean {
  if (daysOverdue <= 0) return false;
  if (REMINDER_DAYS.includes(daysOverdue)) return true;
  // After 14 days, remind every 7 days
  if (daysOverdue > 14 && (daysOverdue - 14) % 7 === 0) return true;
  return false;
}

function formatAmount(paise: bigint): string {
  const rupees = Number(paise) / 100;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

async function processReminderJob() {
  const now = new Date();
  logger.info('Running overdue invoice reminder job', { at: now.toISOString() });

  // Fetch all OPEN or PARTIAL invoices with a dueDate in the past
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['OPEN', 'PARTIAL'] },
      dueDate: { lt: now },
    },
    include: {
      account: {
        include: {
          ownerOrg: { select: { id: true, name: true } },
          counterpartyOrg: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (overdueInvoices.length === 0) {
    logger.info('No overdue invoices found — skipping reminders');
    return { sent: 0, skipped: 0 };
  }

  let sent = 0;
  let skipped = 0;

  for (const invoice of overdueInvoices) {
    try {
      const dueDate = invoice.dueDate!;
      const msPerDay = 1000 * 60 * 60 * 24;
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / msPerDay);

      if (!shouldSendReminder(daysOverdue)) {
        skipped++;
        continue;
      }

      // The counterparty org is the one who OWES the money
      const debtorOrgId = invoice.account.counterpartyOrgId;
      const creditorOrgName = invoice.account.ownerOrg.name;
      const dueAmount = invoice.dueAmount;

      // Warm, non-aggressive reminder text
      const title = `Payment reminder from ${creditorOrgName}`;
      const body = daysOverdue === 1
        ? `Just a gentle reminder — invoice #${invoice.invoiceNumber} for ${formatAmount(dueAmount)} was due yesterday.`
        : `Friendly reminder — invoice #${invoice.invoiceNumber} for ${formatAmount(dueAmount)} from ${creditorOrgName} is ${daysOverdue} days overdue. Please settle when convenient.`;

      await notificationService.enqueueNotification({
        type: NotificationType.INVOICE_OVERDUE,
        recipientOrgId: debtorOrgId,
        title,
        body,
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          dueAmount: dueAmount.toString(),
          daysOverdue: String(daysOverdue),
          creditorOrgName,
        },
      });

      sent++;
      logger.info('Overdue reminder queued', {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        daysOverdue,
        debtorOrgId,
      });
    } catch (error) {
      logger.error('Failed to queue reminder for invoice', {
        invoiceId: invoice.id,
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  logger.info('Overdue reminder job complete', { sent, skipped, total: overdueInvoices.length });
  return { sent, skipped };
}

// Worker
export const invoiceReminderWorker = new Worker(
  QUEUE_NAME,
  async () => {
    return await processReminderJob();
  },
  {
    connection: connection as any,
    concurrency: 1,
  }
);

invoiceReminderWorker.on('completed', (job, result) => {
  logger.info('Invoice reminder job completed', { jobId: job?.id, result });
});

invoiceReminderWorker.on('failed', (job, error) => {
  logger.error('Invoice reminder job failed', { jobId: job?.id, error: error.message });
});

// Schedule: runs daily at 9:00 AM IST (3:30 AM UTC)
export async function scheduleInvoiceReminders() {
  try {
    // Clear existing repeatable jobs to avoid duplicates on restart
    const existing = await invoiceReminderQueue.getRepeatableJobs();
    for (const job of existing) {
      await invoiceReminderQueue.removeRepeatableByKey(job.key);
    }

    await invoiceReminderQueue.add(
      'daily-overdue-check',
      {},
      {
        repeat: {
          pattern: '30 3 * * *', // 3:30 AM UTC = 9:00 AM IST
        },
      }
    );

    logger.info('✅ Invoice overdue reminder job scheduled (daily at 9:00 AM IST)');
  } catch (error: any) {
    logger.error('Failed to schedule invoice reminders', { error: error.message });
  }
}

logger.info('Invoice reminder worker initialized');
