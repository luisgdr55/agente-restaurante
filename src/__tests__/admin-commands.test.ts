/**
 * Tests for admin command system (Step 8).
 * Covers: /listo, /entregado, /precio, /menu, /tasa, /pedidos, /stats
 */
import { handleAdminMode } from '../agent/handlers/admin.handler';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../redis/session-manager', () => ({
  updateSessionState: jest.fn(async (phone: string, state: string, data: object) => ({ state, phone, cart: [], ...data })),
  getSession: jest.fn(),
}));
jest.mock('../whatsapp/client', () => ({
  whatsappClient: { sendMessage: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../orders/order-service', () => ({
  updateOrderStatus: jest.fn().mockResolvedValue({}),
  getOrderById: jest.fn(),
  findOrderByShortId: jest.fn(),
  finalizeCustomerStats: jest.fn().mockResolvedValue(undefined),
  shortOrderId: jest.fn((id: string) => id.slice(-6).toUpperCase()),
}));
jest.mock('../menu/config-service', () => ({
  setConfig: jest.fn().mockResolvedValue(undefined),
  getConfig: jest.fn().mockResolvedValue('36'),
  getExchangeRate: jest.fn().mockResolvedValue(36),
  usdToBs: jest.fn((usd: number, rate: number) => usd * rate),
}));
jest.mock('../db/prisma', () => ({
  prisma: {
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalBs: '0' } }),
    },
    menuItem: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));
jest.mock('../workers/queues', () => ({
  ocrQueue: { add: jest.fn().mockResolvedValue({ id: 'ocr-1' }) },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdminSession() {
  return { state: 'ADMIN_MODE', phone: '584121234567', customerId: 'admin-1', cart: [] } as any;
}

function makeMsg(text: string) {
  return { phone: '584121234567', messageId: 'msg-1', type: 'text', text, timestamp: Date.now() } as any;
}

function makeOrder(overrides = {}) {
  return {
    id: 'order-uuid-abcdef',
    totalBs: '180.00',
    customerId: 'cust-1',
    deliveryType: 'PICKUP',
    customer: { phone: '14155551234', name: 'Test Customer' },
    ...overrides,
  };
}

// Shorthands for require'd mocks (avoids re-requiring in each test)
let mocks: {
  updateSessionState: jest.Mock;
  getSession: jest.Mock;
  sendMessage: jest.Mock;
  updateOrderStatus: jest.Mock;
  findOrderByShortId: jest.Mock;
  setConfig: jest.Mock;
  getConfig: jest.Mock;
  orderFindMany: jest.Mock;
  orderCount: jest.Mock;
  orderAggregate: jest.Mock;
  menuItemFindFirst: jest.Mock;
  menuItemUpdate: jest.Mock;
  menuItemFindMany: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  const { updateSessionState, getSession } = require('../redis/session-manager');
  const { whatsappClient } = require('../whatsapp/client');
  const { updateOrderStatus, findOrderByShortId } = require('../orders/order-service');
  const { setConfig, getConfig } = require('../menu/config-service');
  const { prisma } = require('../db/prisma');

  mocks = {
    updateSessionState,
    getSession,
    sendMessage: whatsappClient.sendMessage,
    updateOrderStatus,
    findOrderByShortId,
    setConfig,
    getConfig,
    orderFindMany: prisma.order.findMany,
    orderCount: prisma.order.count,
    orderAggregate: prisma.order.aggregate,
    menuItemFindFirst: prisma.menuItem.findFirst,
    menuItemUpdate: prisma.menuItem.update,
    menuItemFindMany: prisma.menuItem.findMany,
  };
});

// ── /help ─────────────────────────────────────────────────────────────────────

describe('/help command', () => {
  it('sends help message listing all commands', async () => {
    await handleAdminMode(makeMsg('/help'), makeAdminSession());
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    const body = mocks.sendMessage.mock.calls[0][0].text?.body as string;
    expect(body).toContain('/listo');
    expect(body).toContain('/entregado');
    expect(body).toContain('/precio');
    expect(body).toContain('/tasa');
  });
});

// ── /tasa ─────────────────────────────────────────────────────────────────────

describe('/tasa command', () => {
  it('updates exchange rate with period decimal', async () => {
    await handleAdminMode(makeMsg('/tasa 40.50'), makeAdminSession());
    expect(mocks.setConfig).toHaveBeenCalledWith('USD_TO_BS_RATE', '40.5');
    expect(mocks.sendMessage).toHaveBeenCalled();
  });

  it('accepts comma as decimal separator', async () => {
    await handleAdminMode(makeMsg('/tasa 40,50'), makeAdminSession());
    expect(mocks.setConfig).toHaveBeenCalledWith('USD_TO_BS_RATE', '40.5');
  });
});

// ── /listo ────────────────────────────────────────────────────────────────────

describe('/listo command', () => {
  it('marks PICKUP order as READY and notifies customer', async () => {
    mocks.findOrderByShortId.mockResolvedValue(makeOrder());
    mocks.getSession.mockResolvedValue({
      state: 'ORDER_IN_KITCHEN',
      customerId: 'cust-1',
      cart: [],
      activeOrderId: 'order-uuid-abcdef',
    });

    await handleAdminMode(makeMsg('/listo ABCDEF'), makeAdminSession());

    expect(mocks.findOrderByShortId).toHaveBeenCalledWith('ABCDEF');
    expect(mocks.updateOrderStatus).toHaveBeenCalledWith('order-uuid-abcdef', 'READY');
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2); // admin + customer
    expect(mocks.updateSessionState).toHaveBeenCalledWith('14155551234', 'ORDER_READY', expect.any(Object));
  });

  it('shows error when order not found', async () => {
    mocks.findOrderByShortId.mockResolvedValue(null);

    await handleAdminMode(makeMsg('/listo XXXXXX'), makeAdminSession());

    expect(mocks.updateOrderStatus).not.toHaveBeenCalled();
    const body = mocks.sendMessage.mock.calls[0][0].text?.body as string;
    expect(body).toContain('XXXXXX');
  });

  it('sends delivery-specific message for delivery orders', async () => {
    mocks.findOrderByShortId.mockResolvedValue(makeOrder({ deliveryType: 'DELIVERY' }));
    mocks.getSession.mockResolvedValue(null);

    await handleAdminMode(makeMsg('/listo ABCDEF'), makeAdminSession());

    const customerMsg = mocks.sendMessage.mock.calls[1][0].text?.body as string;
    expect(customerMsg).toContain('camino');
  });

  it('skips session update when customer session not in ORDER_IN_KITCHEN', async () => {
    mocks.findOrderByShortId.mockResolvedValue(makeOrder());
    mocks.getSession.mockResolvedValue({ state: 'MAIN_MENU', customerId: 'cust-1', cart: [] });

    await handleAdminMode(makeMsg('/listo ABCDEF'), makeAdminSession());

    expect(mocks.updateSessionState).not.toHaveBeenCalled();
  });
});

// ── /entregado ────────────────────────────────────────────────────────────────

describe('/entregado command', () => {
  it('marks order as DELIVERED, notifies customer, updates session', async () => {
    mocks.findOrderByShortId.mockResolvedValue(makeOrder());
    mocks.getSession.mockResolvedValue({ state: 'ORDER_READY', customerId: 'cust-1', cart: [] });
    mocks.getConfig.mockResolvedValue('Mi Restaurante');

    await handleAdminMode(makeMsg('/entregado ABCDEF'), makeAdminSession());

    expect(mocks.updateOrderStatus).toHaveBeenCalledWith(
      'order-uuid-abcdef',
      'DELIVERED',
      expect.objectContaining({ deliveredAt: expect.any(Date) }),
    );
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    expect(mocks.updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'ORDER_DELIVERED',
      expect.objectContaining({ cart: [], activeOrderId: undefined }),
    );
  });

  it('shows error when order not found', async () => {
    mocks.findOrderByShortId.mockResolvedValue(null);
    await handleAdminMode(makeMsg('/entregado XXXXXX'), makeAdminSession());
    expect(mocks.updateOrderStatus).not.toHaveBeenCalled();
  });
});

// ── /precio ───────────────────────────────────────────────────────────────────

describe('/precio command', () => {
  it('updates menu item price by name', async () => {
    mocks.menuItemFindFirst.mockResolvedValue({ id: 'item-1', name: 'Hamburguesa', priceUsd: '2.50' });

    await handleAdminMode(makeMsg('/precio Hamburguesa 3.50'), makeAdminSession());

    expect(mocks.menuItemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: { equals: 'Hamburguesa', mode: 'insensitive' } }),
          ]),
        }),
      }),
    );
    expect(mocks.menuItemUpdate).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { priceUsd: '3.5' },
    });
  });

  it('shows error when item not found', async () => {
    mocks.menuItemFindFirst.mockResolvedValue(null);
    await handleAdminMode(makeMsg('/precio ItemInexistente 5.00'), makeAdminSession());
    expect(mocks.menuItemUpdate).not.toHaveBeenCalled();
    const body = mocks.sendMessage.mock.calls[0][0].text?.body as string;
    expect(body).toContain('ItemInexistente');
  });

  it('accepts multi-word item names', async () => {
    mocks.menuItemFindFirst.mockResolvedValue({ id: 'item-2', name: 'Pollo Frito Especial', priceUsd: '3.00' });
    await handleAdminMode(makeMsg('/precio Pollo Frito Especial 4.00'), makeAdminSession());
    expect(mocks.menuItemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: { equals: 'Pollo Frito Especial', mode: 'insensitive' } }),
          ]),
        }),
      }),
    );
  });

  it('accepts comma decimal separator', async () => {
    mocks.menuItemFindFirst.mockResolvedValue({ id: 'item-3', name: 'Pizza', priceUsd: '4.00' });
    await handleAdminMode(makeMsg('/precio Pizza 4,50'), makeAdminSession());
    expect(mocks.menuItemUpdate).toHaveBeenCalledWith({ where: { id: 'item-3' }, data: { priceUsd: '4.5' } });
  });
});

// ── /menu ─────────────────────────────────────────────────────────────────────

describe('/menu command', () => {
  it('shows empty message when no items active', async () => {
    mocks.menuItemFindMany.mockResolvedValue([]);
    await handleAdminMode(makeMsg('/menu'), makeAdminSession());
    const body = mocks.sendMessage.mock.calls[0][0].text?.body as string;
    expect(body).toContain('No hay ítems');
  });

  it('shows items grouped by category with prices', async () => {
    mocks.menuItemFindMany.mockResolvedValue([
      { id: 'i1', name: 'Hamburguesa', priceUsd: { toString: () => '2.50' }, category: { name: 'Combos' } },
      { id: 'i2', name: 'Papas', priceUsd: { toString: () => '1.00' }, category: { name: 'Acompañantes' } },
    ]);

    await handleAdminMode(makeMsg('/menu'), makeAdminSession());

    const body = mocks.sendMessage.mock.calls[0][0].text?.body as string;
    expect(body).toContain('Hamburguesa');
    expect(body).toContain('Combos');
    expect(body).toContain('Papas');
    expect(body).toContain('/precio');
  });
});

// ── /pedidos ──────────────────────────────────────────────────────────────────

describe('/pedidos command', () => {
  it('shows no orders message when queue is empty', async () => {
    mocks.orderFindMany.mockResolvedValue([]);
    await handleAdminMode(makeMsg('/pedidos'), makeAdminSession());
    const body = mocks.sendMessage.mock.calls[0][0].text?.body as string;
    expect(body).toContain('No hay pedidos');
  });

  it('lists orders with short IDs and status emojis', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { id: 'order-uuid-abcdef', status: 'IN_KITCHEN', deliveryType: 'PICKUP', customer: { name: 'Juan' } },
    ]);

    await handleAdminMode(makeMsg('/pedidos'), makeAdminSession());

    const body = mocks.sendMessage.mock.calls[0][0].text?.body as string;
    expect(body).toContain('ABCDEF');
    expect(body).toContain('Juan');
    expect(body).toContain('🍳');
  });
});

// ── /stats ────────────────────────────────────────────────────────────────────

describe('/stats command', () => {
  it('shows all stats for the day', async () => {
    mocks.orderCount
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    mocks.orderAggregate.mockResolvedValue({ _sum: { totalBs: '1260.00' } });

    await handleAdminMode(makeMsg('/stats'), makeAdminSession());

    const body = mocks.sendMessage.mock.calls[0][0].text?.body as string;
    expect(body).toContain('10'); // total
    expect(body).toContain('7');  // delivered
    expect(body).toContain('1260');
  });
});

// ── Toggle commands ───────────────────────────────────────────────────────────

describe('restaurant/delivery toggle commands', () => {
  it('/activar opens restaurant', async () => {
    await handleAdminMode(makeMsg('/activar'), makeAdminSession());
    expect(mocks.setConfig).toHaveBeenCalledWith('BUSINESS_ACTIVE', 'true');
  });

  it('/desactivar closes restaurant', async () => {
    await handleAdminMode(makeMsg('/desactivar'), makeAdminSession());
    expect(mocks.setConfig).toHaveBeenCalledWith('BUSINESS_ACTIVE', 'false');
  });

  it('/delivery on enables delivery', async () => {
    await handleAdminMode(makeMsg('/delivery on'), makeAdminSession());
    expect(mocks.setConfig).toHaveBeenCalledWith('DELIVERY_AVAILABLE', 'true');
  });

  it('/delivery off disables delivery', async () => {
    await handleAdminMode(makeMsg('/delivery off'), makeAdminSession());
    expect(mocks.setConfig).toHaveBeenCalledWith('DELIVERY_AVAILABLE', 'false');
  });
});
