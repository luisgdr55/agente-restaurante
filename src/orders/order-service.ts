/**
 * Ciclo de vida de órdenes: creación, actualización de estado, consulta.
 * Los precios en USD se guardan en DB; el total en Bs se recalcula con la tasa del momento.
 */
import type { Order, OrderItem, OrderStatus, PaymentMethod } from '@prisma/client';
import { prisma } from '../db/prisma';
import { getExchangeRate, usdToBs, getConfig } from '../menu/config-service';
import { logger } from '../utils/logger';
import type { CartItem } from '../redis/session-manager';
import { emitOrderNew, emitOrderUpdated, emitStatsUpdated } from '../websocket/socket-server';
import { sendPushToPhone } from '../notifications/push-service';
import { redisClient } from '../redis/client';
import { getSession, updateSessionState } from '../redis/session-manager';

// Replaces paymentImageUrl (large base64) with hasPaymentImage boolean for socket events
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripPaymentImage(order: any) {
  const { paymentImageUrl, ...rest } = order;
  return { ...rest, hasPaymentImage: Boolean(paymentImageUrl) };
}

export interface CreateOrderInput {
  customerId: string;
  cart: CartItem[];
  deliveryType: 'DELIVERY' | 'PICKUP';
  deliveryAddress?: string;
  deliveryReference?: string;
  paymentMethod: PaymentMethod;
  notes?: string;
  discountUsd?: number;
  promotionId?: string;
  deliveryFeeUsd?: number; // incluido en totalUsd/totalBs si es DELIVERY
  paymentImageUrl?: string; // base64 data URL del comprobante de pago
}

export interface OrderSummary {
  id: string;
  shortId: string;         // últimos 6 chars del UUID para mostrar al usuario
  status: OrderStatus;
  totalBs: number;
  totalUsd: number;
  deliveryType: 'DELIVERY' | 'PICKUP';
  paymentMethod: PaymentMethod;
  items: Array<{ name: string; quantity: number; subtotalBs: number }>;
}

// ─── Crear orden ──────────────────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const rate = await getExchangeRate();
  const grossUsd = input.cart.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0);
  const discountUsd = input.discountUsd ?? 0;
  const deliveryFeeUsd = input.deliveryFeeUsd ?? 0;
  const totalUsd = Math.max(0, grossUsd - discountUsd) + deliveryFeeUsd;
  const totalBs = usdToBs(totalUsd, rate);
  const discountBs = discountUsd > 0 ? usdToBs(discountUsd, rate) : 0;

  const order = await prisma.order.create({
    data: {
      customerId: input.customerId,
      status: 'PENDING_PAYMENT',
      deliveryType: input.deliveryType,
      ...(input.deliveryAddress !== undefined && { deliveryAddress: input.deliveryAddress }),
      ...(input.deliveryReference !== undefined && { deliveryReference: input.deliveryReference }),
      totalUsd: totalUsd.toString(),
      totalBs: totalBs.toString(),
      exchangeRateUsed: rate.toString(),
      paymentMethod: input.paymentMethod,
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(discountUsd > 0 && { discountUsd: discountUsd.toString(), discountBs: discountBs.toString() }),
      ...(input.promotionId !== undefined && { promotionId: input.promotionId }),
      ...(input.paymentImageUrl !== undefined && { paymentImageUrl: input.paymentImageUrl }),
      items: {
        create: input.cart.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          unitPriceUsd: item.unitPriceUsd.toString(),
          unitPriceBs: usdToBs(item.unitPriceUsd, rate).toString(),
          subtotalBs: usdToBs(item.quantity * item.unitPriceUsd, rate).toString(),
        })),
      },
    },
  });

  logger.info(
    { orderId: order.id, totalBs, totalUsd, discountUsd, customerId: input.customerId },
    'Order created',
  );

  // Emitir con relaciones para que el dashboard pueda renderizar customer e items
  const fullOrder = await prisma.order.findUnique({
    where: { id: order.id },
    include: { customer: true, items: { include: { menuItem: true } } },
  });
  emitOrderNew(stripPaymentImage(fullOrder ?? order));
  return order;
}

// ─── Actualizar estado ────────────────────────────────────────────────────────

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  extra?: {
    paymentReference?: string;
    paymentImageUrl?: string;
    deliveredAt?: Date;
    cancelReason?: string;
  },
): Promise<Order> {
  const data: Parameters<typeof prisma.order.update>[0]['data'] = { status };

  if (extra?.paymentReference !== undefined) data.paymentReference = extra.paymentReference;
  if (extra?.paymentImageUrl !== undefined) data.paymentImageUrl = extra.paymentImageUrl;
  if (extra?.deliveredAt !== undefined) data.deliveredAt = extra.deliveredAt;
  if (status === 'READY') data.completedAt = new Date(); // cierre de métricas en cocina
  if (status === 'CANCELLED') data.cancelledAt = new Date();
  if (extra?.cancelReason !== undefined) data.cancelReason = extra.cancelReason;

  const order = await prisma.order.update({
    where: { id: orderId },
    data,
    include: { customer: true, items: { include: { menuItem: true } } },
  });
  logger.info({ orderId, status }, 'Order status updated');
  emitOrderUpdated(stripPaymentImage(order));
  void emitTodayStats(); // non-blocking — actualiza el panel de stats en el dashboard

  // ─── Push notifications al cliente ───────────────────────────────────────
  const phone = order.customer.phone;
  if (status === 'PAYMENT_CONFIRMED') {
    void sendPushToPhone(phone, '✅ Pago confirmado', 'Tu pedido está en cocina 🍳');
  } else if (status === 'READY') {
    void sendPushToPhone(phone, '🍗 Pedido listo', 'Tu pedido está listo y sale en camino pronto');
  } else if (status === 'OUT_FOR_DELIVERY') {
    void sendPushToPhone(phone, '🛵 En camino', 'Tu pedido va en camino a tu dirección');
  } else if (status === 'DELIVERED') {
    void sendPushToPhone(phone, '✅ Entregado', '¡Tu pedido llegó! Gracias por preferirnos 🙏', `/review/${orderId}`);
  }

  return order as unknown as Order;
}

// ─── Stats helper (compartido con dashboard) ──────────────────────────────────

export async function emitTodayStats(): Promise<void> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, delivered, cancelled, inProgress, revenue, rateConfig] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      // "delivered" = completedAt set (cocina marcó listo) — DELIVERED solo archiva
      prisma.order.count({ where: { createdAt: { gte: today }, completedAt: { not: null } } }),
      prisma.order.count({ where: { createdAt: { gte: today }, status: 'CANCELLED' } }),
      prisma.order.count({
        where: { createdAt: { gte: today }, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
      }),
      prisma.order.aggregate({
        where: { createdAt: { gte: today }, completedAt: { not: null } },
        _sum: { totalBs: true },
      }),
      prisma.systemConfig.findUnique({ where: { key: 'USD_TO_BS_RATE' } }),
    ]);

    const revenueBs = Number(revenue._sum.totalBs ?? 0);
    const rate = rateConfig ? parseFloat(rateConfig.value) : 1;
    const revenueUsd = rate > 0 ? revenueBs / rate : 0;

    emitStatsUpdated({ totalOrders: total, delivered, cancelled, inProgress, revenueBs, revenueUsd });
  } catch {
    // Non-critical — no bloquear el flujo principal
  }
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export async function wasRecentDriverPhone(phone: string, hoursAgo = 24): Promise<boolean> {
  const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const count = await prisma.order.count({
    where: {
      driverPhone: phone,
      status: 'DELIVERED',
      deliveredAt: { gte: since },
    },
  });
  return count > 0;
}

export async function getOrderById(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true },
  });
}

/**
 * Busca una orden por su short ID (últimos 6 caracteres del UUID, case-insensitive).
 * Retorna la más reciente si hay colisión (extremadamente improbable).
 */
/**
 * Busca una orden por su número amigable (ej. "1", "0001") o por los últimos
 * 6 caracteres del UUID (formato legado, case-insensitive).
 */
export async function findOrderByShortId(shortIdOrNumber: string) {
  // Si es puramente numérico → buscar por orderNumber
  if (/^\d+$/.test(shortIdOrNumber)) {
    return prisma.order.findFirst({
      where: { orderNumber: parseInt(shortIdOrNumber, 10) },
      include: { customer: true },
    });
  }

  // Formato legado: últimos 6 chars del UUID
  const lower = shortIdOrNumber.toLowerCase();
  const orders = await prisma.order.findMany({
    where: { id: { endsWith: lower } },
    include: { customer: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  return orders[0] ?? null;
}

export async function getOrderWithItems(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { menuItem: true } }, customer: true },
  });
}

/**
 * Busca una orden activa en OUT_FOR_DELIVERY asociada al teléfono del motorizado.
 * Retorna null si el número no es un motorizado con entrega en curso.
 */
export async function findActiveDeliveryByDriverPhone(driverPhone: string) {
  return prisma.order.findFirst({
    where: { driverPhone, status: 'OUT_FOR_DELIVERY' },
    include: {
      customer: true,
      driver: true,
      items: { include: { menuItem: true } },
    },
  });
}

export async function getActiveOrderForCustomer(customerId: string): Promise<Order | null> {
  return prisma.order.findFirst({
    where: {
      customerId,
      status: {
        notIn: ['DELIVERED', 'CANCELLED'],
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Helpers de presentación ──────────────────────────────────────────────────

export function shortOrderId(orderId: string): string {
  return orderId.slice(-6).toUpperCase();
}

/** Formats an order number as a zero-padded 4-digit string, e.g. 1 → "0001" */
export function friendlyOrderId(orderNumber: number): string {
  return String(orderNumber).padStart(4, '0');
}

// ─── Resumen de carrito (texto) ───────────────────────────────────────────────

export function buildCartSummary(items: Array<OrderItem & { menuItem: { name: string } }>): string {
  return items
    .map((i) => `${i.quantity}x ${i.menuItem.name}`)
    .join(', ');
}

// ─── Asignar motorizado ───────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('04') && digits.length === 11) return '58' + digits.slice(1);
  return digits;
}

export interface AssignDriverResult {
  order: Order;
  driverName: string;
  driverPhone: string;
  customerPhone: string;
  customerName: string;
  deliveryAddress: string;
  deliveryReference: string | null;
  restaurantName: string;
  adminPhone: string | null;
  isFirstContactToday: boolean;
}

export async function assignDriver(orderId: string, driverId: string): Promise<AssignDriverResult> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new Error('DRIVER_NOT_FOUND');

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true, items: { include: { menuItem: true } } },
  });
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (order.status !== 'AWAITING_DRIVER_ASSIGNMENT') throw new Error('ORDER_NOT_AWAITING_DRIVER');

  const driverPhone = normalizePhone(driver.phone);

  // Actualizar orden con driver y nuevo estado
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'OUT_FOR_DELIVERY',
      driverId: driver.id,
      driverPhone,
      deliveredAt: null,
    },
    include: { customer: true, items: { include: { menuItem: true } } },
  });

  emitOrderUpdated(updated);
  void emitTodayStats();

  // Actualizar sesión Redis del cliente
  const customerPhone = order.customer.phone;
  const customerSession = await getSession(customerPhone);
  if (customerSession) {
    await updateSessionState(customerPhone, 'ORDER_READY', {
      customerId: customerSession.customerId,
      cart: customerSession.cart,
      activeOrderId: order.id,
      deliveryType: 'DELIVERY',
      ...(order.driverPhone !== null && { driverPhone: order.driverPhone }),
    });
  }

  // Marcar si el motorizado ya fue contactado hoy (anti-spam)
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const driverContactKey = `driver:contacted:${driver.phone}:${today}`;
  const alreadyContacted = await redisClient.exists(driverContactKey);

  // TTL hasta medianoche Venezuela (UTC-4)
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const ttlSeconds = Math.floor((midnight.getTime() - now.getTime()) / 1000);
  if (!alreadyContacted) {
    await redisClient.setex(driverContactKey, ttlSeconds, '1');
  }

  const [restaurantName, adminPhone] = await Promise.all([
    getConfig('RESTAURANT_NAME'),
    getConfig('ADMIN_PHONE'),
  ]);

  logger.info({ orderId, driverId, alreadyContacted: Boolean(alreadyContacted) }, 'Driver assigned');

  return {
    order: updated as unknown as Order,
    driverName: driver.name,
    driverPhone,
    customerPhone,
    customerName: order.customer.name ?? customerPhone,
    deliveryAddress: order.deliveryAddress ?? '',
    deliveryReference: order.deliveryReference,
    restaurantName: restaurantName ?? 'el restaurante',
    adminPhone: adminPhone ?? null,
    isFirstContactToday: !alreadyContacted,
  };
}

export async function buildOrderSummary(
  cart: CartItem[],
  rate: number,
  deliveryType: 'DELIVERY' | 'PICKUP',
  paymentMethod: 'PAGO_MOVIL' | 'CASH_ON_DELIVERY',
): Promise<OrderSummary> {
  const totalUsd = cart.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0);
  const totalBs = usdToBs(totalUsd, rate);

  return {
    id: '',
    shortId: '',
    status: 'PENDING_PAYMENT',
    totalBs,
    totalUsd,
    deliveryType,
    paymentMethod,
    items: cart.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      subtotalBs: usdToBs(i.quantity * i.unitPriceUsd, rate),
    })),
  };
}

