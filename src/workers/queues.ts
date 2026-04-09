import { Queue } from 'bullmq';
import { env } from '../config/env';
import {
  QUEUE_MESSAGE_PROCESSING,
  QUEUE_NOTIFICATIONS,
  QUEUE_OCR,
  DEAD_LETTER_QUEUE,
} from '../config/constants';

// ─── Tipos de jobs ────────────────────────────────────────────────────────────

export interface MessageJob {
  messageId: string;
  phone: string;
  type: string;
  text?: string;
  imageId?: string;
  interactiveReply?: {
    type: 'button_reply' | 'list_reply';
    id: string;
    title: string;
  };
  timestamp: number;
  receivedAt: number;
}

export interface NotificationJob {
  type:
    | 'NEW_ORDER'
    | 'PAYMENT_RECEIVED'
    | 'ORDER_STATUS_UPDATE'
    | 'ADMIN_COMMAND_RESULT';
  orderId?: string;
  customerId?: string;
  phone: string;
  data: Record<string, unknown>;
}

export interface OcrJob {
  mediaId: string;
  phone: string;
  orderId: string;
}

// ─── Conexión Redis (BullMQ acepta string URL directamente) ──────────────────

const connection = { url: env.REDIS_URL };

const defaultJobOptions = {
  removeOnComplete: { count: 1000, age: 3600 },
  removeOnFail: { count: 500 },
};

// ─── Queues ───────────────────────────────────────────────────────────────────

export const messageQueue = new Queue<MessageJob>(QUEUE_MESSAGE_PROCESSING, {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: env.QUEUE_MAX_RETRIES,
    backoff: {
      type: 'exponential',
      delay: env.QUEUE_RETRY_DELAY_MS,
    },
  },
});

export const notificationQueue = new Queue<NotificationJob>(QUEUE_NOTIFICATIONS, {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

export const ocrQueue = new Queue<OcrJob>(QUEUE_OCR, {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
  },
});

export const deadLetterQueue = new Queue(DEAD_LETTER_QUEUE, {
  connection,
  defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
});
