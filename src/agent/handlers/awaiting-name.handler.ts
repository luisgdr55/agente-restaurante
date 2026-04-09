/**
 * Estado AWAITING_NAME — esperando que el cliente proporcione su nombre.
 *
 * Transiciones:
 *   AWAITING_NAME → AWAITING_NAME   (nombre inválido — reintentar con variante)
 *   AWAITING_NAME → MAIN_MENU       (nombre válido)
 *
 * NUNCA usa LLM — validación por regex puro.
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { TEMPLATES, textMessage } from '../../whatsapp/message-builder';
import { validateName } from '../name-validator';
import { updateCustomerName } from '../customer-service';
import { showCartSummary } from './building-order.handler';
import { logger } from '../../utils/logger';

export async function handleAwaitingName(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  // Tipos no-texto (imagen, audio, etc.) → pedir nombre de nuevo
  if (msg.type !== 'text' || !msg.text) {
    await whatsappClient.sendMessage(TEMPLATES.askNameRetryC(phone));
    return session;
  }

  const result = validateName(msg.text);

  if (!result.valid) {
    const template =
      result.reason === 'TOO_SHORT'
        ? TEMPLATES.askNameRetryA(phone)
        : result.reason === 'ONLY_NUMBERS'
          ? TEMPLATES.askNameRetryB(phone)
          : TEMPLATES.askNameRetryC(phone);

    await whatsappClient.sendMessage(template);
    return session;
  }

  // Nombre válido
  const { name } = result;
  logger.info({ phone, name }, 'Customer name captured');

  // Persistir en DB
  if (session.customerId) {
    await updateCustomerName(session.customerId, name);
  }

  // Si el cliente tenía un pedido pendiente (escribió productos antes de dar su nombre)
  if (session.cart && session.cart.length > 0) {
    const itemLines = session.cart.map((i) => `• ${i.quantity}x ${i.name}`).join('\n');
    await whatsappClient.sendMessage(
      textMessage(
        phone,
        `¡Bienvenido, *${name}*! 👋\n\nTu pedido ha sido añadido al carrito:\n${itemLines}`,
      ),
    );
    const newSession = await updateSessionState(phone, 'BUILDING_ORDER', {
      customerId: session.customerId,
      customerName: name,
      cart: session.cart,
    });
    await showCartSummary(phone, newSession);
    return newSession;
  }

  // Sin pedido pendiente → menú principal
  const newSession = await updateSessionState(phone, 'MAIN_MENU', {
    customerId: session.customerId,
    customerName: name,
  });
  await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
  return newSession;
}
