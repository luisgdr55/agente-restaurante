/**
 * Estado AWAITING_PAYMENT_PROOF — esperando comprobante de pago.
 *
 * Acepta:
 *   - Imagen → guarda mediaId, encola job OCR (async), transiciona inmediatamente
 *   - Texto con número de referencia (4-25 dígitos) → procesa directamente
 *
 * Transición: → PAYMENT_UNDER_REVIEW (notifica admin con botones Confirmar/Rechazar)
 *
 * Para imágenes el OCR corre en background (ocr-worker). Si extrae referencia,
 * actualiza la orden y notifica al admin. El cliente ya está en PAYMENT_UNDER_REVIEW.
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage, TEMPLATES } from '../../whatsapp/message-builder';
import { updateOrderStatus, getOrderById } from '../../orders/order-service';
import { notifyPaymentReceived } from '../../notifications/admin-notifier';
import type { PaymentReceiptData } from '../../ocr/ocr-service';
import { ocrQueue } from '../../workers/queues';
import { prisma } from '../../db/prisma';
import { logger } from '../../utils/logger';

// Acepta referencias de 4 a 25 dígitos (últimos 4 dígitos o referencia completa)
const REGEX_SHORT_REFERENCE = /^\d{4,25}$/;
const REGEX_INLINE_REFERENCE = /\b\d{8,25}\b/;

export async function handleAwaitingPaymentProof(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  if (!session.activeOrderId) {
    logger.error({ phone }, 'No activeOrderId in AWAITING_PAYMENT_PROOF');
    await whatsappClient.sendMessage(TEMPLATES.error(phone));
    return updateSessionState(phone, 'MAIN_MENU', { customerId: session.customerId });
  }

  // ── Imagen → OCR async ────────────────────────────────────────────────────
  if (msg.type === 'image' && msg.imageId) {
    return processImageProof(phone, session, msg.imageId);
  }

  // ── Texto con referencia ─────────────────────────────────────────────────
  if (msg.type === 'text' && msg.text) {
    const trimmed = msg.text.trim();
    const lower = trimmed.toLowerCase();

    if (lower === 'cancelar') {
      await updateOrderStatus(session.activeOrderId, 'CANCELLED', {
        cancelReason: 'Cancelado por cliente antes de confirmar pago',
      });
      await whatsappClient.sendMessage(textMessage(phone, '❌ Pedido cancelado.'));
      return updateSessionState(phone, 'MAIN_MENU', {
        customerId: session.customerId,
        cart: [],
        activeOrderId: undefined,
      });
    }

    // Texto completo es solo dígitos (4-25): referencia corta o completa
    if (REGEX_SHORT_REFERENCE.test(trimmed)) {
      return processReferenceProof(phone, session, trimmed);
    }

    // Texto contiene una secuencia larga de dígitos embebida
    const inlineMatch = trimmed.match(REGEX_INLINE_REFERENCE);
    if (inlineMatch?.[0]) {
      return processReferenceProof(phone, session, inlineMatch[0]);
    }

    await whatsappClient.sendMessage(
      textMessage(
        phone,
        '🤔 No encontré un número de referencia en tu mensaje.\n\n' +
          'Puedes enviar:\n• 📸 *Una foto* del comprobante\n• 🔢 Los *últimos 4 dígitos* de la referencia\n• 🔢 El *número de referencia completo*',
      ),
    );
    return session;
  }

  // ── Audio, sticker, etc. → ignorar ───────────────────────────────────────
  await whatsappClient.sendMessage(
    textMessage(
      phone,
      '📸 Envía la *foto del comprobante* o el *número de referencia* del pago.\n\nPuedes enviar solo los *últimos 4 dígitos* si prefieres.',
    ),
  );
  return session;
}

// ─── Imagen: guardar + encolar OCR + transicionar ────────────────────────────

async function processImageProof(
  phone: string,
  session: SessionData,
  imageId: string,
): Promise<SessionData> {
  const orderId = session.activeOrderId!;

  // Marcar orden como recibida (la referencia llegará del OCR worker)
  await updateOrderStatus(orderId, 'PAYMENT_UPLOADED', {
    paymentImageUrl: `wa_media:${imageId}`,
  });

  // Encolar OCR en background — el worker descargará, procesará y notificará al admin
  await ocrQueue.add(
    'ocr-payment',
    { mediaId: imageId, phone, orderId },
    { jobId: `ocr:${orderId}:${imageId}` }, // deduplicación por orden+imagen
  );

  // Confirmar al cliente inmediatamente (no esperar el OCR)
  await whatsappClient.sendMessage(TEMPLATES.paymentReceived(phone));

  logger.info({ orderId, phone, imageId }, 'Image proof received, OCR job enqueued');

  return updateSessionState(phone, 'PAYMENT_UNDER_REVIEW', {
    customerId: session.customerId,
    cart: session.cart,
    activeOrderId: orderId,
    deliveryType: session.deliveryType,
    deliveryAddress: session.deliveryAddress,
    paymentMethod: session.paymentMethod,
  });
}

// ─── Texto con referencia: notificar admin directo ────────────────────────────

async function processReferenceProof(
  phone: string,
  session: SessionData,
  reference: string,
): Promise<SessionData> {
  const orderId = session.activeOrderId!;

  // Validar referencia duplicada solo para referencias completas (≥8 dígitos)
  // Las referencias cortas (4-7 dígitos) son últimos dígitos y pueden coincidir legítimamente
  if (reference.length >= 8) {
    const existing = await prisma.order.findFirst({
      where: {
        paymentReference: reference,
        status: { in: ['PAYMENT_UPLOADED', 'PAYMENT_CONFIRMED', 'IN_KITCHEN', 'READY', 'DELIVERED'] },
        id: { not: orderId },
      },
    });
    if (existing) {
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          '⚠️ Ese número de referencia ya está registrado en otro pedido.\n\n' +
            'Si es correcto, por favor envía una *📸 foto del comprobante* para que podamos verificarlo.',
        ),
      );
      return session;
    }
  }

  await updateOrderStatus(orderId, 'PAYMENT_UPLOADED', {
    paymentReference: reference,
  });

  const order = await getOrderById(orderId);
  const totalBs = order ? parseFloat(order.totalBs.toString()) : 0;
  const orderNumber = order?.orderNumber ?? 0;

  // Construir datos estructurados con solo la referencia (sin imagen)
  const paymentData: PaymentReceiptData = {
    referencia: reference.length >= 4 ? reference.slice(-4) : reference,
    fecha: null,
    telefonoDestino: null,
    receptor: null,
    monto: null,
  };

  await notifyPaymentReceived({
    orderId,
    orderNumber,
    customerName: session.customerName ?? 'Cliente',
    customerPhone: phone,
    cart: session.cart,
    totalBs,
    paymentData,
    paymentSource: 'text',
    deliveryType: session.deliveryType ?? 'PICKUP',
    ...(session.deliveryAddress !== undefined && { deliveryAddress: session.deliveryAddress }),
  });

  await whatsappClient.sendMessage(TEMPLATES.paymentReceived(phone));

  logger.info({ orderId, phone, reference }, 'Reference proof received, admin notified');

  return updateSessionState(phone, 'PAYMENT_UNDER_REVIEW', {
    customerId: session.customerId,
    cart: session.cart,
    activeOrderId: orderId,
    deliveryType: session.deliveryType,
    deliveryAddress: session.deliveryAddress,
    paymentMethod: session.paymentMethod,
  });
}
