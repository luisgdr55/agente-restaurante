/**
 * Tests for the complete order flow:
 * ORDER_CONFIRMATION → AWAITING_DELIVERY_TYPE → AWAITING_DELIVERY_ADDRESS →
 * AWAITING_PAYMENT_METHOD → AWAITING_PAYMENT_PROOF → PAYMENT_UNDER_REVIEW
 *
 * Also tests: ORDER_IN_KITCHEN, PAYMENT_UNDER_REVIEW passive states,
 * and admin payment confirm/reject flow.
 */
import { handleOrderConfirmation } from '../agent/handlers/order-confirmation.handler';
import { handleAwaitingDeliveryType } from '../agent/handlers/awaiting-delivery-type.handler';
import { handleAwaitingDeliveryAddress } from '../agent/handlers/awaiting-delivery-address.handler';
import { handleAwaitingPaymentMethod } from '../agent/handlers/awaiting-payment-method.handler';
import { handleAwaitingPaymentProof } from '../agent/handlers/awaiting-payment-proof.handler';
import { handlePaymentUnderReview } from '../agent/handlers/payment-under-review.handler';
import { handleOrderInKitchen } from '../agent/handlers/order-in-kitchen.handler';
import { handleAdminMode } from '../agent/handlers/admin.handler';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../redis/session-manager', () => ({
  updateSessionState: jest.fn(async (phone: string, state: string, data: object) => ({
    state,
    phone,
    cart: [],
    ...data,
  })),
  getSession: jest.fn(),
}));

jest.mock('../whatsapp/client', () => ({
  whatsappClient: { sendMessage: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../menu/config-service', () => ({
  getConfig: jest.fn(async (key: string) => {
    const map: Record<string, string> = {
      DELIVERY_AVAILABLE: 'true',
      DELIVERY_FEE_USD: '1.50',
      MIN_ORDER_USD: '3.00',
      USD_TO_BS_RATE: '36',
      PAGO_MOVIL_BANK: 'Banco de Venezuela',
      PAGO_MOVIL_PHONE: '04241234567',
      PAGO_MOVIL_HOLDER: 'Restaurante Test',
      PAGO_MOVIL_RIF: 'J-123456789',
    };
    return map[key] ?? null;
  }),
  getExchangeRate: jest.fn().mockResolvedValue(36),
  usdToBs: jest.fn((usd: number, rate: number) => usd * rate),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../orders/order-service', () => ({
  createOrder: jest.fn().mockResolvedValue({ id: 'order-uuid-1234567890ab', totalBs: '180.00' }),
  updateOrderStatus: jest.fn().mockResolvedValue({ id: 'order-uuid-1234567890ab' }),
  getOrderById: jest.fn().mockResolvedValue({
    id: 'order-uuid-1234567890ab',
    totalBs: '180.00',
    customer: { phone: '14155551234', name: 'Test Customer' },
  }),
  shortOrderId: jest.fn((id: string) => id.slice(-6).toUpperCase()),
}));

jest.mock('../notifications/admin-notifier', () => ({
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyNewCashOrder: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../workers/queues', () => ({
  ocrQueue: { add: jest.fn().mockResolvedValue({ id: 'ocr-job-1' }) },
}));

jest.mock('../db/prisma', () => ({
  prisma: {
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalBs: '0' } }),
    },
    promotion: {
      findMany: jest.fn().mockResolvedValue([]), // no active promos in tests
    },
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
  return {
    state: 'ORDER_CONFIRMATION' as const,
    phone: '14155551234',
    customerId: 'cust-1',
    customerName: 'Test User',
    cart: [{ menuItemId: 'item-1', name: 'Hamburguesa', quantity: 2, unitPriceUsd: 2.5 }],
    deliveryType: undefined,
    deliveryAddress: undefined,
    paymentMethod: undefined,
    activeOrderId: undefined,
    ...overrides,
  } as any;
}

function makeMsg(overrides = {}) {
  return {
    phone: '14155551234',
    messageId: 'msg-001',
    type: 'text',
    timestamp: Date.now(),
    ...overrides,
  } as any;
}

// ── ORDER_CONFIRMATION ────────────────────────────────────────────────────────

describe('ORDER_CONFIRMATION handler', () => {
  const { updateSessionState } = require('../redis/session-manager');
  const { whatsappClient } = require('../whatsapp/client');

  beforeEach(() => jest.clearAllMocks());

  it('shows summary on first message (no interactive reply)', async () => {
    const session = makeSession();
    const msg = makeMsg({ type: 'text', text: 'hola' });

    await handleOrderConfirmation(msg, session);

    expect(whatsappClient.sendMessage).toHaveBeenCalled();
    expect(updateSessionState).not.toHaveBeenCalled();
  });

  it('transitions to AWAITING_DELIVERY_TYPE on confirm button', async () => {
    const session = makeSession();
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'confirm_go_delivery', title: 'Sí' },
    });

    await handleOrderConfirmation(msg, session);

    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'AWAITING_DELIVERY_TYPE',
      expect.objectContaining({ cart: session.cart }),
    );
  });

  it('transitions to BUILDING_ORDER on modify button', async () => {
    const session = makeSession();
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'confirm_modify', title: 'Modificar' },
    });

    await handleOrderConfirmation(msg, session);

    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'BUILDING_ORDER',
      expect.any(Object),
    );
  });

  it('transitions to MAIN_MENU on cancel button', async () => {
    const session = makeSession();
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'confirm_cancel', title: 'Cancelar' },
    });

    await handleOrderConfirmation(msg, session);

    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'MAIN_MENU',
      expect.objectContaining({ cart: [] }),
    );
  });

  it('redirects to BROWSE_CATEGORIES on empty cart', async () => {
    const session = makeSession({ cart: [] });
    const msg = makeMsg({ type: 'text', text: 'confirmar' });

    await handleOrderConfirmation(msg, session);

    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'BROWSE_CATEGORIES',
      expect.any(Object),
    );
  });
});

// ── AWAITING_DELIVERY_TYPE ────────────────────────────────────────────────────

describe('AWAITING_DELIVERY_TYPE handler', () => {
  const { updateSessionState } = require('../redis/session-manager');

  beforeEach(() => jest.clearAllMocks());

  it('transitions to AWAITING_DELIVERY_ADDRESS on delivery button', async () => {
    const session = makeSession();
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'delivery_delivery', title: 'Delivery' },
    });

    await handleAwaitingDeliveryType(msg, session);

    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'AWAITING_DELIVERY_ADDRESS',
      expect.objectContaining({ deliveryType: 'DELIVERY' }),
    );
  });

  it('transitions to AWAITING_PAYMENT_METHOD on pickup button', async () => {
    const session = makeSession();
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'delivery_pickup', title: 'Pickup' },
    });

    await handleAwaitingDeliveryType(msg, session);

    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'AWAITING_PAYMENT_METHOD',
      expect.objectContaining({ deliveryType: 'PICKUP' }),
    );
  });
});

// ── AWAITING_DELIVERY_ADDRESS ─────────────────────────────────────────────────

describe('AWAITING_DELIVERY_ADDRESS handler', () => {
  const { updateSessionState } = require('../redis/session-manager');
  const { whatsappClient } = require('../whatsapp/client');

  beforeEach(() => jest.clearAllMocks());

  it('accepts address with >= 10 chars and transitions to AWAITING_PAYMENT_METHOD', async () => {
    const session = makeSession({ deliveryType: 'DELIVERY' });
    const msg = makeMsg({ type: 'text', text: 'Calle 5, Urb. Las Palmas, Ref. Frente al parque' });

    await handleAwaitingDeliveryAddress(msg, session);

    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'AWAITING_PAYMENT_METHOD',
      expect.objectContaining({ deliveryAddress: expect.any(String) }),
    );
  });

  it('rejects short address and stays in same state', async () => {
    const session = makeSession({ deliveryType: 'DELIVERY' });
    const msg = makeMsg({ type: 'text', text: 'Casa mia' });

    await handleAwaitingDeliveryAddress(msg, session);

    expect(updateSessionState).not.toHaveBeenCalled();
    expect(whatsappClient.sendMessage).toHaveBeenCalled();
  });
});

// ── AWAITING_PAYMENT_METHOD ───────────────────────────────────────────────────

describe('AWAITING_PAYMENT_METHOD handler', () => {
  const { updateSessionState } = require('../redis/session-manager');
  const { createOrder } = require('../orders/order-service');

  beforeEach(() => jest.clearAllMocks());

  it('creates order and transitions to AWAITING_PAYMENT_PROOF on pago movil', async () => {
    const session = makeSession({ deliveryType: 'PICKUP' });
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'pay_movil', title: 'Pago Móvil' },
    });

    await handleAwaitingPaymentMethod(msg, session);

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'PAGO_MOVIL' }));
    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'AWAITING_PAYMENT_PROOF',
      expect.objectContaining({ paymentMethod: 'PAGO_MOVIL' }),
    );
  });

  it('creates order and transitions to ORDER_IN_KITCHEN on cash (pickup)', async () => {
    const session = makeSession({ deliveryType: 'PICKUP' });
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'pay_cash', title: 'Efectivo' },
    });

    await handleAwaitingPaymentMethod(msg, session);

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'CASH_ON_DELIVERY' }));
    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'ORDER_IN_KITCHEN',
      expect.any(Object),
    );
  });

  it('rejects cash payment for delivery', async () => {
    const { whatsappClient } = require('../whatsapp/client');
    const session = makeSession({ deliveryType: 'DELIVERY' });
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'pay_cash', title: 'Efectivo' },
    });

    await handleAwaitingPaymentMethod(msg, session);

    expect(updateSessionState).not.toHaveBeenCalled();
    expect(whatsappClient.sendMessage).toHaveBeenCalled();
  });
});

// ── AWAITING_PAYMENT_PROOF ────────────────────────────────────────────────────

describe('AWAITING_PAYMENT_PROOF handler', () => {
  const { updateSessionState } = require('../redis/session-manager');
  const { updateOrderStatus } = require('../orders/order-service');
  const { notifyPaymentReceived } = require('../notifications/admin-notifier');

  beforeEach(() => jest.clearAllMocks());

  it('accepts image, enqueues OCR, and transitions to PAYMENT_UNDER_REVIEW', async () => {
    const { ocrQueue } = require('../workers/queues');
    const session = makeSession({ activeOrderId: 'order-uuid-1234567890ab', deliveryType: 'PICKUP' });
    const msg = makeMsg({ type: 'image', imageId: 'media-id-123' });

    await handleAwaitingPaymentProof(msg, session);

    expect(updateOrderStatus).toHaveBeenCalledWith(
      'order-uuid-1234567890ab',
      'PAYMENT_UPLOADED',
      expect.objectContaining({ paymentImageUrl: 'wa_media:media-id-123' }),
    );
    // Image path: OCR queued, NOT notifyPaymentReceived (that's the OCR worker's job)
    expect(ocrQueue.add).toHaveBeenCalledWith(
      'ocr-payment',
      expect.objectContaining({ mediaId: 'media-id-123', orderId: 'order-uuid-1234567890ab' }),
      expect.any(Object),
    );
    expect(notifyPaymentReceived).not.toHaveBeenCalled();
    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'PAYMENT_UNDER_REVIEW',
      expect.any(Object),
    );
  });

  it('accepts valid reference number and transitions to PAYMENT_UNDER_REVIEW', async () => {
    const session = makeSession({ activeOrderId: 'order-uuid-1234567890ab', deliveryType: 'PICKUP' });
    const msg = makeMsg({ type: 'text', text: 'Mi referencia es 123456789012345' });

    await handleAwaitingPaymentProof(msg, session);

    expect(updateOrderStatus).toHaveBeenCalledWith(
      'order-uuid-1234567890ab',
      'PAYMENT_UPLOADED',
      expect.objectContaining({ paymentReference: expect.any(String) }),
    );
    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'PAYMENT_UNDER_REVIEW',
      expect.any(Object),
    );
  });

  it('rejects text without valid reference', async () => {
    const { whatsappClient } = require('../whatsapp/client');
    const session = makeSession({ activeOrderId: 'order-uuid-1234567890ab', deliveryType: 'PICKUP' });
    const msg = makeMsg({ type: 'text', text: 'ya pagué' });

    await handleAwaitingPaymentProof(msg, session);

    expect(updateSessionState).not.toHaveBeenCalled();
    expect(whatsappClient.sendMessage).toHaveBeenCalled();
  });

  it('handles cancel text', async () => {
    const session = makeSession({ activeOrderId: 'order-uuid-1234567890ab', deliveryType: 'PICKUP' });
    const msg = makeMsg({ type: 'text', text: 'cancelar' });

    await handleAwaitingPaymentProof(msg, session);

    expect(updateOrderStatus).toHaveBeenCalledWith(
      'order-uuid-1234567890ab',
      'CANCELLED',
      expect.any(Object),
    );
    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'MAIN_MENU',
      expect.any(Object),
    );
  });
});

// ── PAYMENT_UNDER_REVIEW ──────────────────────────────────────────────────────

describe('PAYMENT_UNDER_REVIEW handler', () => {
  const { updateSessionState } = require('../redis/session-manager');

  beforeEach(() => jest.clearAllMocks());

  it('returns same session on any message (passive state)', async () => {
    const session = makeSession({ state: 'PAYMENT_UNDER_REVIEW', activeOrderId: 'order-uuid-1234567890ab' });
    const msg = makeMsg({ type: 'text', text: 'cuándo confirman?' });

    await handlePaymentUnderReview(msg, session);

    expect(updateSessionState).not.toHaveBeenCalled();
  });

  it('allows cancel', async () => {
    const session = makeSession({ state: 'PAYMENT_UNDER_REVIEW', activeOrderId: 'order-uuid-1234567890ab' });
    const msg = makeMsg({ type: 'text', text: 'cancelar' });

    await handlePaymentUnderReview(msg, session);

    expect(updateSessionState).toHaveBeenCalledWith('14155551234', 'MAIN_MENU', expect.any(Object));
  });
});

// ── ORDER_IN_KITCHEN ──────────────────────────────────────────────────────────

describe('ORDER_IN_KITCHEN handler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stays passive for general messages', async () => {
    const { updateSessionState } = require('../redis/session-manager');
    const session = makeSession({ state: 'ORDER_IN_KITCHEN', activeOrderId: 'order-uuid-1234567890ab' });
    const msg = makeMsg({ type: 'text', text: 'cuánto falta?' });

    await handleOrderInKitchen(msg, session);

    expect(updateSessionState).not.toHaveBeenCalled();
  });

  it('responds to estado query', async () => {
    const { whatsappClient } = require('../whatsapp/client');
    const session = makeSession({ state: 'ORDER_IN_KITCHEN', activeOrderId: 'order-uuid-1234567890ab' });
    const msg = makeMsg({ type: 'text', text: 'estado' });

    await handleOrderInKitchen(msg, session);

    expect(whatsappClient.sendMessage).toHaveBeenCalled();
  });
});

// ── ADMIN_MODE ────────────────────────────────────────────────────────────────

describe('ADMIN_MODE handler', () => {
  const { whatsappClient } = require('../whatsapp/client');
  const { updateSessionState } = require('../redis/session-manager');

  beforeEach(() => jest.clearAllMocks());

  it('shows help on /help command', async () => {
    const session = makeSession({ state: 'ADMIN_MODE' });
    const msg = makeMsg({ type: 'text', text: '/help' });

    await handleAdminMode(msg, session);

    expect(whatsappClient.sendMessage).toHaveBeenCalled();
  });

  it('updates exchange rate on /tasa command', async () => {
    const { setConfig } = require('../menu/config-service');
    const session = makeSession({ state: 'ADMIN_MODE' });
    const msg = makeMsg({ type: 'text', text: '/tasa 38.50' });

    await handleAdminMode(msg, session);

    expect(setConfig).toHaveBeenCalledWith('USD_TO_BS_RATE', '38.5');
  });

  it('confirms payment when admin clicks confirm button', async () => {
    const { getSession } = require('../redis/session-manager');
    getSession.mockResolvedValue({
      state: 'PAYMENT_UNDER_REVIEW',
      customerId: 'cust-1',
      cart: [],
      activeOrderId: 'order-uuid-1234567890ab',
    });

    const session = makeSession({ state: 'ADMIN_MODE' });
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'confirm_payment:order-uuid-1234567890ab', title: 'Confirmar' },
    });

    await handleAdminMode(msg, session);

    const { updateOrderStatus } = require('../orders/order-service');
    expect(updateOrderStatus).toHaveBeenCalledWith('order-uuid-1234567890ab', 'PAYMENT_CONFIRMED');
    // Should notify customer
    expect(whatsappClient.sendMessage).toHaveBeenCalledTimes(2);
    // Customer session updated
    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'ORDER_IN_KITCHEN',
      expect.any(Object),
    );
  });

  it('rejects payment when admin clicks reject button', async () => {
    const { getSession } = require('../redis/session-manager');
    getSession.mockResolvedValue({
      state: 'PAYMENT_UNDER_REVIEW',
      customerId: 'cust-1',
      cart: [],
      activeOrderId: 'order-uuid-1234567890ab',
    });

    const session = makeSession({ state: 'ADMIN_MODE' });
    const msg = makeMsg({
      type: 'interactive',
      interactiveReply: { id: 'reject_payment:order-uuid-1234567890ab', title: 'Rechazar' },
    });

    await handleAdminMode(msg, session);

    const { updateOrderStatus } = require('../orders/order-service');
    expect(updateOrderStatus).toHaveBeenCalledWith(
      'order-uuid-1234567890ab',
      'PAYMENT_REJECTED',
      expect.any(Object),
    );
    expect(updateSessionState).toHaveBeenCalledWith(
      '14155551234',
      'AWAITING_PAYMENT_PROOF',
      expect.any(Object),
    );
  });
});
