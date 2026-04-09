/**
 * Estado AWAITING_DELIVERY_REFERENCE — esperando punto de referencia opcional.
 *
 * Acepta:
 *   - Botón "Sin referencia"  → omite el campo, continúa sin referencia
 *   - Texto libre             → guarda como deliveryReference
 *   - "no" / "ninguno" / "n/a" → omite igual que el botón
 *
 * Transición: → AWAITING_PAYMENT_METHOD
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { TEMPLATES } from '../../whatsapp/message-builder';

const SKIP_PHRASES = ['no', 'ninguno', 'ninguna', 'n/a', 'nada', 'no tengo', 'sin referencia'];

export async function handleAwaitingDeliveryReference(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  // Botón "Sin referencia"
  if (msg.type === 'interactive' && msg.interactiveReply?.id === 'ref_none') {
    return proceedToPayment(phone, session, undefined);
  }

  // Texto libre
  if (msg.type === 'text' && msg.text) {
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    const skip = SKIP_PHRASES.some((p) => lower === p || lower.startsWith(p + ' '));
    const reference = skip ? undefined : text;

    return proceedToPayment(phone, session, reference);
  }

  // Cualquier otro tipo — repetir la pregunta
  await whatsappClient.sendMessage(
    TEMPLATES.askPaymentMethod(phone),
  );
  return session;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function proceedToPayment(
  phone: string,
  session: SessionData,
  reference: string | undefined,
): Promise<SessionData> {
  const newSession = await updateSessionState(phone, 'AWAITING_PAYMENT_METHOD', {
    customerId: session.customerId,
    customerName: session.customerName,
    cart: session.cart,
    deliveryType: session.deliveryType,
    deliveryAddress: session.deliveryAddress,
    ...(reference !== undefined && { deliveryReference: reference }),
  });

  await whatsappClient.sendMessage(TEMPLATES.askPaymentMethod(phone));
  return newSession;
}
