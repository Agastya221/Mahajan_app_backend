import Redis from 'ioredis';
import { config } from './env';

// Main Redis client for caching
export const redisClient = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: 0,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: null,
});

// Separate subscriber client for pub/sub
export const redisSubscriber = redisClient.duplicate();

// Publisher client
export const redisPublisher = redisClient.duplicate();

redisClient.on('connect', () => {
  console.log('✅ Redis client connected');
});

redisClient.on('error', (err) => {
  console.error('❌ Redis client error:', err);
});

redisSubscriber.on('connect', () => {
  console.log('✅ Redis subscriber connected');
});

redisPublisher.on('connect', () => {
  console.log('✅ Redis publisher connected');
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await redisClient.quit();
  await redisSubscriber.quit();
  await redisPublisher.quit();
});

export default redisClient;
