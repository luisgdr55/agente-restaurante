/**
 * Notificaciones al admin/encargado vía WhatsApp.
 * El admin puede responder con botones interactivos para confirmar/rechazar pagos
 * y marcar pedidos como listos o entregados.
 */
import { whatsappClient } from '../whatsapp/client';
import { buttonMessage, textMessage } from '../whatsapp/message-builder';
import { getConfig } from '../menu/config-service';
import { friendlyOrderId } from '../orders/order-service';
import { logger } from '../utils/logger';
import type { CartItem } from '../redis/session-manager';
import type { PaymentReceiptData } from '../ocr/ocr-service';
import { formatPaymentDataForAdmin } from '../ocr/ocr-service';

// ─── Notificación de pago recibido ────────────────────────────────────────────

export async function notifyPaymentReceived(params: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  customerPhone: string;
  cart: CartItem[];
  totalBs: number;
  paymentData: PaymentReceiptData | null;
  paymentSource: 'image' | 'text'; // si vino de imagen OCR o texto del cliente
  deliveryType: 'DELIVERY' | 'PICKUP';
  deliveryAddress?: string;
}): Promise<void> {
  const notifPhone = (await getConfig('NOTIFICATION_PHONE')) ?? (await getConfig('ADMIN_PHONE'));
  if (!notifPhone) {
    logger.warn('NOTIFICATION_PHONE not configured — skipping admin notification');
    return;
  }

  const fId = friendlyOrderId(params.orderNumber);

  const itemLines = params.cart
    .map((i) => `  • ${i.quantity}x ${i.name}`)
    .join('\n');

  const deliveryLine =
    params.deliveryType === 'DELIVERY'
      ? `🛵 Delivery → ${params.deliveryAddress ?? 'sin dirección'}`
      : '🏃 Retiro en local';

  // Datos del comprobante
  const receiptSection = params.paymentData
    ? formatPaymentDataForAdmin(params.paymentData, params.paymentSource)
    : '📋 _Sin datos de comprobante_';

  const body =
    `🔔 *Pedido #${fId} — ${params.customerName}*\n` +
    `👤 ${params.customerPhone}\n\n` +
    `📦 *Items:*\n${itemLines}\n\n` +
    `💰 Total: *Bs ${params.totalBs.toFixed(2)}*\n` +
    `${deliveryLine}\n\n` +
    `${receiptSection}\n\n` +
    `_Verifique en su banco antes de confirmar_`;

  await whatsappClient.sendMessage(
    buttonMessage(
      notifPhone,
      body,
      [
        { id: `confirm_payment:${params.orderId}`, title: '✅ Confirmar pago' },
        { id: `reject_payment:${params.orderId}`, title: '❌ Rechazar pago' },
      ],
      { header: '💳 Nuevo comprobante de pago' },
    ),
  );

  logger.info({ orderId: params.orderId, notifPhone }, 'Admin notified of payment');
}

// ─── Notificación de nuevo pedido (cash on delivery) ─────────────────────────

export async function notifyNewCashOrder(params: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  customerPhone: string;
  cart: CartItem[];
  totalBs: number;
  deliveryAddress?: string;
}): Promise<void> {
  const notifPhone = (await getConfig('NOTIFICATION_PHONE')) ?? (await getConfig('ADMIN_PHONE'));
  if (!notifPhone) return;

  const fId = friendlyOrderId(params.orderNumber);
  const itemLines = params.cart.map((i) => `  • ${i.quantity}x ${i.name}`).join('\n');
  const locationLine = params.deliveryAddress
    ? `📍 Delivery → ${params.deliveryAddress}`
    : '🏃 Retiro en local';

  const body =
    `🔔 *Pedido #${fId} — ${params.customerName}*\n` +
    `👤 ${params.customerPhone}\n\n` +
    `📦 *Items:*\n${itemLines}\n\n` +
    `💰 Total: *Bs ${params.totalBs.toFixed(2)}*\n` +
    `${locationLine}\n\n` +
    `💵 *Pago en efectivo al recibir*`;

  await whatsappClient.sendMessage(
    buttonMessage(
      notifPhone,
      body,
      [{ id: `order_in_kitchen:${params.orderId}`, title: '🍳 Enviar a cocina' }],
      { header: '🛒 Nuevo pedido — Pago al retirar' },
    ),
  );
}

// ─── Notificación de entrega confirmada por motorizado ───────────────────────

export async function notifyDeliveryConfirmed(params: {
  orderNumber: number;
  driverName: string;
  customerName: string;
  customerPhone: string;
  cartSummary: string;
  deliveryAddress: string;
}): Promise<void> {
  const notifPhone = (await getConfig('NOTIFICATION_PHONE')) ?? (await getConfig('ADMIN_PHONE'));
  if (!notifPhone) return;

  const fId = friendlyOrderId(params.orderNumber);

  await whatsappClient.sendMessage(
    textMessage(
      notifPhone,
      `✅ *Entrega confirmada por el motorizado*\n\n` +
        `📦 Pedido #${fId}: ${params.cartSummary}\n` +
        `👤 Cliente: ${params.customerName} (${params.customerPhone})\n` +
        `📍 Dirección: ${params.deliveryAddress}\n` +
        `🛵 Motorizado: ${params.driverName}`,
    ),
  );
}

// ─── Notificación de motorizado no registrado ─────────────────────────────────

export async function notifyUnregisteredDriverAttempt(params: {
  phone: string;
}): Promise<void> {
  const notifPhone = (await getConfig('NOTIFICATION_PHONE')) ?? (await getConfig('ADMIN_PHONE'));
  if (!notifPhone) return;

  await whatsappClient.sendMessage(
    textMessage(
      notifPhone,
      `⚠️ *Motorizado no registrado intentó confirmar entrega*\n\n` +
        `📱 Número: ${params.phone}\n\n` +
        `Confírmalo manualmente en el dashboard.`,
    ),
  );
}

// ─── Notificación de dirección de delivery ────────────────────────────────────

export async function notifyDeliveryAddress(params: {
  orderId: string;
  orderNumber: number;
  customerName: string;
  address: string;
}): Promise<void> {
  const notifPhone = (await getConfig('NOTIFICATION_PHONE')) ?? (await getConfig('ADMIN_PHONE'));
  if (!notifPhone) return;

  const fId = friendlyOrderId(params.orderNumber);

  await whatsappClient.sendMessage(
    textMessage(
      notifPhone,
      `📍 *Dirección de entrega — Pedido #${fId}*\n\n` +
        `👤 ${params.customerName}\n` +
        `🏠 ${params.address}`,
    ),
  );
}
