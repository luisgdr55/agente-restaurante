import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import jwt from 'jsonwebtoken';
import { emitOrderUpdated, emitStatsUpdated, emitConfigUpdated, emitMenuUpdated } from '../websocket/socket-server';
import { getTopCustomers, getCustomerStats } from '../customers/customer-stats';
import { invalidateConfigCache, invalidateMenuCache, getConfig } from '../menu/config-service';
import { createOrder, updateOrderStatus, emitTodayStats } from '../orders/order-service';
import { sendPushToPhone } from '../notifications/push-service';
import {
  getDayPromos, addDayPromo, updateDayPromo, removeDayPromo, clearDayPromos,
  getPromoDays, setPromoDays,
} from '../menu/promo-day-service';
import { getSession, updateSessionState } from '../redis/session-manager';
import { logger } from '../utils/logger';

async function verifyJwt(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Unauthorized' });
  try {
    jwt.verify(auth.slice(7), env.JWT_SECRET);
  } catch {
    return reply.code(401).send({ error: 'Invalid token' });
  }
}

function normalizeDriverPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('04') && digits.length === 11) return '58' + digits.slice(1);
  return digits;
}

function getTokenRole(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(auth.slice(7), env.JWT_SECRET) as { role?: string };
    return decoded.role ?? null;
  } catch {
    return null;
  }
}

// All Order scalar fields except paymentImageUrl (large base64 blob).
// Used in list queries to avoid fetching MBs of image data per request.
const ORDER_SCALAR_SELECT = {
  id: true, customerId: true, status: true, deliveryType: true,
  deliveryAddress: true, deliveryReference: true, deliveryZone: true,
  totalUsd: true, totalBs: true, exchangeRateUsed: true,
  paymentMethod: true, paymentReference: true,
  notes: true, discountUsd: true, discountBs: true, promotionId: true,
  createdAt: true, updatedAt: true, completedAt: true,
  deliveredAt: true, cancelledAt: true, cancelReason: true,
  orderNumber: true, driverId: true, driverPhone: true,
} as const;

export async function dashboardRoutes(app: FastifyInstance) {
  // For single-record mutations (update/create): strips paymentImageUrl blob, adds hasPaymentImage boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function serializeOrder(order: any) {
    const { paymentImageUrl, ...o } = order;
    const hasPaymentImage = Boolean(paymentImageUrl);
    logger.debug({ orderId: o.id, hasPaymentImage, urlPrefix: paymentImageUrl?.substring(0, 20) }, '[proof] serializeOrder');
    return { ...o, hasPaymentImage };
  }

  // For list queries: fetches orders WITHOUT the blob, probes hasPaymentImage in parallel.
  // select instead of include avoids loading paymentImageUrl from PostgreSQL entirely.
  async function listOrders(
    where: Prisma.OrderWhereInput,
    orderBy: Prisma.OrderOrderByWithRelationInput = { createdAt: 'desc' },
  ) {
    const [orders, withProof] = await Promise.all([
      prisma.order.findMany({
        where,
        select: {
          ...ORDER_SCALAR_SELECT,
          customer: true,
          items: { include: { menuItem: true } },
        },
        orderBy,
      }),
      prisma.order.findMany({
        where: { ...where, paymentImageUrl: { not: null } },
        select: { id: true },
      }),
    ]);
    const proofSet = new Set(withProof.map((o) => o.id));
    return orders.map((o) => ({ ...o, hasPaymentImage: proofSet.has(o.id) }));
  }

  // GET /api/orders — active orders (not DELIVERED/CANCELLED)
  app.get('/api/orders', { preHandler: verifyJwt }, async (_req, reply) => {
    return reply.send(await listOrders({ status: { notIn: ['DELIVERED', 'CANCELLED'] } }));
  });

  // GET /api/orders/today — all orders from today (midnight Venezuela UTC-4)
  app.get('/api/orders/today', { preHandler: verifyJwt }, async (_req, reply) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return reply.send(await listOrders({ createdAt: { gte: today } }));
  });

  // GET /api/orders/kitchen — orders visible to kitchen (IN_KITCHEN + PAYMENT_CONFIRMED)
  app.get('/api/orders/kitchen', { preHandler: verifyJwt }, async (_req, reply) => {
    return reply.send(await listOrders({ status: { in: ['PAYMENT_CONFIRMED', 'IN_KITCHEN'] } }, { createdAt: 'asc' }));
  });

  // GET /api/stats — today's stats
  app.get('/api/stats', { preHandler: verifyJwt }, async (_req, _reply) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalOrders, delivered, cancelled, inProgress, revenue, rateConfig] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.order.count({ where: { createdAt: { gte: today }, status: 'DELIVERED' } }),
      prisma.order.count({ where: { createdAt: { gte: today }, status: 'CANCELLED' } }),
      prisma.order.count({
        where: {
          createdAt: { gte: today },
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
        },
      }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: today },
          status: { in: ['DELIVERED', 'PAYMENT_CONFIRMED'] },
        },
        _sum: { totalBs: true },
      }),
      prisma.systemConfig.findUnique({ where: { key: 'USD_TO_BS_RATE' } }),
    ]);

    const revenueBs = Number(revenue._sum.totalBs ?? 0);
    const rate = rateConfig ? parseFloat(rateConfig.value) : 1;
    const revenueUsd = rate > 0 ? revenueBs / rate : 0;

    return { totalOrders, delivered, cancelled, inProgress, revenueBs, revenueUsd };
  });

  // PATCH /api/orders/:id/status — update order status + notify customer via WhatsApp
  app.patch<{ Params: { id: string }; Body: { status: string; reason?: string } }>(
    '/api/orders/:id/status',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id } = req.params;
      const { status, reason } = req.body;

      // Kitchen role may only mark orders as READY
      const role = getTokenRole(req);
      if (role === 'kitchen' && status !== 'READY') {
        return reply.code(403).send({ error: 'Kitchen can only set status to READY' });
      }

      try {
        const extraData: Record<string, unknown> = { status };
        if (status === 'CANCELLED') { extraData.cancelledAt = new Date(); extraData.cancelReason = reason ?? 'Cancelado desde dashboard'; }
        if (status === 'DELIVERED') extraData.deliveredAt = new Date();
        // READY: registrar completedAt (cierre de métricas en cocina)
        if (status === 'READY') extraData.completedAt = new Date();

        const order = await prisma.order.update({
          where: { id },
          data: extraData as never,
          include: { customer: true, items: { include: { menuItem: true } } },
        });
        emitOrderUpdated(serializeOrder(order));

        const customerPhone = order.customer.phone;
        const fId = String(order.orderNumber).padStart(4, '0');

        // ── Push notifications — always fire, independent of WhatsApp ──
        try {
          switch (status) {
            case 'PAYMENT_CONFIRMED':
              logger.info({ orderId: id, customerPhone }, '[push] firing PAYMENT_CONFIRMED');
              await sendPushToPhone(
                customerPhone,
                '✅ Pago confirmado',
                order.deliveryType === 'PICKUP' ? '👨‍🍳 Tu pedido se está preparando' : 'Tu pedido está en cocina 👨‍🍳',
                `/order/${order.id}`,
              );
              break;
            case 'PAYMENT_REJECTED':
              logger.info({ orderId: id, customerPhone }, '[push] firing PAYMENT_REJECTED');
              await sendPushToPhone(customerPhone, '❌ Pago no verificado', 'Tu pago no fue verificado. Toca para ver opciones', `/order/${order.id}`);
              break;
            case 'IN_KITCHEN': {
              const etaPush = parseInt((await getConfig('DELIVERY_ETA_MINUTES')) ?? '20', 10);
              logger.info({ orderId: id, customerPhone, etaPush }, '[push] firing IN_KITCHEN');
              await sendPushToPhone(customerPhone, '👨‍🍳 Tu pedido está en cocina', `Listo en aprox. ${etaPush} min`, `/order/${order.id}`);
              break;
            }
            case 'READY':
              logger.info({ orderId: id, customerPhone }, '[push] firing READY');
              await sendPushToPhone(
                customerPhone,
                order.deliveryType === 'PICKUP' ? '🏪 Pedido listo' : '🍗 Pedido listo',
                order.deliveryType === 'PICKUP'
                  ? '🏪 Tu pedido está listo, puedes pasar a retirarlo'
                  : 'Tu pedido está listo, sale en camino pronto 🛵',
                `/order/${order.id}`,
              );
              break;
            case 'OUT_FOR_DELIVERY':
              logger.info({ orderId: id, customerPhone }, '[push] firing OUT_FOR_DELIVERY');
              await sendPushToPhone(customerPhone, '🛵 Tu pedido va en camino', 'Tu pedido salió a tu dirección 🏠', `/order/${order.id}`);
              break;
            case 'DELIVERED':
              logger.info({ orderId: id, customerPhone }, '[push] firing DELIVERED');
              await sendPushToPhone(customerPhone, '✅ Entregado', 'Toca para dejarnos tu reseña ⭐', `/review/${order.id}`);
              break;
            case 'CANCELLED':
              logger.info({ orderId: id, customerPhone }, '[push] firing CANCELLED');
              await sendPushToPhone(customerPhone, '❌ Pedido cancelado', `Tu pedido #${fId} fue cancelado`);
              break;
          }
        } catch (err) {
          logger.error({ err, orderId: id, status, customerPhone }, '[push] sendPushToPhone failed');
        }

        // ── Sincronizar sesión Redis del cliente ─────────────────────────
        void (async () => {
          try {
            const customerPhone = order.customer.phone;
            const customerSession = await getSession(customerPhone);
            if (customerSession) {
              switch (status) {
                case 'PAYMENT_CONFIRMED':
                case 'IN_KITCHEN':
                  if (['PAYMENT_UNDER_REVIEW', 'AWAITING_PAYMENT_PROOF'].includes(customerSession.state)) {
                    await updateSessionState(customerPhone, 'ORDER_IN_KITCHEN', {
                      customerId: customerSession.customerId,
                      activeOrderId: order.id,
                    });
                  }
                  break;
                case 'READY':
                  // Ambos tipos → ORDER_READY (DELIVERY ya no pasa por AWAITING_DRIVER_ASSIGNMENT)
                  await updateSessionState(customerPhone, 'ORDER_READY', {
                    customerId: customerSession.customerId,
                    activeOrderId: order.id,
                  });
                  break;
                case 'PAYMENT_REJECTED':
                  await updateSessionState(customerPhone, 'AWAITING_PAYMENT_PROOF', {
                    customerId: customerSession.customerId,
                    activeOrderId: order.id,
                  });
                  break;
                case 'CANCELLED':
                  await updateSessionState(customerPhone, 'MAIN_MENU', {
                    customerId: customerSession.customerId,
                    cart: [],
                    activeOrderId: undefined,
                  });
                  break;
              }
            }
          } catch { /* non-critical — no afecta respuesta al admin */ }
        })();

        // ── Estadísticas actualizadas ────────────────────────────────────
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [totalOrders, delivered, cancelled, inProgress, revenue, rateConfig] = await Promise.all([
          prisma.order.count({ where: { createdAt: { gte: today } } }),
          prisma.order.count({ where: { createdAt: { gte: today }, status: 'DELIVERED' } }),
          prisma.order.count({ where: { createdAt: { gte: today }, status: 'CANCELLED' } }),
          prisma.order.count({
            where: { createdAt: { gte: today }, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
          }),
          prisma.order.aggregate({
            where: { createdAt: { gte: today }, status: { in: ['DELIVERED', 'PAYMENT_CONFIRMED'] } },
            _sum: { totalBs: true },
          }),
          prisma.systemConfig.findUnique({ where: { key: 'USD_TO_BS_RATE' } }),
        ]);
        const revenueBs = Number(revenue._sum.totalBs ?? 0);
        const rate = rateConfig ? parseFloat(rateConfig.value) : 1;
        const revenueUsd = rate > 0 ? revenueBs / rate : 0;
        emitStatsUpdated({ totalOrders, delivered, cancelled, inProgress, revenueBs, revenueUsd });

        return order;
      } catch {
        return reply.code(404).send({ error: 'Order not found' });
      }
    },
  );

  // ── Drivers ─────────────────────────────────────────────────────────────────

  // GET /api/drivers — list all drivers
  app.get('/api/drivers', { preHandler: verifyJwt }, async (_req, _reply) => {
    return prisma.driver.findMany({ orderBy: { createdAt: 'asc' } });
  });

  // POST /api/drivers — create driver
  app.post<{ Body: { name: string; phone: string } }>(
    '/api/drivers',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { name, phone } = req.body;
      if (!name?.trim() || !phone?.trim()) {
        return reply.code(400).send({ error: 'name and phone are required' });
      }
      try {
        return await prisma.driver.create({ data: { name: name.trim(), phone: normalizeDriverPhone(phone.trim()) } });
      } catch {
        return reply.code(409).send({ error: 'Phone already registered' });
      }
    },
  );

  // PATCH /api/drivers/:id — toggle isActive or update name/phone
  app.patch<{ Params: { id: string }; Body: { name?: string; phone?: string; isActive?: boolean } }>(
    '/api/drivers/:id',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id } = req.params;
      const { name, phone, isActive } = req.body;
      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name.trim();
      if (phone !== undefined) data.phone = normalizeDriverPhone(phone.trim());
      if (isActive !== undefined) data.isActive = isActive;
      try {
        return await prisma.driver.update({ where: { id }, data });
      } catch {
        return reply.code(404).send({ error: 'Driver not found' });
      }
    },
  );

  // DELETE /api/drivers/:id — hard delete if no orders, soft delete (isActive=false) if has orders
  app.delete<{ Params: { id: string } }>(
    '/api/drivers/:id',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id } = req.params;
      const orderCount = await prisma.order.count({ where: { driverId: id } });
      if (orderCount > 0) {
        await prisma.driver.update({ where: { id }, data: { isActive: false } });
        return { softDeleted: true };
      }
      try {
        await prisma.driver.delete({ where: { id } });
        return { deleted: true };
      } catch {
        return reply.code(404).send({ error: 'Driver not found' });
      }
    },
  );

  // POST /api/orders/:id/assign-driver — assign driver and send WhatsApp notifications
  app.post<{ Params: { id: string }; Body: { driverId: string } }>(
    '/api/orders/:id/assign-driver',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id: orderId } = req.params;
      const { driverId } = req.body;
      if (!driverId) return reply.code(400).send({ error: 'driverId is required' });

      try {
        const { assignDriver } = await import('../orders/order-service');
        const result = await assignDriver(orderId, driverId);

        void sendPushToPhone(result.customerPhone, '🛵 En camino', 'Tu pedido va en camino a tu dirección', `/order/${result.order.id}`);

        return result.order;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (msg === 'DRIVER_NOT_FOUND') return reply.code(404).send({ error: 'Driver not found' });
        if (msg === 'ORDER_NOT_FOUND') return reply.code(404).send({ error: 'Order not found' });
        if (msg === 'ORDER_NOT_AWAITING_DRIVER') return reply.code(409).send({ error: 'Order is not awaiting driver assignment' });
        logger.error({ err, orderId, driverId }, 'assign-driver failed');
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  // GET /api/menu/items-flat — flat list of active menu items with prices
  app.get('/api/menu/items-flat', { preHandler: verifyJwt }, async (_req, reply) => {
    const rate = parseFloat((await getConfig('USD_TO_BS_RATE')) ?? '36.50');
    const items = await prisma.menuItem.findMany({
      where: { isAvailable: true },
      include: { category: { select: { name: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });
    return reply.send(items.map(i => ({
      id: i.id,
      name: i.name,
      categoryName: i.category.name,
      priceUsd: parseFloat(i.priceUsd.toString()),
      priceBs: parseFloat(i.priceUsd.toString()) * rate,
    })));
  });

  // GET /api/orders/:id/proof — payment image (base64) on demand
  app.get<{ Params: { id: string } }>(
    '/api/orders/:id/proof',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const order = await prisma.order.findUnique({
        where: { id: req.params.id },
        select: { paymentImageUrl: true },
      });
      if (!order) return reply.code(404).send({ error: 'Not found' });
      return reply.send({ paymentImageUrl: order.paymentImageUrl ?? null });
    }
  );

  // POST /api/orders/:id/ocr-payment — extract data from payment proof via LLM vision
  app.post<{ Params: { id: string } }>(
    '/api/orders/:id/ocr-payment',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const order = await prisma.order.findUnique({
        where: { id: req.params.id },
        select: { paymentImageUrl: true },
      });
      if (!order?.paymentImageUrl) {
        return reply.code(400).send({ error: 'No payment image for this order' });
      }

      // paymentImageUrl is stored as base64 data URL (data:image/...;base64,...)
      const imageData = order.paymentImageUrl;
      const isDataUrl = imageData.startsWith('data:');
      const mimeType = isDataUrl
        ? (imageData.match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg')
        : 'image/jpeg';
      const base64 = isDataUrl ? imageData.split(',')[1] : imageData;

      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: env.OPENROUTER_API_KEY,
      });

      const response = await client.chat.completions.create({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
              {
                type: 'text',
                text: 'Extrae de este comprobante de pago móvil venezolano: referencia, fecha, hora, monto, banco origen, banco destino, titular. Devuelve SOLO un JSON con las claves: referencia, fecha, hora, monto, bancoOrigen, bancoDestino, titular. Si no encuentras un campo, usa null.',
              },
            ],
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      // Strip markdown fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try {
        const parsed = JSON.parse(cleaned) as Record<string, string | null>;
        return reply.send(parsed);
      } catch {
        return reply.send({ raw: cleaned });
      }
    }
  );

  // POST /api/orders/manual — create order from dashboard
  interface ManualOrderBody {
    customerId?: string;
    customerName?: string;
    customerPhone?: string;
    items: Array<{ menuItemId: string; quantity: number }>;
    deliveryType: 'DELIVERY' | 'PICKUP';
    deliveryAddress?: string;
    paymentMethod: 'EFECTIVO' | 'PAGO_MOVIL';
    paymentReference?: string;
  }
  app.post<{ Body: ManualOrderBody }>('/api/orders/manual', { preHandler: verifyJwt }, async (req, reply) => {
    const { customerId, customerName, customerPhone, items, deliveryType,
            deliveryAddress, paymentMethod, paymentReference } = req.body;

    if (!customerId && !customerPhone) {
      return reply.code(400).send({ error: 'customerId or customerPhone is required' });
    }
    if (!items?.length) return reply.code(400).send({ error: 'items is required' });

    // Resolve customer
    let resolvedCustomerId = customerId ?? '';
    if (!resolvedCustomerId) {
      const phone = customerPhone!;
      let cust = await prisma.customer.findUnique({ where: { phone } });
      if (!cust) {
        cust = await prisma.customer.create({
          data: {
            phone,
            ...(customerName ? { name: customerName } : {}),
            conversationState: { state: 'IDLE' },
            stats: { create: {} },
          },
        });
      }
      resolvedCustomerId = cust.id;
    }

    // Load prices from DB
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: items.map(i => i.menuItemId) } },
    });
    const cart = items.map(i => {
      const mi = menuItems.find(m => m.id === i.menuItemId);
      if (!mi) throw new Error(`MenuItem not found: ${i.menuItemId}`);
      return {
        menuItemId: i.menuItemId,
        name: mi.name,
        quantity: i.quantity,
        unitPriceUsd: parseFloat(mi.priceUsd.toString()),
      };
    });

    const deliveryFeeUsd = deliveryType === 'DELIVERY'
      ? parseFloat((await getConfig('DELIVERY_FEE_USD')) ?? '0')
      : 0;

    const order = await createOrder({
      customerId: resolvedCustomerId,
      cart,
      deliveryType,
      ...(deliveryAddress ? { deliveryAddress } : {}),
      paymentMethod: paymentMethod === 'EFECTIVO' ? 'CASH_ON_DELIVERY' : 'PAGO_MOVIL',
      ...(paymentReference ? { notes: `Ref: ${paymentReference}` } : {}),
      deliveryFeeUsd,
    });

    // Move to correct status
    if (paymentMethod === 'EFECTIVO') {
      await updateOrderStatus(order.id, 'PAYMENT_CONFIRMED');
      await updateOrderStatus(order.id, 'IN_KITCHEN');
    } else {
      await updateOrderStatus(order.id, 'PAYMENT_UPLOADED');
    }
    const full = await prisma.order.findUnique({
      where: { id: order.id },
      include: { customer: true, items: { include: { menuItem: true } } },
    });
    emitOrderUpdated(serializeOrder(full ?? order));

    return reply.send({ ok: true, orderId: order.id });
  });

  // GET /api/config — all SystemConfig key-value pairs
  app.get('/api/config', { preHandler: verifyJwt }, async (_req, _reply) => {
    return prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
  });

  // PATCH /api/config — update a SystemConfig key
  app.patch<{ Body: { key: string; value: string } }>(
    '/api/config',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { key, value } = req.body;
      try {
        const result = await prisma.systemConfig.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        });
        await invalidateConfigCache(key as never);
        emitConfigUpdated({ key, value });
        return result;
      } catch {
        return reply.code(500).send({ error: 'Failed to update config' });
      }
    },
  );

  // ── Menu endpoints ────────────────────────────────────────────────────────

  // GET /api/menu — active items for bot (cached, no auth needed internally)
  app.get('/api/menu', { preHandler: verifyJwt }, async (_req, _reply) => {
    return prisma.menuItem.findMany({
      where: { isAvailable: true, deletedAt: null },
      include: { category: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });
  });

  // GET /api/menu/full — all categories + all items (including unavailable) for admin editing
  app.get('/api/menu/full', { preHandler: verifyJwt }, async (_req, _reply) => {
    return prisma.menuCategory.findMany({
      where: { isActive: true },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  });

  // POST /api/menu/categories — create category
  app.post<{ Body: { name: string; emoji?: string } }>(
    '/api/menu/categories',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { name, emoji = '🍽️' } = req.body;
      const count = await prisma.menuCategory.count({ where: { isActive: true } });
      const category = await prisma.menuCategory.create({
        data: { name, emoji, sortOrder: count },
        include: { items: true },
      });
      await invalidateMenuCache();
      return reply.code(201).send(category);
    },
  );

  // PATCH /api/menu/categories/:id — update category
  app.patch<{ Params: { id: string }; Body: { name?: string; emoji?: string } }>(
    '/api/menu/categories/:id',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id } = req.params;
      try {
        const updated = await prisma.menuCategory.update({
          where: { id },
          data: req.body,
          include: { items: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
        });
        await invalidateMenuCache();
        return updated;
      } catch {
        return reply.code(404).send({ error: 'Category not found' });
      }
    },
  );

  // DELETE /api/menu/categories/:id — deactivate category (soft delete)
  app.delete<{ Params: { id: string } }>(
    '/api/menu/categories/:id',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id } = req.params;
      try {
        await prisma.menuCategory.update({ where: { id }, data: { isActive: false } });
        await invalidateMenuCache();
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'Category not found' });
      }
    },
  );

  // POST /api/menu/items — create item
  app.post<{ Body: { categoryId: string; name: string; description?: string; priceUsd: number; isAvailable?: boolean; imageUrl?: string } }>(
    '/api/menu/items',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { categoryId, name, description, priceUsd, isAvailable = true, imageUrl } = req.body;
      const count = await prisma.menuItem.count({ where: { categoryId, deletedAt: null } });
      const item = await prisma.menuItem.create({
        data: { categoryId, name, description: description ?? null, priceUsd, isAvailable, sortOrder: count, ...(imageUrl && { imageUrl }) },
      });
      await invalidateMenuCache(categoryId);
      return reply.code(201).send(item);
    },
  );

  // PATCH /api/menu/items/:id — update item fields
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/menu/items/:id',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id } = req.params;
      try {
        logger.info({ body: req.body }, 'PATCH menu item body');
        const updated = await prisma.menuItem.update({
          where: { id },
          data: req.body as never,
        });
        await invalidateMenuCache(updated.categoryId);
        if ('isAvailable' in req.body) emitMenuUpdated(updated.id);
        return updated;
      } catch {
        return reply.code(404).send({ error: 'Menu item not found' });
      }
    },
  );

  // DELETE /api/menu/items/:id — soft delete item
  app.delete<{ Params: { id: string } }>(
    '/api/menu/items/:id',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id } = req.params;
      try {
        const item = await prisma.menuItem.update({
          where: { id },
          data: { deletedAt: new Date(), isAvailable: false },
        });
        await invalidateMenuCache(item.categoryId);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'Menu item not found' });
      }
    },
  );

  // PATCH /api/menu/:id — kept for backwards compatibility
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/menu/:id',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id } = req.params;
      try {
        const updated = await prisma.menuItem.update({
          where: { id },
          data: req.body as never,
          include: { category: true },
        });
        await invalidateMenuCache(updated.categoryId);
        return updated;
      } catch {
        return reply.code(404).send({ error: 'Menu item not found' });
      }
    },
  );

  // ── GET /api/customers — full customer list with live-computed analytics ──
  app.get<{ Querystring: { search?: string; sortBy?: string; order?: string } }>(
    '/api/customers',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { search, sortBy = 'totalOrders', order = 'desc' } = req.query;

      const customers = await prisma.customer.findMany({
        where: {
          deletedAt: null,
          ...(search ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          } : {}),
        },
        include: {
          orders: {
            include: { items: { include: { menuItem: { select: { name: true } } } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

      const result = customers.map((c) => {
        const allOrders = c.orders;
        const completed = allOrders.filter((o) => o.status === 'DELIVERED');
        const cancelled = allOrders.filter((o) => o.status === 'CANCELLED');

        const totalSpentUsd = completed.reduce((s, o) => s + Number(o.totalUsd), 0);
        const totalSpentBs  = completed.reduce((s, o) => s + Number(o.totalBs), 0);
        const avgOrderValueUsd = completed.length > 0 ? totalSpentUsd / completed.length : 0;

        // Day-of-week order frequency
        const dayCounts = [0, 0, 0, 0, 0, 0, 0];
        for (const o of allOrders) dayCounts[new Date(o.createdAt).getDay()]++;
        const maxDay = Math.max(...dayCounts);
        const favoriteDay = maxDay > 0 ? DAY_NAMES[dayCounts.indexOf(maxDay)] : null;

        // Favorite item (by quantity)
        const itemCounts = new Map<string, { name: string; count: number }>();
        for (const o of allOrders) {
          for (const item of o.items) {
            const ex = itemCounts.get(item.menuItemId);
            if (ex) ex.count += item.quantity;
            else itemCounts.set(item.menuItemId, { name: item.menuItem?.name ?? '?', count: item.quantity });
          }
        }
        let favoriteItemName: string | null = null;
        let maxCount = 0;
        for (const { name, count } of itemCounts.values()) {
          if (count > maxCount) { maxCount = count; favoriteItemName = name; }
        }

        const sorted = [...allOrders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          savedAddress: (c as any).savedAddress as string | null,
          createdAt: c.createdAt,
          totalOrders: allOrders.length,
          completedOrders: completed.length,
          cancelledOrders: cancelled.length,
          totalSpentUsd,
          totalSpentBs,
          avgOrderValueUsd,
          favoriteItemName,
          favoriteDay,
          dayCounts,
          firstOrderAt: sorted[0]?.createdAt ?? null,
          lastOrderAt: sorted[sorted.length - 1]?.createdAt ?? null,
        };
      });

      // Sort
      const dir = order === 'asc' ? 1 : -1;
      const sorted = [...result].sort((a, b) => {
        switch (sortBy) {
          case 'totalSpentUsd': return dir * (a.totalSpentUsd - b.totalSpentUsd);
          case 'totalOrders':   return dir * (a.totalOrders - b.totalOrders);
          case 'lastOrderAt': {
            const ta = a.lastOrderAt?.getTime() ?? 0;
            const tb = b.lastOrderAt?.getTime() ?? 0;
            return dir * (ta - tb);
          }
          case 'name':
            return dir * (a.name ?? a.phone).localeCompare(b.name ?? b.phone);
          default: return dir * (a.totalOrders - b.totalOrders);
        }
      });

      return reply.send(sorted);
    },
  );

  // ── Customer analytics ────────────────────────────────────────────────────
  // Returns top customers by total orders, falling back to live aggregation
  // if CustomerStats is not yet populated (e.g. no delivered orders yet).
  app.get('/api/customers/top', { preHandler: verifyJwt }, async (_req, reply) => {
    // First try the pre-computed stats table
    const precomputed = await getTopCustomers(10);
    if (precomputed.length > 0) return reply.send(precomputed);

    // Fallback: aggregate directly from orders + customers
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      include: {
        orders: {
          where: { status: { notIn: ['CANCELLED'] } },
          include: { items: { include: { menuItem: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    const result = customers
      .filter((c) => c.orders.length > 0)
      .map((c) => {
        const totalOrders = c.orders.length;
        const completedOrders = c.orders.filter((o) => o.status === 'DELIVERED').length;
        const cancelledOrders = 0;
        const totalSpentUsd = c.orders.reduce((s, o) => s + Number(o.totalUsd), 0);
        const totalSpentBs = c.orders.reduce((s, o) => s + Number(o.totalBs), 0);
        const avgOrderValueUsd = totalOrders > 0 ? totalSpentUsd / totalOrders : 0;
        const lastOrderAt = c.orders[c.orders.length - 1]?.createdAt ?? null;

        // Most ordered item
        const itemCounts = new Map<string, { name: string; count: number }>();
        for (const order of c.orders) {
          for (const item of order.items) {
            const ex = itemCounts.get(item.menuItemId);
            if (ex) ex.count += item.quantity;
            else itemCounts.set(item.menuItemId, { name: item.menuItem?.name ?? '?', count: item.quantity });
          }
        }
        let favoriteItemName: string | null = null;
        let max = 0;
        for (const { name, count } of itemCounts.values()) {
          if (count > max) { max = count; favoriteItemName = name; }
        }

        return {
          customerId: c.id,
          totalOrders,
          completedOrders,
          cancelledOrders,
          totalSpentUsd,
          totalSpentBs,
          avgOrderValueUsd,
          lastOrderAt,
          firstOrderAt: c.orders[0]?.createdAt ?? null,
          favoriteItemId: null,
          favoriteItemName,
          customer: { id: c.id, name: c.name, phone: c.phone },
        };
      })
      .sort((a, b) => b.totalOrders - a.totalOrders);

    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>(
    '/api/customers/:id/stats',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const stats = await getCustomerStats(req.params.id);
      if (!stats) return reply.status(404).send({ error: 'Not found' });
      return reply.send(stats);
    },
  );

  // ── Promos del día ────────────────────────────────────────────────────────

  // Helper: find or create the "🔥 PROMO DÍA" category and return its id
  async function getOrCreatePromoCategoryId(): Promise<string> {
    let cat = await prisma.menuCategory.findFirst({ where: { name: 'PROMO DÍA', isActive: true } });
    if (!cat) {
      const count = await prisma.menuCategory.count({ where: { isActive: true } });
      cat = await prisma.menuCategory.create({ data: { name: 'PROMO DÍA', emoji: '🔥', sortOrder: count } });
    }
    return cat.id;
  }

  // Helper: get current exchange rate
  async function getCurrentRate(): Promise<number> {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'USD_TO_BS_RATE' } });
    return cfg ? parseFloat(cfg.value) || 1 : 1;
  }

  // GET /api/promos/day — listar promos del día
  app.get('/api/promos/day', { preHandler: verifyJwt }, async (_req, reply) => {
    const promos = await getDayPromos();
    return reply.send(promos);
  });

  // POST /api/promos/day — agregar promo + auto-crear menu item en categoría PROMO DÍA
  app.post<{ Body: { name: string; description?: string; priceBs: number } }>(
    '/api/promos/day',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { name, description, priceBs } = req.body;
      if (!name?.trim()) return reply.code(400).send({ error: 'name required' });

      const rate = await getCurrentRate();
      const priceUsd = priceBs > 0 && rate > 0 ? priceBs / rate : 0;

      const categoryId = await getOrCreatePromoCategoryId();
      const itemCount = await prisma.menuItem.count({ where: { categoryId, deletedAt: null } });
      const menuItem = await prisma.menuItem.create({
        data: {
          categoryId,
          name: name.trim(),
          description: description?.trim() || null,
          priceUsd: priceUsd.toFixed(10),
          isAvailable: true,
          sortOrder: itemCount,
        },
      });
      await invalidateMenuCache(categoryId);

      const trimmedDesc = description?.trim();
      const count = await addDayPromo({
        name: name.trim(),
        ...(trimmedDesc && { description: trimmedDesc }),
        priceBs: Number(priceBs) || 0,
        menuItemId: menuItem.id,
        autoCreated: true,
      });
      return reply.code(201).send({ count });
    },
  );

  // PATCH /api/promos/day/:index — editar promo + actualizar menu item si fue auto-creado
  app.patch<{ Params: { index: string }; Body: { name?: string; description?: string; priceBs?: number } }>(
    '/api/promos/day/:index',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const idx = parseInt(req.params.index, 10);
      const { name, description, priceBs } = req.body;

      const promos = await getDayPromos();
      const promo = promos[idx];

      if (promo?.autoCreated && promo.menuItemId) {
        const itemUpdate: Record<string, unknown> = {};
        if (name !== undefined) itemUpdate.name = name.trim();
        if (description !== undefined) itemUpdate.description = description.trim() || null;
        if (priceBs !== undefined) {
          const rate = await getCurrentRate();
          itemUpdate.priceUsd = rate > 0 ? (Number(priceBs) / rate).toFixed(10) : '0';
        }
        if (Object.keys(itemUpdate).length > 0) {
          await prisma.menuItem.update({ where: { id: promo.menuItemId }, data: itemUpdate as never });
          await invalidateMenuCache();
        }
      }

      const update: Record<string, unknown> = {};
      if (name !== undefined) update.name = name.trim();
      if (description !== undefined) update.description = description.trim() || undefined;
      if (priceBs !== undefined) update.priceBs = Number(priceBs) || 0;
      await updateDayPromo(idx, update as never);
      return reply.code(204).send();
    },
  );

  // DELETE /api/promos/day — eliminar todas las promos + desactivar sus menu items
  app.delete('/api/promos/day', { preHandler: verifyJwt }, async (_req, reply) => {
    const promos = await getDayPromos();
    const autoIds = promos.filter((p) => p.autoCreated && p.menuItemId).map((p) => p.menuItemId!);
    if (autoIds.length > 0) {
      await prisma.menuItem.updateMany({ where: { id: { in: autoIds } }, data: { deletedAt: new Date(), isAvailable: false } });
      await invalidateMenuCache();
    }
    await clearDayPromos();
    return reply.code(204).send();
  });

  // DELETE /api/promos/day/:index — eliminar una promo + desactivar su menu item
  app.delete<{ Params: { index: string } }>(
    '/api/promos/day/:index',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const idx = parseInt(req.params.index, 10);
      const promos = await getDayPromos();
      const promo = promos[idx];
      if (promo?.autoCreated && promo.menuItemId) {
        await prisma.menuItem.update({ where: { id: promo.menuItemId }, data: { deletedAt: new Date(), isAvailable: false } });
        await invalidateMenuCache();
      }
      await removeDayPromo(idx);
      return reply.code(204).send();
    },
  );

  // GET /api/promos/days — obtener días de promo configurados
  app.get('/api/promos/days', { preHandler: verifyJwt }, async (_req, reply) => {
    const days = await getPromoDays();
    return reply.send({ days });
  });

  // PUT /api/promos/days — configurar días de promo
  app.put<{ Body: { days: number[] } }>(
    '/api/promos/days',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { days } = req.body;
      if (!Array.isArray(days)) return reply.code(400).send({ error: 'days must be an array' });
      await setPromoDays(days);
      return reply.send({ days });
    },
  );

  // ── Analytics ──────────────────────────────────────────────────────────────

  function getPeriodStart(period: string): Date | undefined {
    const now = Date.now();
    switch (period) {
      case 'today': {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
      }
      case 'week':  return new Date(now - 7  * 24 * 60 * 60 * 1000);
      case 'month': return new Date(now - 30 * 24 * 60 * 60 * 1000);
      case 'year':  return new Date(now - 365 * 24 * 60 * 60 * 1000);
      default:      return undefined; // 'all'
    }
  }

  // GET /api/analytics/products?period=today|week|month|year|all
  app.get<{ Querystring: { period?: string } }>(
    '/api/analytics/products',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const from = getPeriodStart(req.query.period ?? 'month');
      const orders = await prisma.order.findMany({
        where: { status: 'DELIVERED', ...(from && { createdAt: { gte: from } }) },
        include: { items: { include: { menuItem: { select: { id: true, name: true } } } } },
      });

      const map = new Map<string, { name: string; units: number; revenueBs: number; revenueUsd: number }>();
      for (const order of orders) {
        for (const item of order.items) {
          const ex = map.get(item.menuItemId);
          const bs  = Number(item.subtotalBs);
          const usd = Number(item.unitPriceUsd) * item.quantity;
          if (ex) {
            ex.units      += item.quantity;
            ex.revenueBs  += bs;
            ex.revenueUsd += usd;
          } else {
            map.set(item.menuItemId, {
              name: item.menuItem?.name ?? '?',
              units: item.quantity,
              revenueBs: bs,
              revenueUsd: usd,
            });
          }
        }
      }

      const result = Array.from(map.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 15);

      return reply.send(result);
    },
  );

  // GET /api/analytics/customers?period=today|week|month|year|all
  app.get<{ Querystring: { period?: string } }>(
    '/api/analytics/customers',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const from = getPeriodStart(req.query.period ?? 'month');
      const orders = await prisma.order.findMany({
        where: { status: 'DELIVERED', ...(from && { createdAt: { gte: from } }) },
        include: { customer: { select: { id: true, name: true, phone: true } } },
      });

      const map = new Map<string, { name: string | null; phone: string; orders: number; totalSpentBs: number; totalSpentUsd: number }>();
      for (const order of orders) {
        const c = order.customer;
        if (!c) continue;
        const ex = map.get(c.id);
        if (ex) {
          ex.orders++;
          ex.totalSpentBs  += Number(order.totalBs);
          ex.totalSpentUsd += Number(order.totalUsd);
        } else {
          map.set(c.id, {
            name: c.name,
            phone: c.phone,
            orders: 1,
            totalSpentBs:  Number(order.totalBs),
            totalSpentUsd: Number(order.totalUsd),
          });
        }
      }

      const result = Array.from(map.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 10);

      return reply.send(result);
    },
  );

  // ── Financials ─────────────────────────────────────────────────────────────

  /** Returns { from, to, prevFrom, prevTo } for current and previous window */
  function getFinancialPeriod(period: string): {
    from: Date; to: Date; prevFrom: Date; prevTo: Date;
  } {
    const now = new Date();
    let from: Date;
    let prevFrom: Date;
    let prevTo: Date;

    switch (period) {
      case 'today': {
        from = new Date(now); from.setHours(0, 0, 0, 0);
        prevTo = new Date(from);
        prevFrom = new Date(from); prevFrom.setDate(prevFrom.getDate() - 1);
        break;
      }
      case 'week': {
        from = new Date(now.getTime() - 7 * 86400_000);
        prevTo = new Date(from);
        prevFrom = new Date(from.getTime() - 7 * 86400_000);
        break;
      }
      case 'year': {
        from = new Date(now.getTime() - 365 * 86400_000);
        prevTo = new Date(from);
        prevFrom = new Date(from.getTime() - 365 * 86400_000);
        break;
      }
      default: { // month
        from = new Date(now.getTime() - 30 * 86400_000);
        prevTo = new Date(from);
        prevFrom = new Date(from.getTime() - 30 * 86400_000);
      }
    }
    return { from, to: now, prevFrom, prevTo };
  }

  // GET /api/financials/summary?period=today|week|month|year
  app.get<{ Querystring: { period?: string } }>(
    '/api/financials/summary',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const period = req.query.period ?? 'month';
      const { from, to, prevFrom, prevTo } = getFinancialPeriod(period);

      const [currentOrders, prevOrders] = await Promise.all([
        prisma.order.findMany({
          where: { createdAt: { gte: from, lt: to } },
          select: {
            status: true,
            totalBs: true, totalUsd: true,
            discountBs: true, discountUsd: true,
            paymentMethod: true, deliveryType: true,
          },
        }),
        prisma.order.findMany({
          where: { status: 'DELIVERED', createdAt: { gte: prevFrom, lt: prevTo } },
          select: { totalBs: true, totalUsd: true },
        }),
      ]);

      const delivered = currentOrders.filter((o) => o.status === 'DELIVERED');
      const cancelled = currentOrders.filter((o) => o.status === 'CANCELLED');
      const terminal  = ['DELIVERED', 'CANCELLED'];
      const inProgress = currentOrders.filter((o) => !terminal.includes(o.status));

      const grossBs  = delivered.reduce((s, o) => s + Number(o.totalBs),  0);
      const grossUsd = delivered.reduce((s, o) => s + Number(o.totalUsd), 0);
      const discBs   = delivered.reduce((s, o) => s + Number(o.discountBs  ?? 0), 0);
      const discUsd  = delivered.reduce((s, o) => s + Number(o.discountUsd ?? 0), 0);

      const prevGrossBs  = prevOrders.reduce((s, o) => s + Number(o.totalBs),  0);

      const total = delivered.length + cancelled.length;
      const conversionRate = total > 0 ? (delivered.length / total) * 100 : 0;
      const avgTicketBs    = delivered.length > 0 ? grossBs  / delivered.length : 0;
      const avgTicketUsd   = delivered.length > 0 ? grossUsd / delivered.length : 0;

      // Delivery split (only delivered orders)
      const deliveryOrders = delivered.filter((o) => o.deliveryType === 'DELIVERY');
      const pickupOrders   = delivered.filter((o) => o.deliveryType === 'PICKUP');

      // Payment split
      const pagoMovil = delivered.filter((o) => o.paymentMethod === 'PAGO_MOVIL');
      const cash      = delivered.filter((o) => o.paymentMethod === 'CASH_ON_DELIVERY');

      // vs previous period
      const pct = (curr: number, prev: number): number | null =>
        prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null;

      const prevAvgTicketBs = prevOrders.length > 0 ? prevGrossBs / prevOrders.length : 0;

      return reply.send({
        period,
        grossRevenueBs:  grossBs,
        grossRevenueUsd: grossUsd,
        discountBs:  discBs,
        discountUsd: discUsd,
        netRevenueBs:  grossBs  - discBs,
        netRevenueUsd: grossUsd - discUsd,
        totalOrders:      currentOrders.length,
        deliveredOrders:  delivered.length,
        cancelledOrders:  cancelled.length,
        inProgressOrders: inProgress.length,
        conversionRate:   Math.round(conversionRate * 10) / 10,
        avgTicketBs:  Math.round(avgTicketBs  * 100) / 100,
        avgTicketUsd: Math.round(avgTicketUsd * 100) / 100,
        deliveryCount:    deliveryOrders.length,
        pickupCount:      pickupOrders.length,
        deliveryRevenueBs: deliveryOrders.reduce((s, o) => s + Number(o.totalBs), 0),
        pickupRevenueBs:   pickupOrders.reduce((s, o) => s + Number(o.totalBs), 0),
        pagoMovilCount:    pagoMovil.length,
        cashCount:         cash.length,
        pagoMovilRevenueBs: pagoMovil.reduce((s, o) => s + Number(o.totalBs), 0),
        cashRevenueBs:      cash.reduce((s, o) => s + Number(o.totalBs), 0),
        vsPrevRevenuePct: pct(grossBs,       prevGrossBs),
        vsPrevOrdersPct:  pct(delivered.length, prevOrders.length),
        vsPrevTicketPct:  pct(avgTicketBs,   prevAvgTicketBs),
      });
    },
  );

  // GET /api/financials/chart?period=week|month|year
  app.get<{ Querystring: { period?: string } }>(
    '/api/financials/chart',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const period = req.query.period ?? 'month';
      const { from } = getFinancialPeriod(period);

      const orders = await prisma.order.findMany({
        where: { status: 'DELIVERED', createdAt: { gte: from } },
        select: { createdAt: true, totalBs: true, totalUsd: true },
        orderBy: { createdAt: 'asc' },
      });

      const groupByYear = period === 'year';

      const map = new Map<string, { revenueBs: number; revenueUsd: number; orders: number }>();
      for (const o of orders) {
        const key = groupByYear
          ? o.createdAt.toISOString().slice(0, 7)   // YYYY-MM
          : o.createdAt.toISOString().slice(0, 10);  // YYYY-MM-DD
        const ex = map.get(key) ?? { revenueBs: 0, revenueUsd: 0, orders: 0 };
        ex.revenueBs  += Number(o.totalBs);
        ex.revenueUsd += Number(o.totalUsd);
        ex.orders++;
        map.set(key, ex);
      }

      // Fill all dates/months with 0 if no orders
      const points: { date: string; revenueBs: number; revenueUsd: number; orders: number }[] = [];
      const cursor = new Date(from);
      const now = new Date();

      if (groupByYear) {
        // Monthly buckets for year view
        cursor.setDate(1);
        while (cursor <= now) {
          const key = cursor.toISOString().slice(0, 7);
          points.push({ date: key, ...(map.get(key) ?? { revenueBs: 0, revenueUsd: 0, orders: 0 }) });
          cursor.setMonth(cursor.getMonth() + 1);
        }
      } else {
        // Daily buckets
        while (cursor <= now) {
          const key = cursor.toISOString().slice(0, 10);
          points.push({ date: key, ...(map.get(key) ?? { revenueBs: 0, revenueUsd: 0, orders: 0 }) });
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      return reply.send(points);
    },
  );

  // ── Reviews ───────────────────────────────────────────────────────────────

  // GET /api/reviews?rating=&from=&to=&limit=&offset=
  app.get<{ Querystring: { rating?: string; from?: string; to?: string; limit?: string; offset?: string } }>(
    '/api/reviews',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const where: Record<string, unknown> = {};
      if (req.query.rating) where['rating'] = parseInt(req.query.rating, 10);
      if (req.query.from || req.query.to) {
        const createdAt: Record<string, Date> = {};
        if (req.query.from) createdAt['gte'] = new Date(req.query.from);
        if (req.query.to)   createdAt['lte'] = new Date(req.query.to);
        where['createdAt'] = createdAt;
      }

      const limit  = Math.min(parseInt(req.query.limit  ?? '50', 10), 200);
      const offset = parseInt(req.query.offset ?? '0', 10);

      const [reviews, total] = await Promise.all([
        prisma.review.findMany({
          where,
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            order:    { select: { orderNumber: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.review.count({ where }),
      ]);

      return reply.send({ reviews, total, limit, offset });
    },
  );

  // GET /api/reviews/stats — promedio global + distribución
  app.get('/api/reviews/stats', { preHandler: verifyJwt }, async (_req, reply) => {
    const [agg, distribution] = await Promise.all([
      prisma.review.aggregate({ _avg: { rating: true }, _count: { id: true } }),
      prisma.review.groupBy({ by: ['rating'], _count: { rating: true }, orderBy: { rating: 'asc' } }),
    ]);

    const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of distribution) dist[row.rating] = row._count.rating;

    return reply.send({
      averageRating: agg._avg.rating ?? 0,
      totalReviews: agg._count.id,
      distribution: dist,
    });
  });

  // ── GET /api/customers/search — búsqueda liviana por teléfono con estado de sesión ──
  app.get<{ Querystring: { phone?: string } }>(
    '/api/customers/search',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { phone } = req.query;
      if (!phone || phone.trim().length < 3) return reply.send([]);

      const customers = await prisma.customer.findMany({
        where: {
          deletedAt: null,
          phone: { contains: phone.trim() },
        },
        select: {
          id: true,
          name: true,
          phone: true,
          orders: {
            where: { status: { notIn: ['DELIVERED', 'CANCELLED'] } },
            select: { id: true, orderNumber: true, status: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        take: 10,
      });

      const result = await Promise.all(
        customers.map(async (c) => {
          const session = await getSession(c.phone).catch(() => null);
          const activeOrder = c.orders[0] ?? null;
          return {
            id: c.id,
            name: c.name,
            phone: c.phone,
            sessionState: session?.state ?? null,
            activeOrderId: activeOrder?.id ?? null,
            activeOrderNumber: activeOrder?.orderNumber ?? null,
            activeOrderStatus: activeOrder?.status ?? null,
          };
        }),
      );

      return reply.send(result);
    },
  );

  // ── POST /api/customers/:id/reset-session — reset de emergencia ──
  app.post<{ Params: { id: string } }>(
    '/api/customers/:id/reset-session',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const { id } = req.params;

      const customer = await prisma.customer.findUnique({
        where: { id },
        select: { id: true, name: true, phone: true },
      });
      if (!customer) return reply.code(404).send({ error: 'Customer not found' });

      // Cancelar orden activa si existe
      const activeOrder = await prisma.order.findFirst({
        where: { customerId: id, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
        select: { id: true, orderNumber: true },
      });
      if (activeOrder) {
        await prisma.order.update({
          where: { id: activeOrder.id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Reset de sesión desde dashboard' },
        });
        const updatedOrder = await prisma.order.findUnique({
          where: { id: activeOrder.id },
          include: { customer: true, items: { include: { menuItem: true } } },
        });
        if (updatedOrder) emitOrderUpdated(serializeOrder(updatedOrder));
      }

      // Resetear sesión Redis
      const existingSession = await getSession(customer.phone).catch(() => null);
      await updateSessionState(customer.phone, 'MAIN_MENU', {
        customerId: existingSession?.customerId ?? id,
        customerName: existingSession?.customerName ?? customer.name ?? undefined,
        cart: [],
        activeOrderId: undefined,
      });

      logger.info(
        { customerId: id, phone: customer.phone, cancelledOrderId: activeOrder?.id ?? null },
        'Session reset from dashboard',
      );

      return reply.send({
        ok: true,
        cancelledOrderId: activeOrder?.id ?? null,
        cancelledOrderNumber: activeOrder?.orderNumber ?? null,
      });
    },
  );

  // GET /api/customers/:id/reviews — historial de un cliente
  app.get<{ Params: { id: string } }>(
    '/api/customers/:id/reviews',
    { preHandler: verifyJwt },
    async (req, reply) => {
      const reviews = await prisma.review.findMany({
        where: { customerId: req.params.id },
        include: { order: { select: { orderNumber: true, createdAt: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const avg = reviews.length > 0
        ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
        : 0;

      return reply.send({ reviews, averageRating: avg, total: reviews.length });
    },
  );

  // ─── Push Subscriptions ───────────────────────────────────────────────────

  app.post<{
    Body: { endpoint: string; keys: { p256dh: string; auth: string }; phone?: string };
  }>('/api/push/subscribe', async (req, reply) => {
    const { endpoint, keys, phone } = req.body;

    const normalizedPhone = phone ? normalizeDriverPhone(phone.trim()) : undefined;

    let customerId: string | undefined;
    if (normalizedPhone) {
      const customer = await prisma.customer.findUnique({ where: { phone: normalizedPhone } });
      if (customer) customerId = customer.id;
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        ...(normalizedPhone && { phone: normalizedPhone }),
        ...(customerId && { customerId }),
      },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        ...(normalizedPhone && { phone: normalizedPhone }),
        ...(customerId && { customerId }),
      },
    });

    return reply.code(201).send({ ok: true });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLIC endpoints — no auth required (used by client PWA)
  // ──────────────────────────────────────────────────────────────────────────

  // GET /api/public/menu — active categories + available items with imageUrl
  app.get('/api/public/menu', async (_req, reply) => {
    const categories = await prisma.menuCategory.findMany({
      where: { isActive: true },
      include: {
        items: {
          where: { deletedAt: null, isAvailable: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
    reply.header('Cache-Control', 'no-store');
    return categories;
  });

  // GET /api/public/config — restaurant info for client PWA
  app.get('/api/public/config', async (_req, _reply) => {
    const keys = [
      'RESTAURANT_NAME',
      'PAGO_MOVIL_PHONE',
      'PAGO_MOVIL_BANK',
      'PAGO_MOVIL_HOLDER',
      'PAGO_MOVIL_RIF',
      'DELIVERY_FEE_USD',
      'USD_TO_BS_RATE',
      'ADMIN_PHONE',
      'RESTAURANT_HOURS',
      'BUSINESS_ACTIVE',
      'SCHEDULE_ENABLED',
      'SCHEDULE_OPEN_TIME',
      'SCHEDULE_CLOSE_TIME',
      'SCHEDULE_DAYS',
      'IS_HIGH_DEMAND',
      'IS_POWER_OUTAGE',
      'OUTAGE_MESSAGE',
      'IS_ORDERS_PAUSED',
      'ORDERS_PAUSE_MINUTES',
      'ORDERS_PAUSE_UNTIL',
    ];
    const rows = await prisma.systemConfig.findMany({ where: { key: { in: keys } } });
    const config = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...config, vapidPublicKey: env.VAPID_PUBLIC_KEY };
  });

  // POST /api/public/orders — create order from client PWA (no auth)
  app.post<{
    Body: {
      customerName: string;
      phone: string;
      deliveryType: 'DELIVERY' | 'PICKUP';
      address?: string;
      items: { menuItemId: string; quantity: number }[];
      proofImageBase64?: string;
      paymentMethod?: 'PAGO_MOVIL' | 'CASH' | 'POS';
      paymentReference?: string;
    };
  }>('/api/public/orders', async (req, reply) => {
    try {
      const { customerName, phone, deliveryType, address, items, proofImageBase64,
              paymentMethod, paymentReference } = req.body;

      if (!customerName?.trim()) return reply.code(400).send({ error: 'customerName is required' });
      if (!phone?.trim()) return reply.code(400).send({ error: 'phone is required' });
      if (!items?.length) return reply.code(400).send({ error: 'items is required' });
      if (deliveryType === 'DELIVERY' && !address?.trim()) {
        return reply.code(400).send({ error: 'address is required for delivery' });
      }

      // Queue mode: IS_ORDERS_PAUSED or IS_HIGH_DEMAND — never block, just flag
      const [isPaused, isHighDemand, pauseUntilRaw] = await Promise.all([
        getConfig('IS_ORDERS_PAUSED'),
        getConfig('IS_HIGH_DEMAND'),
        getConfig('ORDERS_PAUSE_UNTIL'),
      ]);
      const pauseExpired = isPaused === 'true' && !!pauseUntilRaw && new Date(pauseUntilRaw) <= new Date();
      if (pauseExpired) {
        await prisma.systemConfig.upsert({ where: { key: 'IS_ORDERS_PAUSED' }, update: { value: 'false' }, create: { key: 'IS_ORDERS_PAUSED', value: 'false' } });
        emitConfigUpdated({ key: 'IS_ORDERS_PAUSED', value: 'false' });
      }
      const queued = !pauseExpired && (isPaused === 'true' || isHighDemand === 'true');

      const normalizedPhone = normalizeDriverPhone(phone.trim());

      // findOrCreate customer
      let customer = await prisma.customer.findUnique({ where: { phone: normalizedPhone } });
      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            phone: normalizedPhone,
            name: customerName.trim(),
            conversationState: { state: 'IDLE' },
            stats: { create: {} },
          },
        });
      } else if (!customer.name && customerName.trim()) {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: { name: customerName.trim() },
        });
      }

      // Load prices from DB
      const menuItems = await prisma.menuItem.findMany({
        where: { id: { in: items.map((i) => i.menuItemId) }, deletedAt: null },
      });
      if (menuItems.length !== items.length) {
        return reply.code(400).send({ error: 'One or more menu items not found' });
      }

      const cart = items.map((i) => {
        const mi = menuItems.find((m) => m.id === i.menuItemId)!;
        return {
          menuItemId: i.menuItemId,
          name: mi.name,
          quantity: i.quantity,
          unitPriceUsd: parseFloat(mi.priceUsd.toString()),
        };
      });

      const deliveryFeeUsd = deliveryType === 'DELIVERY'
        ? parseFloat((await getConfig('DELIVERY_FEE_USD')) ?? '1.50')
        : 0;

      const isCash = paymentMethod === 'CASH' && deliveryType === 'PICKUP';
      const isPos  = paymentMethod === 'POS'  && deliveryType === 'PICKUP';

      const order = await createOrder({
        customerId: customer.id,
        cart,
        deliveryType,
        ...(address ? { deliveryAddress: address.trim() } : {}),
        paymentMethod: isCash ? 'CASH_ON_DELIVERY' : isPos ? 'POS' : 'PAGO_MOVIL',
        deliveryFeeUsd,
        ...(!isCash && !isPos && proofImageBase64 ? { paymentImageUrl: proofImageBase64 } : {}),
      });

      if (paymentReference?.trim()) {
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentReference: paymentReference.trim() },
        });
      }

      const targetStatus = !isCash && !isPos && proofImageBase64 ? 'PAYMENT_UPLOADED' : 'PENDING_PAYMENT';
      await updateOrderStatus(order.id, targetStatus);

      const full = await prisma.order.findUnique({
        where: { id: order.id },
        include: { customer: true, items: { include: { menuItem: true } } },
      });
      emitOrderUpdated(serializeOrder(full ?? order));

      // Save delivery address for next time
      if (deliveryType === 'DELIVERY' && address?.trim()) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { savedAddress: address.trim() },
        }).catch(() => { /* non-critical */ });
      }

      return reply.code(201).send({ orderId: order.id, orderNumber: order.orderNumber, queued });
    } catch (err) {
      console.error('[POST /api/public/orders] Unhandled error:', err);
      return reply.code(500).send({ error: 'Internal server error', detail: String(err) });
    }
  });

  // GET /api/public/customers/:phone — saved address lookup (no auth)
  app.get<{ Params: { phone: string } }>(
    '/api/public/customers/:phone',
    async (req, reply) => {
      const normalized = normalizeDriverPhone(req.params.phone.trim());
      const customer = await prisma.customer.findUnique({
        where: { phone: normalized },
        select: { savedAddress: true },
      });
      return reply.send({ savedAddress: customer?.savedAddress ?? null });
    }
  );

  // ─── Endpoints públicos para PWA motorizado (sin auth) ─────────────────────

  // GET /api/public/orders/:id — datos mínimos para pantalla del motorizado
  app.get<{ Params: { id: string } }>(
    '/api/public/orders/:id',
    async (req, reply) => {
      const order = await prisma.order.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          deliveryAddress: true,
          deliveryReference: true,
          customer: { select: { name: true, phone: true } },
        },
      });
      if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
      // Solo exponer si está activo en entrega o ya fue entregado recientemente
      if (!['OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)) {
        return reply.code(403).send({ error: 'Pedido no disponible' });
      }
      return order;
    },
  );

  // POST /api/public/orders/:id/delivered — motorizado confirma entrega (sin auth)
  app.post<{ Params: { id: string } }>(
    '/api/public/orders/:id/delivered',
    async (req, reply) => {
      const { id } = req.params;
      const order = await prisma.order.findUnique({
        where: { id },
        include: { customer: true, items: { include: { menuItem: true } } },
      });
      if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
      if (order.status === 'DELIVERED') return { ok: true, message: 'Ya estaba entregado' };
      const validForDelivery = order.status === 'OUT_FOR_DELIVERY' ||
        (order.status === 'READY' && order.deliveryType === 'PICKUP');
      if (!validForDelivery) {
        return reply.code(409).send({ error: 'El pedido no está en un estado válido para confirmar entrega' });
      }

      // Cerrar pedido
      const updated = await prisma.order.update({
        where: { id },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
        include: { customer: true, items: { include: { menuItem: true } } },
      });
      emitOrderUpdated(serializeOrder(updated));
      void emitTodayStats();

      // Push al cliente
      const customerPhone = order.customer.phone;
      void sendPushToPhone(
        customerPhone,
        '✅ Pedido entregado',
        '¡Tu pedido llegó! Gracias por preferirnos 🙏',
        `/review/${id}`,
      );

      return { ok: true, message: 'Entrega confirmada' };
    },
  );

  // GET /api/public/orders/:id/tracking — datos completos para tracking page (sin auth)
  app.get<{ Params: { id: string } }>(
    '/api/public/orders/:id/tracking',
    async (req, reply) => {
      const order = await prisma.order.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          deliveryType: true,
          deliveryAddress: true,
          totalUsd: true,
          totalBs: true,
          customer: { select: { name: true } },
          items: {
            select: {
              quantity: true,
              unitPriceUsd: true,
              menuItem: { select: { name: true } },
            },
          },
        },
      });
      if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
      return reply.send({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        deliveryType: order.deliveryType,
        deliveryAddress: order.deliveryAddress,
        totalUsd: order.totalUsd.toString(),
        totalBs: order.totalBs.toString(),
        customerName: order.customer.name,
        items: order.items.map((i) => ({
          name: i.menuItem.name,
          quantity: i.quantity,
          unitPriceUsd: i.unitPriceUsd.toString(),
        })),
      });
    },
  );

  // PATCH /api/public/orders/:id/payment-proof — cliente sube nuevo comprobante (sin auth)
  app.patch<{
    Params: { id: string };
    Body: { paymentImageUrl: string };
  }>(
    '/api/public/orders/:id/payment-proof',
    async (req, reply) => {
      const { id } = req.params;
      const { paymentImageUrl } = req.body;
      if (!paymentImageUrl?.trim()) {
        return reply.code(400).send({ error: 'paymentImageUrl is required' });
      }
      const order = await prisma.order.findUnique({ where: { id }, select: { id: true, status: true, customer: true } });
      if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
      if (!['PAYMENT_REJECTED', 'PENDING_PAYMENT'].includes(order.status)) {
        return reply.code(409).send({ error: 'Solo se puede subir comprobante cuando el pago fue rechazado o está pendiente' });
      }
      const updated = await prisma.order.update({
        where: { id },
        data: { paymentImageUrl, status: 'PAYMENT_UPLOADED' },
        include: { customer: true, items: { include: { menuItem: true } } },
      });
      emitOrderUpdated(serializeOrder(updated));
      // Push al admin si tiene suscripción
      const adminPhone = await getConfig('ADMIN_PHONE');
      if (adminPhone) {
        const fId = String(updated.orderNumber).padStart(4, '0');
        void sendPushToPhone(adminPhone, '📤 Nuevo comprobante', `Pedido #${fId} — comprobante actualizado`, `/`);
      }
      return reply.send({ ok: true });
    },
  );

  // DELETE /api/public/orders/:id — cliente cancela pedido (sin auth, solo estados permitidos)
  app.delete<{ Params: { id: string } }>(
    '/api/public/orders/:id',
    async (req, reply) => {
      const { id } = req.params;
      const order = await prisma.order.findUnique({
        where: { id },
        select: { id: true, status: true, orderNumber: true, customer: true },
      });
      if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
      if (!['PAYMENT_REJECTED', 'PENDING_PAYMENT', 'PAYMENT_UPLOADED'].includes(order.status)) {
        return reply.code(409).send({ error: 'No se puede cancelar un pedido en este estado' });
      }
      const updated = await prisma.order.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Cancelado por el cliente' },
        include: { customer: true, items: { include: { menuItem: true } } },
      });
      emitOrderUpdated(serializeOrder(updated));
      const adminPhone = await getConfig('ADMIN_PHONE');
      if (adminPhone) {
        const fId = String(order.orderNumber).padStart(4, '0');
        void sendPushToPhone(adminPhone, '❌ Pedido cancelado', `Pedido #${fId} cancelado por el cliente`);
      }
      return reply.send({ ok: true });
    },
  );

  // POST /api/public/reviews/:orderId — cliente envía reseña desde PWA (sin auth)
  app.post<{
    Params: { orderId: string };
    Body: { rating: number; comment?: string };
  }>(
    '/api/public/reviews/:orderId',
    async (req, reply) => {
      const { orderId } = req.params;
      const { rating, comment } = req.body;

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return reply.code(400).send({ error: 'Rating debe ser entre 1 y 5' });
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, customerId: true, status: true },
      });
      if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
      if (order.status !== 'DELIVERED') {
        return reply.code(409).send({ error: 'Solo se puede reseñar pedidos entregados' });
      }

      try {
        await prisma.review.create({
          data: {
            orderId,
            customerId: order.customerId,
            rating,
            ...(comment?.trim() && { comment: comment.trim() }),
          },
        });
        return { ok: true };
      } catch (err: unknown) {
        // Constraint único — ya existe reseña para este pedido
        if ((err as { code?: string })?.code === 'P2002') {
          return { ok: true, message: 'Ya registrada' };
        }
        throw err;
      }
    },
  );
}
