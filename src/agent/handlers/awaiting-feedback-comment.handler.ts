/**
 * Estado AWAITING_FEEDBACK_COMMENT — comentario libre opcional.
 *
 * Entradas válidas:
 *   - Texto con contenido → guardar Review con comment
 *   - Texto "/menu" o frases de skip → guardar Review sin comment
 *   - Cualquier otro tipo (imagen, audio) → tratar como skip
 *
 * En ambos casos: agradecer + → MAIN_MENU
 *
 * Si no hay pendingFeedbackOrderId o pendingFeedbackRating en sesión
 * (estado inconsistente), se va directo a MAIN_MENU sin guardar.
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { TEMPLATES } from '../../whatsapp/message-builder';
import { prisma } from '../../db/prisma';
import { logger } from '../../utils/logger';

const SKIP_PHRASES = ['/menu', 'menu', 'saltar', 'omitir', 'skip', 'no', 'nada', 'ninguno'];

export async function handleAwaitingFeedbackComment(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;
  const orderId  = session.pendingFeedbackOrderId;
  const rating   = session.pendingFeedbackRating;
  const customerId = session.customerId;

  // Estado inconsistente → limpiar silenciosamente
  if (!orderId || !rating || !customerId) {
    return updateSessionState(phone, 'MAIN_MENU', {
      customerId: session.customerId,
      customerName: session.customerName,
      cart: [],
      pendingFeedbackOrderId: undefined,
      pendingFeedbackRating: undefined,
      feedbackRequestedAt: undefined,
    });
  }

  // ── Determinar si es skip o comentario real ───────────────────────────────
  let comment: string | undefined;

  if (msg.type === 'text' && msg.text) {
    const trimmed = msg.text.trim();
    const lower = trimmed.toLowerCase();
    const isSkip = SKIP_PHRASES.some((p) => lower.startsWith(p)) || trimmed.length < 2;
    if (!isSkip) {
      comment = trimmed.slice(0, 1000); // límite razonable
    }
  }
  // Imágenes, audio, stickers → skip silencioso (sin comment)

  // ── Guardar Review en DB ──────────────────────────────────────────────────
  try {
    await prisma.review.create({
      data: {
        orderId,
        customerId,
        rating,
        ...(comment !== undefined && { comment }),
      },
    });
  } catch (err) {
    // Si ya existe una review para este pedido (unica por orderId), ignorar silenciosamente
    logger.warn({ err, orderId }, 'Failed to save review — may already exist');
  }

  // ── Agradecer y volver al menú ────────────────────────────────────────────
  await whatsappClient.sendMessage(TEMPLATES.feedbackThanks(phone, comment !== undefined));

  return updateSessionState(phone, 'MAIN_MENU', {
    customerId: session.customerId,
    customerName: session.customerName,
    cart: [],
    pendingFeedbackOrderId: undefined,
    pendingFeedbackRating: undefined,
    feedbackRequestedAt: undefined,
  });
}
