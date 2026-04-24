import './config/env'; // validate env vars first
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './db/prisma';
import { connectRedis, disconnectRedis } from './redis/client';
import { webhookRoutes } from './whatsapp/routes';
import { authRoutes } from './api/auth.routes';
import { dashboardRoutes } from './api/dashboard.routes';
import { startMessageWorker } from './workers/message-processor';
import { startOcrWorker } from './workers/ocr-worker';
import { startSessionCleanupWorker, scheduleSessionCleanup } from './workers/session-cleanup';
import { startReportWorker, scheduleReports } from './workers/report-worker';
import { initSocketServer } from './websocket/socket-server';
import type { Worker } from 'bullmq';

async function bootstrap() {
  const app = Fastify({
    logger: false, // usamos pino directamente
    trustProxy: true,
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: env.NODE_ENV === 'production'
      ? [/\.up\.railway\.app$/, /localhost/]
      : true,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(compress, { global: true });

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', async () => {
    const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    return {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      db: dbOk ? 'connected' : 'error',
    };
  });

  // ── WhatsApp Webhook ──────────────────────────────────────────────────────
  await app.register(webhookRoutes);

  // ── API Dashboard (Paso 10) ───────────────────────────────────────────────
  await app.register(authRoutes);
  await app.register(dashboardRoutes);

  // ── Workers ───────────────────────────────────────────────────────────────
  const workers: Worker[] = [];

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');

    // Detener workers primero (dejar terminar jobs en curso)
    await Promise.all(workers.map((w) => w.close()));

    await app.close();
    await prisma.$disconnect();
    await disconnectRedis();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // ── Start ─────────────────────────────────────────────────────────────────
  try {
    await connectRedis();
    await prisma.$connect();

    // Arrancar workers
    const messageWorker = startMessageWorker();
    const ocrWorker = startOcrWorker();
    const sessionCleanupWorker = startSessionCleanupWorker();
    const reportWorker = startReportWorker();
    workers.push(messageWorker, ocrWorker, sessionCleanupWorker, reportWorker);

    await scheduleSessionCleanup();
    await scheduleReports();

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    initSocketServer(app.server);
    logger.info({ port: env.PORT, env: env.NODE_ENV }, '🚀 Server started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

void bootstrap();
