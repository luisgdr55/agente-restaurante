/**
 * Evolution API WhatsApp client.
 * Reemplaza Meta Cloud API.
 *
 * Anti-ban obligatorio: typing indicator + delay proporcional antes de cada mensaje.
 */
import axios, { type AxiosInstance } from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { OutgoingMessage, ButtonAction, ListAction } from '../agent/types';

// META_LEGACY — importaciones antiguas (no eliminar hasta confirmar migración)
// import { WA_API_VERSION, WA_BASE_URL } from '../config/constants';

// ─── Delay humano anti-ban ─────────────────────────────────────────────────────

function calcDelay(text: string): number {
  const base = 3_000;
  const perChar = 35;
  const calculated = base + text.length * perChar;
  const capped = Math.min(calculated, 15_000);
  return capped * (0.75 + Math.random() * 0.5);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractText(message: OutgoingMessage): string {
  if (message.type === 'text')        return message.text?.body ?? '';
  if (message.type === 'interactive') return message.interactive?.body?.text ?? '';
  if (message.type === 'image')       return message.image?.caption ?? '';
  return '';
}

// ─── Número ───────────────────────────────────────────────────────────────────

function toEvoNumber(phone: string): string {
  return phone.replace('@s.whatsapp.net', '');
}

// ─── Cliente ──────────────────────────────────────────────────────────────────

class WhatsAppClient {
  private readonly http: AxiosInstance;
  private readonly instance: string;

  constructor() {
    this.instance = env.EVOLUTION_INSTANCE;
    this.http = axios.create({
      baseURL: env.EVOLUTION_API_URL,
      headers: {
        apikey: env.EVOLUTION_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  }

  // ─── Typing indicator ──────────────────────────────────────────────────────

  private async sendTyping(phone: string): Promise<void> {
    try {
      await this.http.post(`/chat/sendPresence/${this.instance}`, {
        number: toEvoNumber(phone),
        options: 'composing',
      });
    } catch {
      // No crítico — ignorar si falla
    }
  }

  // ─── Envío principal ───────────────────────────────────────────────────────

  async sendMessage(message: OutgoingMessage): Promise<string> {
    const phone = toEvoNumber(message.to);

    // Anti-ban: typing + delay proporcional al texto
    await this.sendTyping(message.to);
    await sleep(calcDelay(extractText(message)));

    try {
      const { endpoint, payload } = this.buildRequest(phone, message);
      const res = await this.http.post(endpoint, payload);
      const messageId = res.data?.key?.id as string | undefined;
      logger.debug({ to: message.to, messageId, type: message.type }, 'Message sent');
      return messageId ?? '';
    } catch (err) {
      if (axios.isAxiosError(err)) {
        logger.error(
          { to: message.to, status: err.response?.status, data: err.response?.data },
          'Evolution API error',
        );
        throw new Error(`Evolution API error: ${JSON.stringify(err.response?.data)}`);
      }
      throw err;
    }
  }

  async sendText(to: string, body: string): Promise<string> {
    return this.sendMessage({ to, type: 'text', text: { body } });
  }

  // ─── Marcar como leído ─────────────────────────────────────────────────────

  async markAsRead(phone: string, messageId: string): Promise<void> {
    try {
      await this.http.post(`/chat/markMessageAsRead/${this.instance}`, {
        readMessages: [{
          id: messageId,
          fromMe: false,
          remote: `${toEvoNumber(phone)}@s.whatsapp.net`,
        }],
      });
    } catch {
      // No crítico — ignorar si falla
    }
  }

  // ─── Descargar media ───────────────────────────────────────────────────────

  async downloadMedia(mediaId: string): Promise<Buffer> {
    const res = await this.http.post(
      `/chat/getBase64FromMediaMessage/${this.instance}`,
      { message: { key: { id: mediaId } } },
    );
    const base64 = res.data?.base64 as string | undefined;
    if (!base64) throw new Error('Evolution API: no base64 in media response');
    return Buffer.from(base64, 'base64');
  }

  // ─── Build request por tipo ────────────────────────────────────────────────

  private buildRequest(phone: string, message: OutgoingMessage): { endpoint: string; payload: object } {
    switch (message.type) {
      case 'text':
        return {
          endpoint: `/message/sendText/${this.instance}`,
          payload: { number: phone, text: message.text?.body ?? '' },
        };

      case 'interactive': {
        const ia = message.interactive!;

        if (ia.type === 'button') {
          const action = ia.action as ButtonAction;
          return {
            endpoint: `/message/sendButtons/${this.instance}`,
            payload: {
              number: phone,
              ...(ia.header ? { title: ia.header.text } : {}),
              description: ia.body.text,
              ...(ia.footer ? { footer: ia.footer.text } : {}),
              buttons: action.buttons.map(b => ({
                buttonId: b.reply.id,
                buttonText: { displayText: b.reply.title },
              })),
            },
          };
        }

        // list
        const action = ia.action as ListAction;
        return {
          endpoint: `/message/sendList/${this.instance}`,
          payload: {
            number: phone,
            ...(ia.header ? { title: ia.header.text } : {}),
            description: ia.body.text,
            buttonText: action.button,
            ...(ia.footer ? { footer: ia.footer.text } : {}),
            sections: action.sections.map(s => ({
              title: s.title,
              rows: s.rows.map(r => ({
                rowId: r.id,
                title: r.title,
                ...(r.description ? { description: r.description } : {}),
              })),
            })),
          },
        };
      }

      case 'image': {
        const img = message.image!;
        return {
          endpoint: `/message/sendMedia/${this.instance}`,
          payload: {
            number: phone,
            mediatype: 'image',
            ...(img.link ? { media: img.link } : {}),
            ...(img.caption ? { caption: img.caption } : {}),
          },
        };
      }

      default:
        throw new Error(`Unsupported message type: ${message.type as string}`);
    }
  }

  // META_LEGACY — apiVersion getter (ya no necesario)
  // get apiVersion(): string { return WA_API_VERSION; }
}

export const whatsappClient = new WhatsAppClient();
