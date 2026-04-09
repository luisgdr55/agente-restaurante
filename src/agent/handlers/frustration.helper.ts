/**
 * Detección de frustración y escalado proactivo a humano.
 *
 * Se activa por cualquiera de estas vías:
 *   1. Frase de frustración en el texto (detección rápida, sin LLM)
 *   2. frustration_level >= 2 devuelto por el LLM en la extracción
 *   3. 2 intents 'OTHER' consecutivos en la misma sesión
 *
 * Cuando se activa:
 *   - level < 3 → ofrece opción al cliente (botones Sí/No)
 *   - level === 3 → escala directamente sin preguntar
 */
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { buttonMessage, textMessage } from '../../whatsapp/message-builder';
import { generateConversationSummary } from '../../llm/gemini-client';
import { getConfig } from '../../menu/config-service';
import { logger } from '../../utils/logger';

// ─── Frases de frustración (detección rápida sin LLM) ────────────────────────

const FRUSTRATION_PHRASES = [
  'queja', 'reclamo', 'reclamacion', 'reclamación',
  'devolucion', 'devolución', 'reembolso',
  'gerente', 'encargado', 'supervisor', 'dueño', 'dueno',
  'molesto', 'molesta', 'disgustado', 'disgustada',
  'inaceptable', 'inadmisible', 'vergüenza', 'verguenza',
  'terrible', 'pesimo', 'pésimo', 'fatal', 'horrible',
  'no funciona', 'no sirve', 'un asco', 'esto es un asco',
  'muy mal', 'muy mala', 'nunca más', 'nunca mas',
];

export function detectFrustrationFromText(text: string): boolean {
  const lower = text.toLowerCase();
  return FRUSTRATION_PHRASES.some((phrase) => lower.includes(phrase));
}

// ─── Oferta de escalado (nivel < 3) ──────────────────────────────────────────

export async function offerEscalation(phone: string, customerName: string): Promise<void> {
  await whatsappClient.sendMessage(
    buttonMessage(
      phone,
      `Lamentamos que hayas tenido esta experiencia, *${customerName}* 🙏\n\n¿Te gustaría que un asesor te atienda personalmente?`,
      [
        { id: 'escalate_to_human', title: '👤 Sí, hablar con asesor' },
        { id: 'continue_ordering',  title: '🍽️ No, continuar pidiendo' },
      ],
    ),
  );
}

// ─── Activación del escalado ──────────────────────────────────────────────────

export async function activateHumanEscalation(
  phone: string,
  session: SessionData,
  escalationReason: string | null,
  lastMessage: string,
): Promise<SessionData> {
  const name = session.customerName ?? 'Cliente';

  const cartSummary = session.cart.length > 0
    ? session.cart.map((i) => `${i.quantity}x ${i.name}`).join(', ')
    : '';

  const restaurantName = (await getConfig('RESTAURANT_NAME')) ?? 'el restaurante';

  // Generar resumen para el admin
  const summary = await generateConversationSummary({
    customerName: name,
    lastMessage,
    cartSummary,
    escalationReason,
    restaurantName,
  });

  // Notificar al admin con contexto completo (Mejora 3)
  const adminPhone = await getConfig('ADMIN_PHONE');
  if (adminPhone) {
    const reason = escalationReason ?? 'Solicitado por el cliente';
    const adminMsg =
      `🔔 *CLIENTE REQUIERE ATENCIÓN*\n` +
      `👤 Nombre: ${name}\n` +
      `📱 Número: +${phone}\n` +
      `⚡ Motivo: ${reason}\n\n` +
      `📋 *Resumen:*\n${summary}\n\n` +
      `💬 *Último mensaje:*\n"${lastMessage.slice(0, 200)}"`;

    await whatsappClient
      .sendMessage(
        buttonMessage(
          adminPhone,
          adminMsg,
          [
            { id: `ir_al_chat:${phone}`,       title: '💬 Ir al chat' },
            { id: `release_customer:${phone}`,  title: '🤖 Liberar al bot' },
          ],
          { header: '🔔 Cliente requiere atención' },
        ),
      )
      .catch((err: unknown) => logger.warn({ err }, 'Failed to notify admin of escalation'));
  }

  // Confirmar al cliente
  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `✅ Enseguida un asesor se pondrá en contacto contigo, *${name}* 👨‍💼\n\n_Puedes escribirme "menú" en cualquier momento para volver al bot._`,
    ),
  );

  return updateSessionState(phone, 'AWAITING_HUMAN', {
    customerId: session.customerId,
    customerName: session.customerName,
    cart: session.cart,
    consecutiveOtherCount: 0,
  });
}