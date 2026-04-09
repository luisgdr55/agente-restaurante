/**
 * Estado ORDER_CONFIRMATION — resumen del pedido antes de proceder al pago.
 *
 * Aplica la mejor promoción activa al carrito (si hay alguna).
 *
 * Transiciones:
 *   ORDER_CONFIRMATION → AWAITING_DELIVERY_TYPE   (confirma)
 *   ORDER_CONFIRMATION → BUILDING_ORDER            (modificar)
 *   ORDER_CONFIRMATION → MAIN_MENU                 (cancelar)
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { buttonMessage, textMessage, TEMPLATES } from '../../whatsapp/message-builder';
import { getExchangeRate, usdToBs, getConfig } from '../../menu/config-service';
import { createOrder, updateOrderStatus } from '../../orders/order-service';
import { showCartSummary } from './building-order.handler';
import { logger } from '../../utils/logger';

export async function handleOrderConfirmation(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;
  const name = session.customerName ?? 'cliente';

  if (session.cart.length === 0) {
    await whatsappClient.sendMessage(textMessage(phone, '🛒 Tu carrito está vacío.'));
    return updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId });
  }

  // ── Respuesta a botón ────────────────────────────────────────────────────
  if (msg.type === 'interactive' && msg.interactiveReply) {
    const { id } = msg.interactiveReply;

    if (id === 'confirm_go_delivery') {
      const ns = await updateSessionState(phone, 'AWAITING_DELIVERY_TYPE', {
        customerId: session.customerId, cart: session.cart,
        appliedPromotionId: session.appliedPromotionId, appliedDiscountUsd: session.appliedDiscountUsd,
      });
      await whatsappClient.sendMessage(TEMPLATES.askDeliveryType(phone));
      return ns;
    }

    if (id === 'confirm_modify') {
      const ns = await updateSessionState(phone, 'BUILDING_ORDER', { customerId: session.customerId, cart: session.cart });
      await showCartSummary(phone, ns);
      return ns;
    }

    if (id === 'confirm_cancel') {
      await recordCancelledOrder(session);
      await whatsappClient.sendMessage(
        textMessage(phone, '❌ Pedido cancelado. ¡Cuando quieras volvemos a empezar!'),
      );
      await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
      return updateSessionState(phone, 'MAIN_MENU', {
        customerId: session.customerId,
        cart: [],
        appliedPromotionId: undefined,
        appliedDiscountUsd: undefined,
      });
    }
  }

  // ── Texto ─────────────────────────────────────────────────────────────────
  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase().trim();
    if (lower === 'si' || lower === 'sí' || lower === 'confirmar') {
      const ns = await updateSessionState(phone, 'AWAITING_DELIVERY_TYPE', {
        customerId: session.customerId, cart: session.cart,
        appliedPromotionId: session.appliedPromotionId, appliedDiscountUsd: session.appliedDiscountUsd,
      });
      await whatsappClient.sendMessage(TEMPLATES.askDeliveryType(phone));
      return ns;
    }
    if (lower === 'cancelar' || lower === 'no') {
      await recordCancelledOrder(session);
      await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
      return updateSessionState(phone, 'MAIN_MENU', {
        customerId: session.customerId,
        cart: [],
        appliedPromotionId: undefined,
        appliedDiscountUsd: undefined,
      });
    }
  }

  // ── Mostrar resumen con promoción (si aplica) ─────────────────────────────
  await showConfirmationSummary(phone, session);
  return session;
}

// ── Registrar pedido cancelado en DB para trazabilidad ────────────────────────
// Se llama cuando el cliente cancela en la pantalla de confirmación, antes de
// elegir método de pago. Crea un registro CANCELLED para que aparezca en el dashboard.

async function recordCancelledOrder(session: SessionData): Promise<void> {
  if (!session.customerId || session.cart.length === 0) return;
  try {
    const order = await createOrder({
      customerId: session.customerId,
      cart: session.cart,
      deliveryType: 'PICKUP',       // placeholder — no fue elegido aún
      paymentMethod: 'PAGO_MOVIL',  // placeholder — no fue elegido aún
    });
    await updateOrderStatus(order.id, 'CANCELLED', {
      cancelReason: 'Cancelado por cliente antes de elegir método de pago',
    });
  } catch (err) {
    logger.warn({ err }, 'Could not record cancelled order — non-critical');
  }
}

export async function showConfirmationSummary(phone: string, session: SessionData): Promise<void> {
  const rate = await getExchangeRate();
  const deliveryFeeUsd = parseFloat((await getConfig('DELIVERY_FEE_USD')) ?? '1.50');
  const subtotalUsd = session.cart.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0);

  const itemLines = session.cart
    .map((i) => {
      const itemUsd = i.quantity * i.unitPriceUsd;
      return `• ${i.quantity}x *${i.name}* — $${itemUsd.toFixed(2)} | Bs ${usdToBs(itemUsd, rate).toFixed(2)}`;
    })
    .join('\n');

  const subtotalBs = usdToBs(subtotalUsd, rate);
  const deliveryBs = usdToBs(deliveryFeeUsd, rate);

  const body =
    `📋 *Confirma tu pedido:*\n\n${itemLines}\n\n` +
    `💰 Subtotal: *$${subtotalUsd.toFixed(2)} | Bs ${subtotalBs.toFixed(2)}*\n` +
    `🛵 Delivery _(si aplica)_: $${deliveryFeeUsd.toFixed(2)} | Bs ${deliveryBs.toFixed(2)}` +
    `\n\n¿Todo correcto?`;

  await whatsappClient.sendMessage(
    buttonMessage(
      phone,
      body,
      [
        { id: 'confirm_go_delivery', title: '✅ Sí, continuar' },
        { id: 'confirm_modify', title: '✏️ Modificar pedido' },
        { id: 'confirm_cancel', title: '❌ Cancelar' },
      ],
    ),
  );
}
