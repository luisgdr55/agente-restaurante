/**
 * Estado AWAITING_DELIVERY_TYPE — ¿Delivery o Pickup?
 *
 * Transiciones:
 *   → AWAITING_DELIVERY_ADDRESS   (eligió delivery)
 *   → AWAITING_PAYMENT_METHOD     (eligió pickup)
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage, TEMPLATES } from '../../whatsapp/message-builder';
import { getConfig } from '../../menu/config-service';
import { getCustomerSavedAddress } from '../customer-service';

export async function handleAwaitingDeliveryType(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  // Verificar si delivery está disponible
  const deliveryAvailable = (await getConfig('DELIVERY_AVAILABLE')) !== 'false';

  if (msg.type === 'interactive' && msg.interactiveReply) {
    const { id } = msg.interactiveReply;

    if (id === 'delivery_delivery') {
      if (!deliveryAvailable) {
        await whatsappClient.sendMessage(
          textMessage(phone, '😔 El delivery no está disponible en este momento. Solo podemos atender retiros en local.'),
        );
        await whatsappClient.sendMessage(TEMPLATES.askDeliveryType(phone));
        return session;
      }
      const ns = await updateSessionState(phone, 'AWAITING_DELIVERY_ADDRESS', { customerId: session.customerId, cart: session.cart, deliveryType: 'DELIVERY' });
      await sendDeliveryAddressPrompt(phone, session.customerId);
      return ns;
    }

    if (id === 'delivery_pickup') {
      const ns = await updateSessionState(phone, 'AWAITING_PAYMENT_METHOD', { customerId: session.customerId, cart: session.cart, deliveryType: 'PICKUP' });
      await whatsappClient.sendMessage(TEMPLATES.askPaymentMethod(phone));
      return ns;
    }
  }

  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase();
    if (lower.includes('delivery') || lower.includes('domicilio') || lower.includes('enviar')) {
      if (!deliveryAvailable) {
        await whatsappClient.sendMessage(textMessage(phone, '😔 Delivery no disponible ahora. Solo retiro en local.'));
      } else {
        const ns = await updateSessionState(phone, 'AWAITING_DELIVERY_ADDRESS', { customerId: session.customerId, cart: session.cart, deliveryType: 'DELIVERY' });
        await sendDeliveryAddressPrompt(phone, session.customerId);
        return ns;
      }
    }
    if (lower.includes('pickup') || lower.includes('retiro') || lower.includes('busco') || lower.includes('local')) {
      const ns = await updateSessionState(phone, 'AWAITING_PAYMENT_METHOD', { customerId: session.customerId, cart: session.cart, deliveryType: 'PICKUP' });
      await whatsappClient.sendMessage(TEMPLATES.askPaymentMethod(phone));
      return ns;
    }
  }

  await whatsappClient.sendMessage(TEMPLATES.askDeliveryType(phone));
  return session;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function sendDeliveryAddressPrompt(phone: string, customerId?: string): Promise<void> {
  if (customerId) {
    const saved = await getCustomerSavedAddress(customerId);
    if (saved) {
      await whatsappClient.sendMessage(TEMPLATES.askDeliveryAddressWithSaved(phone, saved));
      return;
    }
  }
  await whatsappClient.sendMessage(TEMPLATES.askDeliveryAddress(phone));
}
