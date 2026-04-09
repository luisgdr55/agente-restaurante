/**
 * Worker OCR — procesa imágenes de comprobantes de pago en background.
 *
 * Flujo:
 *   1. Descarga imagen de WhatsApp Media API
 *   2. Extrae texto con tesseract.js
 *   3. Parsea campos estructurados (referencia, fecha, teléfono, RIF, monto)
 *   4. Actualiza la orden con la referencia encontrada
 *   5. Notifica al admin con los datos del comprobante + botones confirmar/rechazar
 */
import { Worker, type Job } from 'bullmq';
import { env } from '../config/env';
import { QUEUE_OCR } from '../config/constants';
import type { OcrJob } from './queues';
import { whatsappClient } from '../whatsapp/client';
import { textMessage } from '../whatsapp/message-builder';
import { extractTextFromImage, isPaymentReceipt } from '../ocr/ocr-service';
import { updateOrderStatus, getOrderById, friendlyOrderId } from '../orders/order-service';
import { notifyPaymentReceived } from '../notifications/admin-notifier';
import { getSession, updateSessionState } from '../redis/session-manager';
import { getConfig } from '../menu/config-service';
import { logger } from '../utils/logger';

const OCR_MAX_RETRIES = 2; // debe coincidir con ocrQueue config en queues.ts

const connection = { url: env.REDIS_URL };

async function processOcrJob(job: Job<OcrJob>): Promise<void> {
  const { mediaId, phone, orderId } = job.data;
  const log = logger.child({ jobId: job.id, orderId, phone });

  log.info('Starting OCR job');

  // 1. Descargar imagen
  let imageBuffer: Buffer;
  try {
    imageBuffer = await whatsappClient.downloadMedia(mediaId);
    log.debug({ sizeBytes: imageBuffer.length }, 'Media downloaded');
  } catch (err) {
    log.error({ err }, 'Failed to download media for OCR');
    throw err; // BullMQ reintentará
  }

  // 2. Ejecutar OCR y extraer datos estructurados
  let reference: string | null = null;
  let paymentData = null;
  let rawText = '';
  let ocrSuccess = false;

  try {
    const result = await extractTextFromImage(imageBuffer);
    reference = result.reference;
    paymentData = result.paymentData;
    rawText = result.rawText;
    ocrSuccess = true;

    log.info(
      { confidence: result.confidence, hasReference: !!reference, paymentData },
      'OCR completed',
    );
  } catch (err) {
    log.error({ err }, 'OCR extraction failed');
    // ocrSuccess permanece false — se rechazará abajo
  }

  // 3. Obtener orden y datos del cliente
  const order = await getOrderById(orderId);
  if (!order) {
    log.warn('Order not found after OCR, skipping notification');
    return;
  }

  // 4. Validar si la imagen es un comprobante de pago móvil venezolano.
  //    Si OCR falló O el texto no cumple los criterios → rechazar sin notificar al admin.
  //    Solo se notifica al admin cuando tenemos certeza de que es un recibo válido.
  const session = await getSession(phone);

  const looksLikeReceipt = ocrSuccess && isPaymentReceipt(rawText);

  if (!looksLikeReceipt) {
    log.info({ ocrSuccess }, 'Image rejected — not a VE mobile payment receipt');

    await updateOrderStatus(orderId, 'PENDING_PAYMENT').catch((err: unknown) =>
      log.error({ err }, 'Failed to revert order status after invalid receipt'),
    );

    await updateSessionState(phone, 'AWAITING_PAYMENT_PROOF', {
      customerId: session?.customerId,
      customerName: session?.customerName,
      cart: session?.cart ?? [],
      activeOrderId: orderId,
      deliveryType: session?.deliveryType,
      deliveryAddress: session?.deliveryAddress,
      paymentMethod: session?.paymentMethod,
    }).catch((err: unknown) =>
      log.error({ err }, 'Failed to revert session after invalid receipt'),
    );

    const clientMsg = ocrSuccess
      ? '⚠️ La imagen que enviaste no parece un comprobante de pago móvil venezolano.\n\n' +
        'Por favor envía una *captura del recibo* de tu pago móvil o transferencia ' +
        'que incluya: número de referencia, fecha, monto en Bs. y receptor.\n\n' +
        'También puedes escribir directamente el *número de referencia*.'
      : '⚠️ No pudimos leer tu imagen correctamente.\n\n' +
        'Por favor envía una *captura más clara* del comprobante de pago, ' +
        'o escribe directamente el *número de referencia*.';

    await whatsappClient.sendMessage(textMessage(phone, clientMsg));
    return;
  }

  // 5. Actualizar orden con referencia si se encontró
  if (reference) {
    await updateOrderStatus(orderId, 'PAYMENT_UPLOADED', {
      paymentReference: reference,
      paymentImageUrl: `wa_media:${mediaId}`,
    });
    log.info({ reference }, 'Reference extracted and saved to order');
  }

  // 6. Notificar al admin con datos estructurados del comprobante
  const totalBs = parseFloat(order.totalBs.toString());

  await notifyPaymentReceived({
    orderId,
    orderNumber: order.orderNumber,
    customerName: session?.customerName ?? order.customer?.name ?? 'Cliente',
    customerPhone: phone,
    cart: session?.cart ?? [],
    totalBs,
    paymentData: paymentData ?? null,
    paymentSource: 'image',
    deliveryType: session?.deliveryType ?? (order.deliveryType as 'DELIVERY' | 'PICKUP') ?? 'PICKUP',
    ...(session?.deliveryAddress !== undefined && { deliveryAddress: session.deliveryAddress }),
  });

  if (ocrSuccess && !reference) {
    log.info('No reference found in image, admin must verify manually');
  }

  log.info('OCR job completed');
}

export function startOcrWorker(): Worker<OcrJob> {
  const worker = new Worker<OcrJob>(QUEUE_OCR, processOcrJob, {
    connection,
    concurrency: 3, // OCR es CPU-intensivo, limitar concurrencia
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, orderId: job.data.orderId }, 'OCR job completed');
  });

  worker.on('failed', async (job, err) => {
    logger.error({ jobId: job?.id, orderId: job?.data.orderId, err }, 'OCR job failed');

    // Si agotó todos los reintentos, alertar al admin para revisión manual
    if (job && job.attemptsMade >= OCR_MAX_RETRIES) {
      try {
        const adminPhone = await getConfig('ADMIN_PHONE');
        if (adminPhone) {
          const order = await getOrderById(job.data.orderId).catch(() => null);
          const fId = order ? `#${friendlyOrderId(order.orderNumber)}` : job.data.orderId.slice(-6);
          await whatsappClient.sendMessage(
            textMessage(
              adminPhone,
              `⚠️ *OCR falló* para pedido ${fId} (${job.data.phone}).\n\n` +
                `El comprobante no se pudo procesar automáticamente.\n` +
                `Revísalo manualmente con */pedidos* y luego */confirmar ${fId}* o */rechazar ${fId}*.`,
            ),
          );
        }
      } catch (alertErr) {
        logger.error({ alertErr }, 'Failed to send OCR failure alert to admin');
      }
    }
  });

  logger.info('OCR worker started');
  return worker;
}
