import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { config } from './env';

const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
});

export const notificationQueue = new Queue('notifications', { connection: connection as any });

console.log('✅ BullMQ notification queue initialized');

export default { notificationQueue };
