import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

function createRedisClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // Requerido por BullMQ
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      logger.warn({ attempt: times, delay }, `Redis (${name}) reconnecting...`);
      return delay;
    },
  });

  client.on('connect', () => logger.info(`Redis (${name}) connected`));
  client.on('error', (err) => logger.error({ err }, `Redis (${name}) error`));
  client.on('close', () => logger.warn(`Redis (${name}) connection closed`));

  return client;
}

// Cliente principal para operaciones de sesión y cache
export const redisClient = createRedisClient('main');

// Cliente exclusivo para BullMQ (requiere maxRetriesPerRequest: null)
export const redisClientForBullMQ = createRedisClient('bullmq');

export async function connectRedis(): Promise<void> {
  await redisClient.connect();
  logger.info('Redis clients ready');
}

export async function disconnectRedis(): Promise<void> {
  await redisClient.quit();
  await redisClientForBullMQ.quit();
  logger.info('Redis clients disconnected');
}
