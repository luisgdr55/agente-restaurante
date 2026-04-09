/**
 * Tests for the promotions engine (Step 9).
 * Pure logic tests for isPromotionActiveNow, calculateDiscount, formatPromotionsText.
 */

// Mocks must be at top level (hoisted by Jest before imports)
jest.mock('../db/prisma', () => ({
  prisma: {
    promotion: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));
jest.mock('../menu/config-service', () => ({
  getExchangeRate: jest.fn().mockResolvedValue(36),
  usdToBs: jest.fn((usd: number, rate: number) => usd * rate),
}));

import {
  isPromotionActiveNow,
  calculateDiscount,
  formatPromotionsText,
  applyBestPromotion,
} from '../promotions/promotions-service';
import type { Promotion } from '@prisma/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePromo(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'promo-1',
    title: 'Happy Hour',
    description: '20% descuento',
    discountType: 'PERCENT',
    discountValue: '20' as any,
    applicableItemIds: [] as any,
    activeDays: [0, 1, 2, 3, 4, 5, 6] as any, // every day
    startTime: null,
    endTime: null,
    isManuallyActive: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as Promotion;
}

function makeCart() {
  return [
    { menuItemId: 'item-1', name: 'Hamburguesa', quantity: 2, unitPriceUsd: 2.50 },
    { menuItemId: 'item-2', name: 'Refresco',    quantity: 1, unitPriceUsd: 1.00 },
  ];
}

// ── isPromotionActiveNow ──────────────────────────────────────────────────────

describe('isPromotionActiveNow', () => {
  it('returns true for active promo with no time restriction', () => {
    const promo = makePromo();
    expect(isPromotionActiveNow(promo)).toBe(true);
  });

  it('returns false when isActive = false', () => {
    const promo = makePromo({ isActive: false });
    expect(isPromotionActiveNow(promo)).toBe(false);
  });

  it('returns true when isManuallyActive overrides schedule', () => {
    const promo = makePromo({
      isManuallyActive: true,
      activeDays: [1] as any, // Monday only
    });
    // Sunday
    const sunday = new Date('2024-01-07T10:00:00'); // a Sunday
    expect(isPromotionActiveNow(promo, sunday)).toBe(true);
  });

  it('returns false when today is not in activeDays', () => {
    const promo = makePromo({
      activeDays: [1, 2, 3, 4, 5] as any, // weekdays only
    });
    const sunday = new Date('2024-01-07T10:00:00'); // a Sunday (day 0)
    expect(isPromotionActiveNow(promo, sunday)).toBe(false);
  });

  it('returns true when within time window', () => {
    const promo = makePromo({ startTime: '17:00', endTime: '19:00' });
    const date = new Date('2024-01-08T17:30:00'); // Monday 5:30pm
    expect(isPromotionActiveNow(promo, date)).toBe(true);
  });

  it('returns false when outside time window (before)', () => {
    const promo = makePromo({ startTime: '17:00', endTime: '19:00' });
    const date = new Date('2024-01-08T16:59:00'); // 4:59pm Monday
    expect(isPromotionActiveNow(promo, date)).toBe(false);
  });

  it('returns false when outside time window (after)', () => {
    const promo = makePromo({ startTime: '17:00', endTime: '19:00' });
    const date = new Date('2024-01-08T19:01:00'); // 7:01pm Monday
    expect(isPromotionActiveNow(promo, date)).toBe(false);
  });

  it('returns true at exact start time', () => {
    const promo = makePromo({ startTime: '17:00', endTime: '19:00' });
    const date = new Date('2024-01-08T17:00:00'); // exactly 5pm Monday
    expect(isPromotionActiveNow(promo, date)).toBe(true);
  });
});

// ── calculateDiscount ─────────────────────────────────────────────────────────

describe('calculateDiscount', () => {
  const cart = makeCart(); // subtotal = 2*2.50 + 1*1.00 = 6.00 USD

  it('calculates PERCENT discount on all items', () => {
    const promo = makePromo({ discountType: 'PERCENT', discountValue: '20' as any });
    const { discountUsd } = calculateDiscount(cart, promo);
    expect(discountUsd).toBeCloseTo(1.20, 2); // 20% of $6.00
  });

  it('calculates PERCENT discount on specific items only', () => {
    const promo = makePromo({
      discountType: 'PERCENT',
      discountValue: '50' as any,
      applicableItemIds: ['item-1'] as any, // only Hamburguesa
    });
    const { discountUsd, affectedItemNames } = calculateDiscount(cart, promo);
    expect(discountUsd).toBeCloseTo(2.50, 2); // 50% of 2*$2.50 = $5.00
    expect(affectedItemNames).toContain('Hamburguesa');
    expect(affectedItemNames).not.toContain('Refresco');
  });

  it('calculates FIXED discount', () => {
    const promo = makePromo({ discountType: 'FIXED', discountValue: '1.50' as any });
    const { discountUsd } = calculateDiscount(cart, promo);
    expect(discountUsd).toBe(1.50);
  });

  it('caps FIXED discount at item subtotal', () => {
    const promo = makePromo({ discountType: 'FIXED', discountValue: '100' as any });
    const { discountUsd } = calculateDiscount(cart, promo);
    expect(discountUsd).toBe(6.00); // capped at cart total
  });

  it('calculates COMBO discount same as FIXED', () => {
    const promo = makePromo({ discountType: 'COMBO', discountValue: '2.00' as any });
    const { discountUsd } = calculateDiscount(cart, promo);
    expect(discountUsd).toBe(2.00);
  });

  it('returns zero discount when no applicable items match cart', () => {
    const promo = makePromo({
      discountType: 'PERCENT',
      discountValue: '20' as any,
      applicableItemIds: ['item-99'] as any, // item not in cart
    });
    const { discountUsd } = calculateDiscount(cart, promo);
    expect(discountUsd).toBe(0);
  });
});

// ── formatPromotionsText ──────────────────────────────────────────────────────

describe('formatPromotionsText', () => {
  const rate = 36;

  it('shows "no hay promociones" when empty', () => {
    const text = formatPromotionsText([], rate);
    expect(text).toContain('No hay promociones');
  });

  it('formats PERCENT promo with title and discount', () => {
    const promo = makePromo({ title: 'Happy Hour', discountType: 'PERCENT', discountValue: '20' as any });
    const text = formatPromotionsText([promo], rate);
    expect(text).toContain('Happy Hour');
    expect(text).toContain('20%');
  });

  it('formats FIXED promo with USD and Bs amount', () => {
    const promo = makePromo({ title: 'Promo Fija', discountType: 'FIXED', discountValue: '2' as any });
    const text = formatPromotionsText([promo], rate);
    expect(text).toContain('$2.00');
    expect(text).toContain('Bs 72.00'); // 2 * 36
  });

  it('includes time window when defined', () => {
    const promo = makePromo({ startTime: '17:00', endTime: '19:00' });
    const text = formatPromotionsText([promo], rate);
    expect(text).toContain('17:00');
    expect(text).toContain('19:00');
  });

  it('formats multiple promotions', () => {
    const promos = [
      makePromo({ id: 'p1', title: 'Happy Hour' }),
      makePromo({ id: 'p2', title: 'Lunes de descuento', discountType: 'FIXED', discountValue: '1' as any }),
    ];
    const text = formatPromotionsText(promos, rate);
    expect(text).toContain('Happy Hour');
    expect(text).toContain('Lunes de descuento');
  });
});

// ── Integration: applyBestPromotion (mocked DB) ───────────────────────────────

describe('applyBestPromotion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null for empty cart', async () => {
    const result = await applyBestPromotion([]);
    expect(result).toBeNull();
  });

  it('returns null when no active promotions', async () => {
    const { prisma } = require('../db/prisma');
    prisma.promotion.findMany.mockResolvedValue([]);

    const result = await applyBestPromotion(makeCart());
    expect(result).toBeNull();
  });

  it('applies the promotion with highest discount', async () => {
    const { prisma } = require('../db/prisma');
    prisma.promotion.findMany.mockResolvedValue([
      makePromo({ id: 'p1', discountType: 'PERCENT', discountValue: '10' as any }),
      makePromo({ id: 'p2', discountType: 'PERCENT', discountValue: '20' as any }),
    ]);

    const result = await applyBestPromotion(makeCart());

    expect(result).not.toBeNull();
    expect(result!.promotion.id).toBe('p2'); // 20% beats 10%
    expect(result!.discountUsd).toBeCloseTo(1.20, 2); // 20% of $6.00
    expect(result!.finalTotalUsd).toBeCloseTo(4.80, 2);
  });

  it('skips promos with zero discount (items not in cart)', async () => {
    const { prisma } = require('../db/prisma');
    prisma.promotion.findMany.mockResolvedValue([
      makePromo({
        id: 'p1',
        discountType: 'PERCENT',
        discountValue: '20' as any,
        applicableItemIds: ['item-99'] as any, // not in cart
      }),
    ]);

    const result = await applyBestPromotion(makeCart());
    expect(result).toBeNull(); // no valid discount
  });
});
