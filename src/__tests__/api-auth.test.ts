/**
 * Integration tests for POST /api/auth/login
 */

jest.mock('../db/prisma', () => ({
  prisma: {
    systemConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalUsd: 0, totalBs: 0 } }),
    },
    menuItem: { findMany: jest.fn().mockResolvedValue([]) },
    customerStats: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  },
}));

jest.mock('../redis/session-manager', () => ({}));
jest.mock('../menu/config-service', () => ({
  getConfig: jest.fn().mockResolvedValue(null),
  getExchangeRate: jest.fn().mockResolvedValue(36),
  usdToBs: jest.fn((usd: number, rate: number) => usd * rate),
}));
jest.mock('../websocket/socket-server', () => ({
  emitOrderUpdated: jest.fn(),
  emitStatsUpdated: jest.fn(),
  emitOrderNew: jest.fn(),
  initSocketServer: jest.fn(),
}));
jest.mock('../customers/customer-stats', () => ({
  getTopCustomers: jest.fn().mockResolvedValue([]),
  getCustomerStats: jest.fn().mockResolvedValue(null),
}));

import { createTestApp } from './helpers/create-test-app';

describe('POST /api/auth/login', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 + token for correct PIN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { pin: process.env.DASHBOARD_PIN ?? '123456' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('token');
    expect(typeof body.token).toBe('string');
  });

  it('returns 401 for wrong PIN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { pin: '000000' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when pin is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });

    // Route compares undefined !== PIN → returns 401 (no schema validation)
    expect(res.statusCode).toBe(401);
  });
});
