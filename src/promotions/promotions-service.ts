/**
 * Motor de promociones.
 *
 * Una promoción está activa si:
 *   1. isActive = true en DB
 *   2. El día de la semana actual está en activeDays (0=Dom, 6=Sáb)
 *   3. La hora actual está dentro de [startTime, endTime] si ambas están definidas
 *   4. O isManuallyActive = true (override manual del admin)
 *
 * Tipos de descuento:
 *   PERCENT — % sobre ítems aplicables (o todo el carrito si applicableItemIds = [])
 *   FIXED   — monto fijo USD sobre el total
 *   COMBO   — tratado igual que FIXED (precio combo especial)
 */
import type { Promotion } from '@prisma/client';
import { prisma } from '../db/prisma';
import { getExchangeRate, usdToBs } from '../menu/config-service';
import type { CartItem } from '../redis/session-manager';
import { logger } from '../utils/logger';

export interface DiscountResult {
  promotion: Promotion;
  discountUsd: number;
  discountBs: number;
  originalTotalUsd: number;
  finalTotalUsd: number;
  finalTotalBs: number;
}

// ─── Verificar si una promoción está activa ahora ─────────────────────────────

export function isPromotionActiveNow(promo: Promotion, now = new Date()): boolean {
  if (!promo.isActive) return false;

  // Override manual del admin: activa independientemente del horario
  if (promo.isManuallyActive) return true;

  const activeDays = promo.activeDays as number[];
  const dayOfWeek = now.getDay(); // 0=Dom, 6=Sáb
  if (!activeDays.includes(dayOfWeek)) return false;

  // Verificar ventana horaria si está definida
  if (promo.startTime && promo.endTime) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = promo.startTime.split(':').map(Number);
    const [eh, em] = promo.endTime.split(':').map(Number);
    const startMinutes = (sh ?? 0) * 60 + (sm ?? 0);
    const endMinutes = (eh ?? 0) * 60 + (em ?? 0);
    if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return false;
  }

  return true;
}

// ─── Obtener promociones activas ahora ────────────────────────────────────────

export async function getActivePromotions(): Promise<Promotion[]> {
  const all = await prisma.promotion.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return all.filter((p) => isPromotionActiveNow(p));
}

// ─── Calcular descuento de una promoción sobre un carrito ─────────────────────

export function calculateDiscount(
  cart: CartItem[],
  promo: Promotion,
): { discountUsd: number; affectedItemNames: string[] } {
  const discountValue = parseFloat(promo.discountValue.toString());
  const applicableIds = promo.applicableItemIds as string[];
  const appliesToAll = applicableIds.length === 0;

  const applicableItems = appliesToAll
    ? cart
    : cart.filter((i) => applicableIds.includes(i.menuItemId));

  const applicableSubtotal = applicableItems.reduce(
    (s, i) => s + i.quantity * i.unitPriceUsd,
    0,
  );

  let discountUsd = 0;

  switch (promo.discountType) {
    case 'PERCENT':
      discountUsd = applicableSubtotal * (discountValue / 100);
      break;
    case 'FIXED':
    case 'COMBO':
      discountUsd = Math.min(discountValue, applicableSubtotal);
      break;
  }

  return {
    discountUsd: Math.round(discountUsd * 100) / 100, // 2 decimal places
    affectedItemNames: applicableItems.map((i) => i.name),
  };
}

// ─── Aplicar la mejor promoción activa al carrito ────────────────────────────

export async function applyBestPromotion(cart: CartItem[]): Promise<DiscountResult | null> {
  if (cart.length === 0) return null;

  const activePromos = await getActivePromotions();
  if (activePromos.length === 0) return null;

  const rate = await getExchangeRate();
  const originalTotalUsd = cart.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0);

  let best: DiscountResult | null = null;

  for (const promo of activePromos) {
    const { discountUsd } = calculateDiscount(cart, promo);
    if (discountUsd <= 0) continue;

    const finalTotalUsd = Math.max(0, originalTotalUsd - discountUsd);
    const discountBs = usdToBs(discountUsd, rate);
    const finalTotalBs = usdToBs(finalTotalUsd, rate);

    if (!best || discountUsd > best.discountUsd) {
      best = { promotion: promo, discountUsd, discountBs, originalTotalUsd, finalTotalUsd, finalTotalBs };
    }
  }

  if (best) {
    logger.debug(
      { promoId: best.promotion.id, discountUsd: best.discountUsd },
      'Best promotion applied',
    );
  }

  return best;
}

// ─── Formato WhatsApp ─────────────────────────────────────────────────────────

export function formatPromotionsText(promos: Promotion[], rate: number): string {
  if (promos.length === 0) return '😔 No hay promociones activas en este momento.';

  const lines = promos.map((p) => {
    const discountValue = parseFloat(p.discountValue.toString());
    let discountText = '';
    switch (p.discountType) {
      case 'PERCENT':
        discountText = `${discountValue}% de descuento`;
        break;
      case 'FIXED':
        discountText = `$${discountValue.toFixed(2)} de descuento (Bs ${usdToBs(discountValue, rate).toFixed(2)})`;
        break;
      case 'COMBO':
        discountText = `Precio combo especial`;
        break;
    }
    const timeText =
      p.startTime && p.endTime ? ` ⏰ ${p.startTime} – ${p.endTime}` : '';
    return `🎁 *${p.title}*\n${p.description ?? ''}\n💰 ${discountText}${timeText}`;
  });

  return `✨ *Promociones activas:*\n\n${lines.join('\n\n')}`;
}
