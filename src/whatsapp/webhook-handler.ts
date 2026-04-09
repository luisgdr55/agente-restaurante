/**
 * Parsea el payload crudo del webhook de Evolution API
 * y normaliza al tipo IncomingMessage.
 *
 * META_LEGACY — parser de Meta Cloud API comentado al final del archivo.
 */
import { logger } from '../utils/logger';
import type { IncomingMessage } from '../agent/types';

// ─── Tipos del payload de Evolution API ──────────────────────────────────────

interface EvoWebhookPayload {
  event: string;
  data: EvoData;
}

interface EvoData {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  message?: EvoMessage;
  messageTimestamp?: number;
}

interface EvoMessage {
  conversation?: string;
  extendedTextMessage?: { text: string };
  imageMessage?: { caption?: string; mimetype?: string };
  buttonsResponseMessage?: {
    selectedButtonId: string;
    selectedDisplayText: string;
  };
  listResponseMessage?: {
    singleSelectReply: { selectedRowId: string };
    title?: string;
  };
  locationMessage?: {
    degreesLatitude: number;
    degreesLongitude: number;
    name?: string;
    address?: string;
  };
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export interface ParsedWebhookResult {
  messages: IncomingMessage[];
  statuses: never[];
}

export function parseWebhookPayload(body: unknown): ParsedWebhookResult {
  const payload = body as EvoWebhookPayload;

  if (payload.event !== 'messages.upsert') {
    logger.debug({ event: payload.event }, 'Ignoring non-upsert event');
    return { messages: [], statuses: [] };
  }

  const { data } = payload;

  if (!data?.key) {
    logger.warn('Evolution webhook: missing data.key');
    return { messages: [], statuses: [] };
  }

  // Ignorar mensajes del propio bot
  if (data.key.fromMe) {
    return { messages: [], statuses: [] };
  }

  // Ignorar grupos
  if (data.key.remoteJid.endsWith('@g.us')) {
    logger.debug({ remoteJid: data.key.remoteJid }, 'Ignoring group message');
    return { messages: [], statuses: [] };
  }

  const parsed = normalizeMessage(data);
  return {
    messages: parsed ? [parsed] : [],
    statuses: [],
  };
}

function normalizeMessage(data: EvoData): IncomingMessage | null {
  const phone = data.key.remoteJid.replace('@s.whatsapp.net', '');
  const messageId = data.key.id;
  const timestamp = (data.messageTimestamp ?? 0) * 1000;
  const msg = data.message ?? {};

  const base = { messageId, phone, timestamp };

  // Texto simple
  const textBody = msg.conversation ?? msg.extendedTextMessage?.text;
  if (textBody !== undefined) {
    return { ...base, type: 'text', text: textBody.trim() };
  }

  // Imagen
  if (msg.imageMessage !== undefined) {
    const result: IncomingMessage = { ...base, type: 'image', imageId: messageId };
    if (msg.imageMessage.caption) result.text = msg.imageMessage.caption;
    return result;
  }

  // Respuesta a botón
  if (msg.buttonsResponseMessage !== undefined) {
    return {
      ...base,
      type: 'interactive',
      interactiveReply: {
        type: 'button_reply',
        id: msg.buttonsResponseMessage.selectedButtonId,
        title: msg.buttonsResponseMessage.selectedDisplayText,
      },
    };
  }

  // Respuesta a lista
  if (msg.listResponseMessage !== undefined) {
    return {
      ...base,
      type: 'interactive',
      interactiveReply: {
        type: 'list_reply',
        id: msg.listResponseMessage.singleSelectReply.selectedRowId,
        title: msg.listResponseMessage.title ?? '',
      },
    };
  }

  // Ubicación → texto legible
  if (msg.locationMessage !== undefined) {
    const { degreesLatitude, degreesLongitude, name, address } = msg.locationMessage;
    const text = address
      ? `${name ?? ''} ${address}`.trim()
      : name
        ? name
        : `📍 https://maps.google.com/?q=${degreesLatitude},${degreesLongitude}`;
    return { ...base, type: 'text', text };
  }

  logger.debug({ remoteJid: data.key.remoteJid }, 'Unsupported Evolution message type');
  return null;
}

// META_LEGACY ─── Parser de Meta Cloud API ─────────────────────────────────────
// Conservado para revertir si es necesario.
//
// interface MetaWebhookPayload {
//   object: string;
//   entry: MetaEntry[];
// }
// interface MetaEntry { id: string; changes: MetaChange[]; }
// interface MetaChange { value: MetaChangeValue; field: string; }
// interface MetaChangeValue {
//   messaging_product: string;
//   metadata: { display_phone_number: string; phone_number_id: string };
//   contacts?: Array<{ profile: { name: string }; wa_id: string }>;
//   messages?: MetaMessage[];
//   statuses?: MetaStatus[];
// }
// interface MetaMessage {
//   id: string; from: string; timestamp: string; type: string;
//   context?: { id: string; from: string; forwarded?: boolean };
//   text?: { body: string };
//   image?: { id: string; mime_type: string; caption?: string };
//   audio?: { id: string }; video?: { id: string }; document?: { id: string };
//   sticker?: { id: string };
//   location?: { latitude: number; longitude: number; name?: string; address?: string };
//   interactive?: {
//     type: 'button_reply' | 'list_reply';
//     button_reply?: { id: string; title: string };
//     list_reply?: { id: string; title: string; description?: string };
//   };
// }
// export interface MetaStatus {
//   id: string; status: 'sent' | 'delivered' | 'read' | 'failed';
//   timestamp: string; recipient_id: string;
// }
// export function parseWebhookPayload_META(body: unknown): ParsedWebhookResult { ... }
