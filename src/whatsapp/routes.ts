/**
 * Rutas Fastify para el webhook de Evolution API.
 *
 * POST /webhook → mensajes entrantes (responder 200 en < 20s)
 *
 * META_LEGACY: GET /webhook eliminado — era para verificación de Meta Cloud API.
 * Evolution API no requiere verificación de URL.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';
import { parseWebhookPayload } from './webhook-handler';
import { messageQueue } from '../workers/queues';

// META_LEGACY — imports eliminados (no necesarios con Evolution API)
// import crypto from 'crypto';
// import { env } from '../config/env';

// META_LEGACY — VerifyQuery para hub.challenge de Meta
// interface VerifyQuery {
//   'hub.mode': string;
//   'hub.verify_token': string;
//   'hub.challenge': string;
// }

// ─── Plugin Fastify ───────────────────────────────────────────────────────────

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /webhook
   * Mensajes entrantes de Evolution API — responder 200 INMEDIATAMENTE
   * y procesar async en BullMQ.
   */
  app.post('/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    // Responder 200 de inmediato
    void reply.status(200).send({ status: 'received' });

    const receivedAt = Date.now();

    try {
      const { messages, statuses } = parseWebhookPayload(req.body);

      // META_LEGACY — statuses de entrega de Meta (read/delivered). Evolution API no los envía.
      void statuses;

      for (const msg of messages) {
        await messageQueue.add(
          `msg_${msg.phone}`,
          {
            messageId: msg.messageId,
            phone: msg.phone,
            type: msg.type,
            timestamp: msg.timestamp,
            receivedAt,
            ...(msg.text !== undefined && { text: msg.text }),
            ...(msg.imageId !== undefined && { imageId: msg.imageId }),
            ...(msg.interactiveReply !== undefined && { interactiveReply: msg.interactiveReply }),
          },
          {
            priority: msg.type === 'text' || msg.type === 'interactive' ? 1 : 5,
            jobId: `dedup_${msg.messageId.replace(/:/g, '_')}`,
          },
        );

        logger.info(
          { phone: msg.phone, messageId: msg.messageId, type: msg.type },
          'Message enqueued',
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error parsing webhook payload');
    }
  });

  // META_LEGACY — GET /webhook: verificación de URL requerida por Meta Cloud API.
  // Evolution API no necesita este endpoint.
  // app.get('/webhook', async (req, reply) => {
  //   const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  //   if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
  //     logger.info('WhatsApp webhook verified ✅');
  //     return reply.status(200).send(challenge);
  //   }
  //   logger.warn({ mode, token }, 'Webhook verification failed');
  //   return reply.status(403).send('Forbidden');
  // });

  // META_LEGACY — verificación HMAC-SHA256 de Meta Cloud API (no aplica a Evolution API)
  // if (env.WHATSAPP_APP_SECRET) {
  //   const signature = req.headers['x-hub-signature-256'];
  //   const expected = 'sha256=' + crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET)
  //     .update(rawBody).digest('hex');
  //   if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
  //     return reply.status(401).send('Unauthorized');
  //   }
  // }
}
