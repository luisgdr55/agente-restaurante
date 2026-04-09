/**
 * Performance tests — verify caching and rate-limiting behavior.
 * These are logic tests (no real Redis needed).
 */

// Mock redis client
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  scan: jest.fn().mockResolvedValue(['0', []]),
  ttl: jest.fn().mockResolvedValue(-1),
  setex: jest.fn().mockResolvedValue('OK'),
};

jest.mock('../redis/client', () => ({
  redisClient: mockRedis,
  redisClientForBullMQ: { host: 'localhost', port: 6379 },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

jest.mock('../db/prisma', () => ({
  prisma: {
    systemConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    menuItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

import { getConfig, invalidateConfigCache } from '../menu/config-service';

const { prisma } = require('../db/prisma');

describe('Config caching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
  });

  it('hits Redis cache first on getConfig', async () => {
    mockRedis.get.mockResolvedValue('"cached_value"');
    const result = await getConfig('USD_TO_BS_RATE');
    expect(result).toBe('cached_value');
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to DB when cache miss', async () => {
    mockRedis.get.mockResolvedValue(null);
    prisma.systemConfig.findUnique.mockResolvedValue({ key: 'USD_TO_BS_RATE', value: '36' });
    const result = await getConfig('USD_TO_BS_RATE');
    expect(result).toBe('36');
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledTimes(1);
  });

  it('caches the result after DB fetch', async () => {
    mockRedis.get.mockResolvedValue(null);
    prisma.systemConfig.findUnique.mockResolvedValue({ key: 'RESTAURANT_NAME', value: 'hello' });
    await getConfig('RESTAURANT_NAME');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'cfg:RESTAURANT_NAME',
      expect.any(String),
      'EX',
      60,
    );
  });

  it('returns null from cache when key does not exist', async () => {
    mockRedis.get.mockResolvedValue(null);
    prisma.systemConfig.findUnique.mockResolvedValue(null);
    const result = await getConfig('ADMIN_PHONE');
    expect(result).toBeNull();
  });

  it('invalidateConfigCache deletes the Redis key', async () => {
    await invalidateConfigCache('USD_TO_BS_RATE');
    expect(mockRedis.del).toHaveBeenCalledWith('cfg:USD_TO_BS_RATE');
  });
});
