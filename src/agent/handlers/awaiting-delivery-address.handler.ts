/**
 * Estado AWAITING_DELIVERY_ADDRESS — recopila la dirección de entrega.
 *
 * Flujo:
 *   1. Si el cliente tiene dirección guardada en DB → ofrecer usarla o ingresar nueva
 *   2. Si no tiene guardada → pedir dirección directamente
 *
 *   addr_use_saved  → confirmAndProceed con dirección de DB
 *   addr_enter_new  → pedir nueva dirección
 *   texto libre     → confirmAndProceed con el texto como dirección
 *   location        → llega como texto via webhook, mismo flujo que texto libre
 *
 * Transición: → AWAITING_DELIVERY_REFERENCE
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage, buttonMessage, TEMPLATES } from '../../whatsapp/message-builder';
import { getCustomerSavedAddress, updateCustomerSavedAddress } from '../customer-service';
import { logger } from '../../utils/logger';

export async function handleAwaitingDeliveryAddress(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  // ── Respuesta a botones ──────────────────────────────────────────────────
  if (msg.type === 'interactive' && msg.interactiveReply) {
    const { id } = msg.interactiveReply;

    // Cliente elige usar la dirección guardada
    if (id === 'addr_use_saved') {
      const saved = session.customerId
        ? await getCustomerSavedAddress(session.customerId)
        : null;

      if (saved) {
        return confirmAndProceed(phone, saved, session);
      }

      // Dirección ya no existe en DB → pedir nueva
      await whatsappClient.sendMessage(
        textMessage(phone, '¿A qué dirección enviamos tu pedido?\nPuedes escribirla o compartir tu ubicación de WhatsApp 📍'),
      );
      return session;
    }

    // Cliente quiere ingresar una dirección nueva
    if (id === 'addr_enter_new') {
      await whatsappClient.sendMessage(
        textMessage(phone, '📍 Escribe la dirección completa o comparte tu ubicación de WhatsApp 📌'),
      );
      return session;
    }
  }

  // ── Texto libre (incluye location convertida a texto por el webhook) ─────
  if (msg.type === 'text' && msg.text) {
    if (msg.text.trim().length >= 5) {
      const address = msg.text.trim();
      if (session.customerId) {
        void updateCustomerSavedAddress(session.customerId, address).catch((err: unknown) => {
        logger.error({ err, customerId: session.customerId }, 'Failed to save delivery address');
      });
      }
      return confirmAndProceed(phone, address, session);
    }

    // Texto demasiado corto
    await whatsappClient.sendMessage(
      textMessage(phone, '📍 La dirección parece muy corta. Por favor escribe la dirección completa o comparte tu ubicación de WhatsApp 📌'),
    );
    return session;
  }

  // ── Default: mostrar opciones al entrar al estado ────────────────────────
  if (session.customerId) {
    const saved = await getCustomerSavedAddress(session.customerId);
    if (saved) {
      await whatsappClient.sendMessage(TEMPLATES.askDeliveryAddressWithSaved(phone, saved));
      return session;
    }
  }

  await whatsappClient.sendMessage(
    textMessage(phone, '¿A qué dirección enviamos tu pedido?\nPuedes escribirla o compartir tu ubicación de WhatsApp 📍'),
  );
  return session;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function confirmAndProceed(
  phone: string,
  address: string,
  session: SessionData,
): Promise<SessionData> {
  await whatsappClient.sendMessage(
    textMessage(phone, `📍 *Dirección registrada:*\n${address}`),
  );

  const newSession = await updateSessionState(phone, 'AWAITING_DELIVERY_REFERENCE', {
    customerId: session.customerId,
    customerName: session.customerName,
    cart: session.cart,
    deliveryType: 'DELIVERY',
    deliveryAddress: address,
  });

  await whatsappClient.sendMessage(
    buttonMessage(
      phone,
      '¿Algún punto de referencia para el motorizado?\n_(ej: frente al banco, casa azul, al lado de la farmacia)_',
      [{ id: 'ref_none', title: 'Sin referencia' }],
    ),
  );

  return newSession;
}
