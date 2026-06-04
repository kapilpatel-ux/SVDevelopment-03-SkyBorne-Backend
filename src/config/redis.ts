// ============================================
// src/config/redis.ts
// ============================================
import { createClient } from 'redis';
import { logger } from '../utils/winston.utils'; 

const redisClient = createClient({
  url: process.env.REDIS_URL,
  disableOfflineQueue: true, // Upstash recommended
  socket: {
    keepAlive: true,
    reconnectStrategy: (retries: number) => {
      if (retries > 10) {
        logger.error("Redis reconnection failed.");
        return new Error("Redis reconnection failed.");
      }
      return Math.min(retries * 200, 2000);
    },
  },
});

redisClient.on('error', (err: Error) => {
  logger.error(`Redis Client Error: ${err.message}`);
  console.error('❌ Redis Client Error:', err);
});

redisClient.on('connect', () => {
  logger.info('Redis Connected');
});

redisClient.on('reconnecting', () => {
  logger.warn('Redis Reconnecting...');
});

redisClient.on('ready', () => {
  logger.info('Redis Ready');
});

export const connectRedis = async (): Promise<void> => {
  try {
    await redisClient.connect();
    logger.info('Redis connection established');
  } catch (error: any) {
    logger.error(`Redis connection failed: ${error.message}`);
    console.error('❌ Redis connection failed:', error);
    // Don't exit process, continue without Redis
  }
};

export default redisClient;
