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

redisClient.on('connect', async () => {
  console.log('✅ Redis client connected');

  // Fix for BullMQ warning & Version Check
  try {
    const info = await redisClient.info();
    const versionMatch = info.match(/redis_version:([0-9.]+)/);
    if (versionMatch) {
      console.log(`ℹ️  Redis Version: ${versionMatch[1]}`);
      if (parseFloat(versionMatch[1]) < 5.0) {
        console.warn('⚠  WARNING: Your local Redis is very old (< 5.0). BullMQ requires Redis 5.0+.');
        console.warn('⚠  This is likely why "eviction policy" warnings appear and why jobs may fail.');
        console.warn('👉  RECOMMENDATION: Use the Docker setup provided (npm run docker:up).');
      }
    }

    const policy = await redisClient.config('GET', 'maxmemory-policy') as any;
    if (policy && Array.isArray(policy) && policy[1] !== 'noeviction') {
      console.log(`ℹ️  Switching Redis eviction policy from ${policy[1]} to noeviction`);
      await redisClient.config('SET', 'maxmemory-policy', 'noeviction');
    }
  } catch (err: any) {
    // Ignore error if command is not allowed (e.g. managed Redis or local old Windows redis)
    const isConfigError = err.message.includes('Unsupported CONFIG parameter') || err.message.includes('unknown command');
    if (isConfigError) {
      // Debug only - user already knows this might happen
    } else {
      console.warn(`⚠ Could not auto-configure Redis: ${err.message}`);
    }
  }
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
