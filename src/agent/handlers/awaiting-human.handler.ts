/**
 * Estado AWAITING_HUMAN — el cliente fue transferido a un asesor humano.
 *
 * Comportamiento:
 *   - Cada mensaje del cliente se reenvía al admin por WhatsApp
 *   - El admin puede responder escribiendo directamente al número del cliente
 *   - El cliente puede volver al bot con "menú" / "bot" / "ordenar"
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { TEMPLATES, textMessage } from '../../whatsapp/message-builder';
import { getConfig } from '../../menu/config-service';

const RETURN_TO_BOT_KEYWORDS = ['bot', 'menú', 'menu', 'ordenar', 'pedido'];

export async function handleAwaitingHuman(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;
  const name = session.customerName ?? 'Cliente';

  // ── Volver al bot ────────────────────────────────────────────────────────
  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase().trim();

    if (RETURN_TO_BOT_KEYWORDS.some((kw) => lower.includes(kw))) {
      await whatsappClient.sendMessage(
        textMessage(phone, `✅ ¡De vuelta con el bot! ¿Qué necesitas, *${name}*?`),
      );
      await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
      return updateSessionState(phone, 'MAIN_MENU', {
        customerId: session.customerId,
        customerName: name,
      });
    }
  }

  // ── Reenviar mensaje al admin ────────────────────────────────────────────
  const adminPhone = await getConfig('ADMIN_PHONE');
  if (adminPhone) {
    let forwardText = `💬 *${name}* (${phone}):\n`;

    if (msg.type === 'text' && msg.text) {
      forwardText += msg.text;
    } else if (msg.type === 'image') {
      forwardText += '📷 _[Imagen]_';
    } else if (msg.type === 'audio') {
      forwardText += '🎤 _[Audio]_';
    } else if (msg.type === 'location') {
      forwardText += '📍 _[Ubicación]_';
    } else {
      forwardText += '_[Mensaje multimedia]_';
    }

    forwardText += `\n\n_Respóndele directo a su número o escríbeme /liberar ${phone} para devolverlo al bot._`;

    await whatsappClient.sendMessage(textMessage(adminPhone, forwardText)).catch(() => undefined);
  }

  // Confirmar al cliente que el mensaje fue recibido (solo la primera vez)
  await whatsappClient.sendMessage(
    textMessage(phone, '✉️ Mensaje enviado al asesor. Te responderá en breve 👨‍💼'),
  );

  return session;
}
