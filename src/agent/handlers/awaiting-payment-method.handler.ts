/**
 * Estado AWAITING_PAYMENT_METHOD — elegir método de pago.
 *
 * Efectivo solo disponible para PICKUP.
 * Transiciones:
 *   → AWAITING_PAYMENT_PROOF    (pago móvil: crea orden, muestra datos bancarios)
 *   → ORDER_IN_KITCHEN          (efectivo: crea orden, notifica admin)
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage, TEMPLATES } from '../../whatsapp/message-builder';
import { getConfig, getExchangeRate, usdToBs } from '../../menu/config-service';
import { createOrder } from '../../orders/order-service';
import { notifyNewCashOrder } from '../../notifications/admin-notifier';
import { logger } from '../../utils/logger';

export async function handleAwaitingPaymentMethod(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;
  const deliveryType = session.deliveryType ?? 'PICKUP';

  if (msg.type === 'interactive' && msg.interactiveReply) {
    const { id } = msg.interactiveReply;

    if (id === 'pay_movil') {
      return handlePayMovil(phone, session);
    }

    if (id === 'pay_cash') {
      if (deliveryType !== 'PICKUP') {
        await whatsappClient.sendMessage(
          textMessage(phone, '💵 El pago en efectivo solo está disponible para retiro en local.'),
        );
        await whatsappClient.sendMessage(TEMPLATES.askPaymentMethod(phone));
        return session;
      }
      return handleCashPayment(phone, session);
    }

    if (id === 'change_address') {
      return updateSessionState(phone, 'AWAITING_DELIVERY_ADDRESS', {
        customerId: session.customerId,
        customerName: session.customerName,
        cart: session.cart,
        deliveryType: 'DELIVERY',
        // deliveryZone y deliveryAddress limpiados intencionalmente
      });
    }
  }

  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase();
    if (lower.includes('móvil') || lower.includes('movil') || lower.includes('transferencia') || lower.includes('pago')) {
      return handlePayMovil(phone, session);
    }
    if (lower.includes('efectivo') || lower.includes('cash')) {
      if (deliveryType !== 'PICKUP') {
        await whatsappClient.sendMessage(
          textMessage(phone, '💵 Efectivo solo disponible para retiro en local.'),
        );
      } else {
        return handleCashPayment(phone, session);
      }
    }
  }

  await whatsappClient.sendMessage(
    deliveryType === 'DELIVERY'
      ? TEMPLATES.askPaymentMethodDelivery(phone)
      : TEMPLATES.askPaymentMethod(phone),
  );
  return session;
}

// ─── Flujo pago móvil ─────────────────────────────────────────────────────────

async function handlePayMovil(phone: string, session: SessionData): Promise<SessionData> {
  if (!session.customerId) {
    await whatsappClient.sendMessage(TEMPLATES.error(phone));
    return session;
  }

  const rate = await getExchangeRate();
  const deliveryFeeUsd = session.deliveryType === 'DELIVERY'
    ? parseFloat((await getConfig('DELIVERY_FEE_USD')) ?? '1.50')
    : 0;

  const itemsUsd = session.cart.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0);
  const totalBs = usdToBs(itemsUsd + deliveryFeeUsd, rate);

  // Crear orden en DB (totalUsd/totalBs ya incluye delivery fee)
  const order = await createOrder({
    customerId: session.customerId,
    cart: session.cart,
    deliveryType: session.deliveryType ?? 'PICKUP',
    ...(session.deliveryAddress !== undefined && { deliveryAddress: session.deliveryAddress }),
    ...(session.deliveryReference !== undefined && { deliveryReference: session.deliveryReference }),
    paymentMethod: 'PAGO_MOVIL',
    ...(session.appliedDiscountUsd !== undefined && { discountUsd: session.appliedDiscountUsd }),
    ...(session.appliedPromotionId !== undefined && { promotionId: session.appliedPromotionId }),
    ...(deliveryFeeUsd > 0 && { deliveryFeeUsd }),
  });

  logger.info({ orderId: order.id, phone }, 'Order created for pago movil');

  // Mostrar datos de pago
  const bank    = (await getConfig('PAGO_MOVIL_BANK'))   ?? 'N/A';
  const pmPhone = (await getConfig('PAGO_MOVIL_PHONE'))  ?? 'N/A';
  const holder  = (await getConfig('PAGO_MOVIL_HOLDER')) ?? 'N/A';
  const rif     = (await getConfig('PAGO_MOVIL_RIF'))    ?? 'N/A';

  await whatsappClient.sendMessage(
    TEMPLATES.paymentDetails(phone, bank, pmPhone, holder, rif, totalBs, itemsUsd + deliveryFeeUsd),
  );

  return updateSessionState(phone, 'AWAITING_PAYMENT_PROOF', {
    customerId: session.customerId,
    cart: session.cart,
    deliveryType: session.deliveryType,
    deliveryAddress: session.deliveryAddress,
    ...(session.deliveryReference !== undefined && { deliveryReference: session.deliveryReference }),
    paymentMethod: 'PAGO_MOVIL',
    activeOrderId: order.id,
  });
}

// ─── Flujo efectivo ───────────────────────────────────────────────────────────

async function handleCashPayment(phone: string, session: SessionData): Promise<SessionData> {
  if (!session.customerId) {
    await whatsappClient.sendMessage(TEMPLATES.error(phone));
    return session;
  }

  const order = await createOrder({
    customerId: session.customerId,
    cart: session.cart,
    deliveryType: 'PICKUP',
    paymentMethod: 'CASH_ON_DELIVERY',
  });

  // Use order totals from DB for consistency
  const orderTotalBs = parseFloat(order.totalBs.toString());
  const orderTotalUsd = parseFloat(order.totalUsd.toString());

  await notifyNewCashOrder({
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: session.customerName ?? 'Cliente',
    customerPhone: phone,
    cart: session.cart,
    totalBs: orderTotalBs,
  });

  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `✅ *Pedido #${String(order.orderNumber).padStart(4, '0')} recibido*\n\n` +
      `💰 *Total a pagar al retirar:*\n` +
      `   Bs ${orderTotalBs.toFixed(2)}  ·  $${orderTotalUsd.toFixed(2)} USD\n\n` +
      `Puedes pagar en efectivo (USD o Bs) 🏃\n\nTe avisaremos cuando esté listo. 🍳`,
    ),
  );

  return updateSessionState(phone, 'ORDER_IN_KITCHEN', {
    customerId: session.customerId,
    cart: session.cart,
    deliveryType: 'PICKUP',
    paymentMethod: 'CASH_ON_DELIVERY',
    activeOrderId: order.id,
  });
}
