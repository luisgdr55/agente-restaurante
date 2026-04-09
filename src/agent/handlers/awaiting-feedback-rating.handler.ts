/**
 * Estado AWAITING_FEEDBACK_RATING — esperando calificación con estrellas.
 *
 * Entradas válidas:
 *   - Lista interactiva: feedback_rating_1 … feedback_rating_5
 *   - Texto "/menu" → salta feedback, va a MAIN_MENU
 *   - Cualquier otro texto → reenvía los botones (no muestra error)
 *
 * Validación: el rating extraído del ID debe estar en [1, 5].
 * Si está fuera de rango (bug), se reenvían los botones sin mensaje de error.
 *
 * Transición: → AWAITING_FEEDBACK_COMMENT (con pendingFeedbackRating guardado)
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { TEMPLATES } from '../../whatsapp/message-builder';

const SKIP_PHRASES = ['/menu', 'menu', 'saltar', 'omitir', 'skip'];

export async function handleAwaitingFeedbackRating(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  // ── Skip explícito ────────────────────────────────────────────────────────
  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.trim().toLowerCase();
    if (SKIP_PHRASES.some((p) => lower.startsWith(p))) {
      return updateSessionState(phone, 'MAIN_MENU', {
        customerId: session.customerId,
        customerName: session.customerName,
        cart: [],
        pendingFeedbackOrderId: undefined,
        feedbackRequestedAt: undefined,
      });
    }
  }

  // ── Selección de lista interactiva ────────────────────────────────────────
  if (msg.type === 'interactive' && msg.interactiveReply) {
    const btnId = msg.interactiveReply.id;
    if (btnId.startsWith('feedback_rating_')) {
      const raw = parseInt(btnId.replace('feedback_rating_', ''), 10);

      // Validación de rango — Prisma no valida Int, lo hacemos aquí
      if (isNaN(raw) || raw < 1 || raw > 5) {
        await whatsappClient.sendMessage(TEMPLATES.feedbackRating(phone));
        return session;
      }

      // Guardar rating y transicionar a AWAITING_FEEDBACK_COMMENT
      const nextState = await updateSessionState(phone, 'AWAITING_FEEDBACK_COMMENT', {
        customerId: session.customerId,
        customerName: session.customerName,
        cart: [],
        pendingFeedbackOrderId: session.pendingFeedbackOrderId,
        pendingFeedbackRating: raw,
        feedbackRequestedAt: session.feedbackRequestedAt,
      });

      // Prompt de comentario diferenciado por calificación
      const prompt = raw >= 4
        ? TEMPLATES.feedbackCommentPositive(phone)
        : TEMPLATES.feedbackCommentNegative(phone);
      await whatsappClient.sendMessage(prompt);

      return nextState;
    }
  }

  // ── Cualquier otro mensaje → reenviar lista ───────────────────────────────
  await whatsappClient.sendMessage(TEMPLATES.feedbackRating(phone));
  return session;
}
