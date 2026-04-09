/**
 * Estado PAYMENT_UNDER_REVIEW — pago enviado, esperando confirmación del admin.
 *
 * Estado pasivo: el bot no hace nada mientras el admin revisa.
 * El cliente puede cancelar si aún no fue confirmado.
 * Transición real: viene desde admin-handler cuando confirma/rechaza.
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage } from '../../whatsapp/message-builder';
import { updateOrderStatus } from '../../orders/order-service';

export async function handlePaymentUnderReview(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase().trim();

    if (lower === 'cancelar') {
      if (session.activeOrderId) {
        await updateOrderStatus(session.activeOrderId, 'CANCELLED', {
          cancelReason: 'Cancelado por cliente durante revisión de pago',
        });
      }
      await whatsappClient.sendMessage(
        textMessage(phone, '❌ Pedido cancelado. Si necesitas ayuda escríbenos.'),
      );
      return updateSessionState(phone, 'MAIN_MENU', {
        customerId: session.customerId,
        cart: [],
        activeOrderId: undefined,
      });
    }

    if (lower === 'estado' || lower === 'estatus') {
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          '⏳ Tu pago está siendo verificado por nuestro equipo.\n\nTe notificaremos en breve. ¡Gracias por tu paciencia!',
        ),
      );
      return session;
    }
  }

  // Para cualquier otro mensaje: recordar al cliente que está en espera
  await whatsappClient.sendMessage(
    textMessage(
      phone,
      '⏳ Tu comprobante está siendo revisado.\n\nEscribe *cancelar* si deseas cancelar el pedido.',
    ),
  );
  return session;
}
