/**
 * Periodic worker that removes stale Redis sessions older than 24 hours
 * and alerts the admin about orders stuck in blocking states.
 * Runs every hour via a repeatable BullMQ job.
 */
import { Queue, Worker } from 'bullmq';
import { redisClient } from '../redis/client';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { prisma } from '../db/prisma';
import { whatsappClient } from '../whatsapp/client';
import { textMessage } from '../whatsapp/message-builder';
import { getConfig } from '../menu/config-service';
import { friendlyOrderId } from '../orders/order-service';
import { SESSION_KEY_PREFIX, POST_ORDER_STATES } from '../config/constants';
import { updateSessionState, type SessionData } from '../redis/session-manager';

// Umbrales de alerta
const PAYMENT_REVIEW_TIMEOUT_MS  = 30 * 60 * 1000;  // 30 min sin confirmar/rechazar
const ORDER_IN_KITCHEN_TIMEOUT_MS = 2  * 60 * 60 * 1000; // 2h en cocina sin marcar listo

const CLEANUP_QUEUE = 'session-cleanup';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const sessionCleanupQueue = new Queue(CLEANUP_QUEUE, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: {
    removeOnComplete: 5,
    removeOnFail: 3,
  },
});

async function runCleanup(): Promise<{ removed: number }> {
  let cursor = '0';
  let removed = 0;

  do {
    const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', 'session:*', 'COUNT', 100);
    cursor = nextCursor;

    for (const key of keys) {
      const ttl = await redisClient.ttl(key);
      // If TTL is -1 (no expiry set), check the session age
      if (ttl === -1) {
        const raw = await redisClient.get(key);
        if (raw) {
          try {
            const session = JSON.parse(raw) as { updatedAt?: string };
            const updatedAt = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
            if (Date.now() - updatedAt > SESSION_TTL_MS) {
              await redisClient.del(key);
              removed++;
            }
          } catch {
            // Invalid JSON — safe to delete
            await redisClient.del(key);
            removed++;
          }
        }
      }
    }
  } while (cursor !== '0');

  return { removed };
}

// ─── Alertas de estado bloqueado ─────────────────────────────────────────────

async function checkStateTimeouts(): Promise<void> {
  const adminPhone = await getConfig('ADMIN_PHONE').catch(() => null);
  if (!adminPhone) return;

  const now = new Date();

  // Pedidos esperando confirmación de pago por más de 30 minutos
  const stuckPayments = await prisma.order.findMany({
    where: {
      status: 'PAYMENT_UPLOADED',
      updatedAt: { lte: new Date(now.getTime() - PAYMENT_REVIEW_TIMEOUT_MS) },
    },
    include: { customer: true },
    take: 10,
  });

  if (stuckPayments.length > 0) {
    const lines = stuckPayments.map((o) => {
      const fId = friendlyOrderId(o.orderNumber);
      const name = o.customer?.name ?? 'Cliente';
      const minAgo = Math.floor((now.getTime() - o.updatedAt.getTime()) / 60000);
      return `• *#${fId}* — ${name} (${minAgo} min esperando)`;
    });
    await whatsappClient
      .sendMessage(
        textMessage(
          adminPhone,
          `⚠️ *Pagos sin revisar (>${PAYMENT_REVIEW_TIMEOUT_MS / 60000} min):*\n\n${lines.join('\n')}\n\nUsa */confirmar <#>* o */rechazar <#>*`,
        ),
      )
      .catch(() => undefined);
    logger.warn({ count: stuckPayments.length }, 'State timeout: PAYMENT_UPLOADED orders alerted');
  }

  // Pedidos en cocina por más de 2 horas sin marcar como listos
  const stuckKitchen = await prisma.order.findMany({
    where: {
      status: 'PAYMENT_CONFIRMED',
      updatedAt: { lte: new Date(now.getTime() - ORDER_IN_KITCHEN_TIMEOUT_MS) },
    },
    include: { customer: true },
    take: 10,
  });

  if (stuckKitchen.length > 0) {
    const lines = stuckKitchen.map((o) => {
      const fId = friendlyOrderId(o.orderNumber);
      const name = o.customer?.name ?? 'Cliente';
      const hrsAgo = (now.getTime() - o.updatedAt.getTime()) / 3600000;
      return `• *#${fId}* — ${name} (${hrsAgo.toFixed(1)}h en cocina)`;
    });
    await whatsappClient
      .sendMessage(
        textMessage(
          adminPhone,
          `⚠️ *Pedidos en cocina sin actualizar (>2h):*\n\n${lines.join('\n')}\n\nUsa */listo <#>* cuando estén listos`,
        ),
      )
      .catch(() => undefined);
    logger.warn({ count: stuckKitchen.length }, 'State timeout: ORDER_IN_KITCHEN orders alerted');
  }
}

async function cleanupOrphanedSessions(): Promise<void> {
  let cursor = '0';
  let cleaned = 0;

  do {
    const [nextCursor, keys] = await redisClient.scan(
      cursor, 'MATCH', `${SESSION_KEY_PREFIX}*`, 'COUNT', 100,
    );
    cursor = nextCursor;

    for (const key of keys) {
      const raw = await redisClient.get(key);
      if (!raw) continue;

      let session: SessionData;
      try {
        session = JSON.parse(raw) as SessionData;
      } catch {
        continue;
      }

      if (!session.activeOrderId || !POST_ORDER_STATES.includes(session.state)) continue;

      const order = await prisma.order.findUnique({
        where: { id: session.activeOrderId },
        select: { status: true },
      }).catch(() => null);

      if (order?.status !== 'DELIVERED' && order?.status !== 'CANCELLED') continue;

      await updateSessionState(session.phone, 'MAIN_MENU', {
        customerId: session.customerId,
        customerName: session.customerName,
        cart: [],
        activeOrderId: undefined,
      }).catch(() => undefined);

      logger.info(
        { phone: session.phone, orderId: session.activeOrderId, orderStatus: order.status },
        'Orphaned session reset to MAIN_MENU',
      );
      cleaned++;
    }
  } while (cursor !== '0');

  if (cleaned > 0) logger.info({ cleaned }, 'Orphaned session cleanup complete');
}

export function startSessionCleanupWorker() {
  const worker = new Worker(
    CLEANUP_QUEUE,
    async (job) => {
      if (job.name === 'orphan-cleanup') {
        await cleanupOrphanedSessions();
        return;
      }
      const { removed } = await runCleanup();
      logger.info({ removed }, 'Session cleanup complete');
      await checkStateTimeouts();
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Session cleanup job failed');
  });

  logger.info('Session cleanup worker started');
  return worker;
}

/**
 * Schedules the cleanup to run every hour.
 * Call this once at startup.
 */
export async function scheduleSessionCleanup(): Promise<void> {
  await sessionCleanupQueue.add(
    'cleanup',
    {},
    { repeat: { every: 60 * 60 * 1000 }, jobId: 'session-cleanup-recurring' },
  );
  await sessionCleanupQueue.add(
    'orphan-cleanup',
    {},
    { repeat: { every: 5 * 60 * 1000 }, jobId: 'session-orphan-cleanup-recurring' },
  );
}

