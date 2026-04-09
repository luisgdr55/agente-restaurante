import { Worker, type Job } from 'bullmq';
import { redisClient } from '../redis/client';
import { QUEUE_MESSAGE_PROCESSING } from '../config/constants';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { deadLetterQueue, type MessageJob } from './queues';
import { DEAD_LETTER_QUEUE } from '../config/constants';
import { isMessageProcessed } from '../redis/session-manager';
import { whatsappClient } from '../whatsapp/client';
import { TEMPLATES } from '../whatsapp/message-builder';
import type { IncomingMessage } from '../agent/types';
import { handleMessage as agentHandleMessage } from '../agent/conversation-agent';

// ─── Rate limiting por número (Redis INCR + TTL) ──────────────────────────────

async function checkRateLimit(phone: string): Promise<boolean> {
  const key = `ratelimit:${phone}:${Math.floor(Date.now() / 1000)}`;
  const count = await redisClient.incr(key);
  if (count === 1) await redisClient.expire(key, 2);
  return count <= env.RATE_LIMIT_PER_PHONE_RPS;
}

// ─── Dispatcher de mensajes por tipo ─────────────────────────────────────────

async function handleMessage(msg: IncomingMessage): Promise<void> {
  // Tipos no soportados → respuesta estándar sin usar LLM
  if (msg.type === 'audio' || msg.type === 'video' || msg.type === 'sticker') {
    await whatsappClient.sendMessage(TEMPLATES.unsupportedMedia(msg.phone));
    return;
  }

  // Delegar al agente conversacional (máquina de estados)
  await agentHandleMessage(msg);
}

// ─── Processor principal ──────────────────────────────────────────────────────

async function processMessage(job: Job<MessageJob>): Promise<void> {
  const { messageId, phone } = job.data;
  const start = Date.now();

  // 1. Idempotencia — si ya procesamos este messageId, ignorar
  const alreadyProcessed = await isMessageProcessed(messageId);
  if (alreadyProcessed) {
    logger.debug({ messageId, phone }, 'Duplicate message, skipping');
    return;
  }

  // 2. Rate limiting
  const withinLimit = await checkRateLimit(phone);
  if (!withinLimit) {
    logger.warn({ phone }, 'Rate limit exceeded, requeueing');
    throw new Error('RATE_LIMITED');
  }

  // 3. Marcar como leído en WhatsApp
  await whatsappClient.markAsRead(phone, messageId).catch(() => undefined);

  // 4. Reconstruir IncomingMessage desde el job
  const incoming: IncomingMessage = {
    messageId: job.data.messageId,
    phone: job.data.phone,
    type: job.data.type as IncomingMessage['type'],
    timestamp: job.data.timestamp,
    ...(job.data.text !== undefined && { text: job.data.text }),
    ...(job.data.imageId !== undefined && { imageId: job.data.imageId }),
    ...(job.data.interactiveReply !== undefined && { interactiveReply: job.data.interactiveReply }),
  };

  // 5. Procesar
  await handleMessage(incoming);

  logger.info(
    { phone, messageId, type: incoming.type, durationMs: Date.now() - start },
    'Message processed',
  );
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startMessageWorker(): Worker<MessageJob> {
  const worker = new Worker<MessageJob>(
    QUEUE_MESSAGE_PROCESSING,
    processMessage,
    {
      connection: { url: env.REDIS_URL },
      concurrency: env.QUEUE_CONCURRENCY,
      limiter: {
        max: 80,
        duration: 1000, // max 80 messages per second (WhatsApp Cloud API limit)
      },
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, phone: job.data.phone }, 'Job completed');
  });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    logger.error({ jobId: job.id, phone: job.data.phone, err: err.message }, 'Job failed');

    if (job.attemptsMade >= (job.opts.attempts ?? env.QUEUE_MAX_RETRIES)) {
      await deadLetterQueue.add(DEAD_LETTER_QUEUE, {
        originalQueue: QUEUE_MESSAGE_PROCESSING,
        jobData: job.data,
        error: err.message,
        failedAt: new Date().toISOString(),
      });
    }
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Worker error');
  });

  logger.info({ concurrency: env.QUEUE_CONCURRENCY }, '📨 Message worker started');
  return worker;
}
