import { env } from '@/config/env';
import { logger } from '@/utils/logger';
import Redis from 'ioredis';

let redis: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!redis) {
    console.log('redis url: ', env.REDIS_URL);
    redis = new Redis(env.REDIS_URL, { lazyConnect: true });
    redis.on('error', (error) => {
      logger.error({ error: error }, 'Redis connection failed');
    });

    redis.on('connect', () => {
      logger.info('Redis connection success');
    });

    redis.on('reconnect', () => {
      logger.info('Redis reconnection...');
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed');
    });
  }
  return redis;
};

export const connectRedis = async () => {
  const client = getRedisClient();

  if (client.status === 'ready' || client.status === 'connecting') {
    return;
  }
  await client.connect();
};

export const closeRedis = async () => {
  if (!redis) {
    return;
  }

  await redis.quit();
  redis = null;
};
