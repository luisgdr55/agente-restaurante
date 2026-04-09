/**
 * Estado ORDER_IN_KITCHEN — pedido confirmado y en cocina.
 *
 * Estado pasivo: el bot informa al cliente que su pedido está en preparación.
 * La transición OUT viene del admin cuando marca el pedido como listo/entregado.
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage } from '../../whatsapp/message-builder';
import { updateOrderStatus, shortOrderId } from '../../orders/order-service';

export async function handleOrderInKitchen(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase().trim();

    if (lower === 'cancelar') {
      // Solo permitir cancelación si el pedido no fue entregado aún
      if (session.activeOrderId) {
        await updateOrderStatus(session.activeOrderId, 'CANCELLED', {
          cancelReason: 'Cancelado por cliente mientras estaba en cocina',
        });
      }
      await whatsappClient.sendMessage(
        textMessage(phone, '❌ Pedido cancelado. Disculpa los inconvenientes.'),
      );
      return updateSessionState(phone, 'MAIN_MENU', {
        customerId: session.customerId,
        cart: [],
        activeOrderId: undefined,
      });
    }

    if (lower === 'estado' || lower === 'estatus') {
      const sId = session.activeOrderId ? shortOrderId(session.activeOrderId) : '???';
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          `🍳 Tu pedido *#${sId}* está en preparación.\n\nTe avisaremos cuando esté listo.`,
        ),
      );
      return session;
    }
  }

  // Cualquier otro mensaje → recordar estado actual
  const sId = session.activeOrderId ? shortOrderId(session.activeOrderId) : '???';
  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `🍳 Tu pedido *#${sId}* está siendo preparado.\n\nEscribe *estado* para consultar o *cancelar* para cancelar.`,
    ),
  );
  return session;
}
