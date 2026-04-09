/**
 * triggerOrderDelivered — punto único de cierre de pedido.
 *
 * Dos funciones exportadas:
 *   triggerOrderDelivered     — DB update + notificaciones (driver handler, admin.handler)
 *   sendDeliveryNotifications — solo notificaciones (dashboard, que ya hizo el DB update)
 */
import { updateOrderStatus, getOrderWithItems, buildCartSummary } from '../../orders/order-service';
import { getSession, updateSessionState } from '../../redis/session-manager';
import { getConfig } from '../../menu/config-service';
import { generateThankYouMessage } from '../../llm/gemini-client';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage, TEMPLATES } from '../../whatsapp/message-builder';
import { setTimeout } from 'timers/promises';
import { logger } from '../../utils/logger';

// ─── Lógica compartida (pasos 2-5) ───────────────────────────────────────────

async function thankYouAndFeedback(customerPhone: string, orderId: string): Promise<void> {
  const orderWithItems = await getOrderWithItems(orderId);
  const cartSummary  = orderWithItems ? buildCartSummary(orderWithItems.items) : '(sin detalle)';
  const customerName = orderWithItems?.customer.name ?? customerPhone;
  const customerId   = orderWithItems?.customer.id;

  const restaurantName = (await getConfig('RESTAURANT_NAME')) ?? 'el restaurante';
  const thankYouText = await generateThankYouMessage(
    customerName,
    cartSummary,
    restaurantName,
    { ...(customerId !== undefined && { customerId }) },
  );

  await whatsappClient.sendMessage(textMessage(customerPhone, thankYouText));

  await setTimeout(10_000);
  await whatsappClient.sendMessage(TEMPLATES.feedbackRating(customerPhone));

  const session = await getSession(customerPhone);
  await updateSessionState(customerPhone, 'AWAITING_FEEDBACK_RATING', {
    customerId: session?.customerId ?? customerId,
    customerName: session?.customerName ?? customerName,
    cart: [],
    activeOrderId: undefined,
    pendingFeedbackOrderId: orderId,
    feedbackRequestedAt: new Date().toISOString(),
  });
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Vía A — el DB update aún no ocurrió.
 * Usado por: driver-delivery.handler, admin.handler (/entregado, botón order_delivered:)
 */
export async function triggerOrderDelivered(customerPhone: string, orderId: string): Promise<void> {
  await updateOrderStatus(orderId, 'DELIVERED', { deliveredAt: new Date() });
  await thankYouAndFeedback(customerPhone, orderId);
  logger.info({ orderId, customerPhone }, 'Order delivered — thank you sent, awaiting feedback');
}

/**
 * Vía B — el DB update ya fue hecho por la ruta del dashboard.
 * Usado por: dashboard.routes (PATCH /api/orders/:id/status con status=DELIVERED)
 */
export async function sendDeliveryNotifications(customerPhone: string, orderId: string): Promise<void> {
  await thankYouAndFeedback(customerPhone, orderId);
  logger.info({ orderId, customerPhone }, 'Delivery notifications sent from dashboard');
}

// ─── Helper compartido ────────────────────────────────────────────────────────

export async function loadCartSummary(orderId: string): Promise<{
  cartSummary: string;
  customerName: string;
  deliveryAddress: string;
  orderNumber: number;
} | null> {
  const order = await getOrderWithItems(orderId);
  if (!order) return null;
  return {
    cartSummary:     buildCartSummary(order.items),
    customerName:    order.customer.name ?? order.customer.phone,
    deliveryAddress: order.deliveryAddress ?? 'sin dirección',
    orderNumber:     order.orderNumber,
  };
}
