/**
 * Worker de reportes automáticos — envía resúmenes al admin por WhatsApp.
 *
 * Horarios (Venezuela UTC-4):
 *   - Diario:   cada día a las 11:00 PM Venezuela  = 03:00 UTC
 *   - Semanal:  cada lunes a las 8:00 AM Venezuela = 12:00 UTC
 *   - Mensual:  el 1° de cada mes a las 8:00 AM Venezuela = 12:00 UTC
 */
import { Queue, Worker } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { whatsappClient } from '../whatsapp/client';
import { textMessage } from '../whatsapp/message-builder';
import { getConfig } from '../menu/config-service';
import {
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
} from '../reports/report-service';

const REPORT_QUEUE = 'reports';

export const reportQueue = new Queue(REPORT_QUEUE, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: { removeOnComplete: 5, removeOnFail: 3 },
});

type ReportJobData = { type: 'daily' | 'weekly' | 'monthly' };

export function startReportWorker() {
  const worker = new Worker<ReportJobData>(
    REPORT_QUEUE,
    async (job) => {
      // Skip stale jobs missed during server downtime
      const staleness = Date.now() - job.timestamp;
      if (staleness > 10 * 60 * 1000) {
        logger.warn({ type: job.data.type, staleness }, 'Stale report job skipped');
        return;
      }

      const adminPhone = await getConfig('ADMIN_PHONE').catch(() => null);
      if (!adminPhone) {
        logger.warn('Report worker: ADMIN_PHONE not configured, skipping');
        return;
      }

      let text: string;
      switch (job.data.type) {
        case 'daily':   text = await generateDailyReport();   break;
        case 'weekly':  text = await generateWeeklyReport();  break;
        case 'monthly': text = await generateMonthlyReport(); break;
        default: return;
      }

      await whatsappClient.sendMessage(textMessage(adminPhone, text));
      logger.info({ type: job.data.type }, 'Report sent to admin');
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, type: job?.data?.type, err }, 'Report job failed');
  });

  logger.info('Report worker started');
  return worker;
}

/**
 * Registra los jobs repetibles en BullMQ.
 * Usar cron patterns:  minuto hora día mes díaSemana
 */
export async function scheduleReports(): Promise<void> {
  // Daily at 11 PM Venezuela (UTC-4) = 03:00 UTC
  await reportQueue.add(
    'report',
    { type: 'daily' },
    {
      repeat: { pattern: '0 3 * * *' },
      jobId: 'report-daily',
    },
  );

  // Weekly — every Monday at 8 AM Venezuela (UTC-4) = 12:00 UTC
  await reportQueue.add(
    'report',
    { type: 'weekly' },
    {
      repeat: { pattern: '0 12 * * 1' },
      jobId: 'report-weekly',
    },
  );

  // Monthly — 1st of each month at 8 AM Venezuela (UTC-4) = 12:00 UTC
  await reportQueue.add(
    'report',
    { type: 'monthly' },
    {
      repeat: { pattern: '0 12 1 * *' },
      jobId: 'report-monthly',
    },
  );

  logger.info('Reports scheduled: daily@23h-VEN(03UTC), weekly@Mon8h-VEN(12UTC), monthly@1st8h-VEN(12UTC)');
}
