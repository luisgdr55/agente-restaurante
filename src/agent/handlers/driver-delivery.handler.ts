/**
 * Manejo de mensajes de motorizados.
 *
 * Llamado ANTES de findOrCreateCustomer en conversation-agent.ts
 * para evitar crear registros de Customer para motorizados.
 *
 * Dos funciones públicas:
 *   handleRegisteredDriver  — motorizado con entrega activa en OUT_FOR_DELIVERY
 *   handleUnregisteredDriverAttempt — número desconocido que suena a confirmación
 */
import type { Logger } from 'pino';
import type { IncomingMessage } from '../types';
import { detectDeliveryConfirmation } from '../../llm/gemini-client';
import { whatsappClient } from '../../whatsapp/client';
import { TEMPLATES, textMessage } from '../../whatsapp/message-builder';
import { notifyDeliveryConfirmed, notifyUnregisteredDriverAttempt } from '../../notifications/admin-notifier';
import { triggerOrderDelivered, loadCartSummary } from './order-delivered.helper';

// Tipo del resultado de findActiveDeliveryByDriverPhone
// (Prisma include: customer + driver + items.menuItem)
type ActiveDeliveryOrder = NonNullable<
  Awaited<ReturnType<typeof import('../../orders/order-service').findActiveDeliveryByDriverPhone>>
>;

// ─── Motorizado registrado con entrega activa ─────────────────────────────────

/**
 * Procesa el mensaje de un motorizado registrado cuyo driverPhone coincide
 * con una Order en OUT_FOR_DELIVERY.
 *
 * @returns true siempre — el mensaje fue manejado (no continuar flujo de cliente)
 */
export async function handleRegisteredDriver(
  msg: IncomingMessage,
  order: ActiveDeliveryOrder,
  msgLog: Logger,
): Promise<boolean> {
  const driverPhone = msg.phone;
  const driverName = order.driver?.name ?? 'motorizado';

  // Botón "✅ Entregado" presionado desde el mensaje de asignación
  if (msg.type === 'interactive' && msg.interactiveReply?.id.startsWith('driver_delivered:')) {
    const orderId = msg.interactiveReply.id.replace('driver_delivered:', '');
    if (orderId !== order.id) {
      await whatsappClient.sendMessage(textMessage(driverPhone, '✅ Este pedido ya fue cerrado.'));
      return true;
    }
    msgLog.info({ phone: driverPhone, orderId }, 'Driver confirmed delivery via button');
    const customerPhone = order.customer.phone;
    const meta = await loadCartSummary(order.id);
    await triggerOrderDelivered(customerPhone, order.id);
    await notifyDeliveryConfirmed({
      orderNumber: order.orderNumber,
      driverName,
      customerName: meta?.customerName ?? customerPhone,
      customerPhone,
      cartSummary: meta?.cartSummary ?? '(sin detalle)',
      deliveryAddress: meta?.deliveryAddress ?? 'sin dirección',
    });
    await whatsappClient.sendMessage(TEMPLATES.driverDeliveryConfirmed(driverPhone, driverName));
    return true;
  }

  const isConfirmation = await detectDeliveryConfirmation(msg.text ?? '');

  if (!isConfirmation) {
    await whatsappClient.sendMessage(TEMPLATES.driverDeliveryPrompt(driverPhone, driverName));
    msgLog.info({ orderId: order.id, driverPhone }, 'Driver message not a confirmation — prompted');
    return true;
  }

  // Es confirmación de entrega
  const customerPhone = order.customer.phone;
  const meta = await loadCartSummary(order.id);

  // Cerrar pedido + actualizar sesión del cliente (Feature 2 añadirá agradecimiento)
  await triggerOrderDelivered(customerPhone, order.id);

  // Notificar al admin
  await notifyDeliveryConfirmed({
    orderNumber: order.orderNumber,
    driverName,
    customerName: meta?.customerName ?? customerPhone,
    customerPhone,
    cartSummary: meta?.cartSummary ?? '(sin detalle)',
    deliveryAddress: meta?.deliveryAddress ?? 'sin dirección',
  });

  // Confirmar al motorizado
  await whatsappClient.sendMessage(TEMPLATES.driverDeliveryConfirmed(driverPhone, driverName));

  msgLog.info({ orderId: order.id, driverPhone }, 'Delivery confirmed by driver');
  return true;
}

// ─── Número desconocido que suena a confirmación ──────────────────────────────

/**
 * Se llama SOLO si el número no tiene sesión Redis activa y no es un driver
 * registrado. Detecta si el mensaje suena a confirmación de entrega y avisa
 * al admin sin crear sesión ni Customer.
 *
 * @returns true si el mensaje fue detectado como intento de entrega (handled)
 *          false si es simplemente un cliente nuevo (flujo normal)
 */
export async function handleUnregisteredDriverAttempt(
  phone: string,
  text: string,
  adminPhone: string | null,
  msgLog: Logger,
): Promise<boolean> {
  const isConfirmation = await detectDeliveryConfirmation(text);
  if (!isConfirmation) return false;

  // Aviso al número desconocido
  await whatsappClient.sendMessage(TEMPLATES.driverNotRegistered(phone));

  // Aviso al admin (no bloqueante si falla)
  await notifyUnregisteredDriverAttempt({ phone }).catch(() => undefined);

  msgLog.warn({ phone, adminPhone }, 'Unregistered driver attempted delivery confirmation');
  return true;
}
