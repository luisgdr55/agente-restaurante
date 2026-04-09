import { redisClient } from './client';
import { SESSION_KEY_PREFIX, SESSION_TTL_SECONDS } from '../config/constants';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationState =
  | 'IDLE'
  | 'AWAITING_NAME'
  | 'MAIN_MENU'
  | 'BROWSE_CATEGORIES'
  | 'BROWSE_ITEMS'
  | 'BUILDING_ORDER'
  | 'ORDER_CONFIRMATION'
  | 'AWAITING_PAYMENT_METHOD'
  | 'AWAITING_PAYMENT_PROOF'
  | 'PAYMENT_UNDER_REVIEW'
  | 'AWAITING_DELIVERY_TYPE'
  | 'AWAITING_DELIVERY_ADDRESS'
  | 'AWAITING_DELIVERY_REFERENCE'
  | 'ORDER_IN_KITCHEN'
  | 'ORDER_READY'
  | 'ORDER_DELIVERED'
  | 'AWAITING_DRIVER_ASSIGNMENT'
  | 'OUT_FOR_DELIVERY'
  | 'AWAITING_HUMAN'
  | 'ADMIN_MODE'
  | 'AWAITING_FEEDBACK_RATING'
  | 'AWAITING_FEEDBACK_COMMENT';

export interface CartItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceUsd: number;
}

export interface SessionData {
  state: ConversationState;
  customerId?: string;
  customerName?: string;
  phone: string;

  // Contexto de navegación
  currentCategoryId?: string;

  // Pedido en construcción
  cart: CartItem[];
  activeOrderId?: string;

  // Pago
  paymentMethod?: 'PAGO_MOVIL' | 'CASH_ON_DELIVERY';
  paymentReference?: string;
  deliveryType?: 'DELIVERY' | 'PICKUP';
  deliveryAddress?: string;
  deliveryReference?: string;
  // Promoción aplicada al pedido
  appliedPromotionId?: string;
  appliedDiscountUsd?: number;

  // Frustración acumulada
  consecutiveOtherCount?: number;  // intents OTHER consecutivos (reset en cualquier otro intent)

  // Feedback post-entrega
  pendingFeedbackOrderId?: string;   // orderId del pedido que se está calificando
  pendingFeedbackRating?: number;    // rating guardado en AWAITING_FEEDBACK_COMMENT
  feedbackRequestedAt?: string;      // ISO timestamp de cuando entró a AWAITING_FEEDBACK_RATING

  // Meta
  lastActivity: number;  // timestamp ms
  messageCount: number;
}

// ─── Session Manager ──────────────────────────────────────────────────────────

function sessionKey(phone: string): string {
  return `${SESSION_KEY_PREFIX}${phone}`;
}

export async function getSession(phone: string): Promise<SessionData | null> {
  const raw = await redisClient.get(sessionKey(phone));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    logger.warn({ phone }, 'Failed to parse session from Redis, resetting');
    return null;
  }
}

export async function setSession(phone: string, session: SessionData): Promise<void> {
  const updated: SessionData = {
    ...session,
    lastActivity: Date.now(),
  };
  await redisClient.setex(sessionKey(phone), SESSION_TTL_SECONDS, JSON.stringify(updated));
}

// Versión permisiva de Partial que acepta undefined explícito (compatible con exactOptionalPropertyTypes)
export type SessionUpdate = { [K in keyof SessionData]?: SessionData[K] | undefined };

export async function updateSessionState(
  phone: string,
  state: ConversationState,
  extra?: SessionUpdate,
): Promise<SessionData> {
  const existing = await getSession(phone);
  const base = existing ?? { phone, cart: [] as CartItem[], messageCount: 0, lastActivity: Date.now() };
  // Use 'as' to bypass exactOptionalPropertyTypes conflict from spreading SessionUpdate
  const session = {
    ...base,
    ...extra,
    phone: base.phone,
    state,
    lastActivity: Date.now(),
    messageCount: (existing?.messageCount ?? 0) + 1,
  } as SessionData;
  await setSession(phone, session);
  return session;
}

export async function deleteSession(phone: string): Promise<void> {
  await redisClient.del(sessionKey(phone));
}

export async function createDefaultSession(phone: string): Promise<SessionData> {
  const session: SessionData = {
    state: 'IDLE',
    phone,
    cart: [],
    lastActivity: Date.now(),
    messageCount: 0,
  };
  await setSession(phone, session);
  return session;
}

// Verificar si un mensaje ya fue procesado (idempotencia)
export async function isMessageProcessed(messageId: string): Promise<boolean> {
  const key = `msgid:${messageId}`;
  const result = await redisClient.set(key, '1', 'EX', 3600, 'NX');
  return result === null; // null = ya existía → ya procesado
}

// ─── Modo manual (bot habilitado/deshabilitado) ───────────────────────────────

const BOT_ENABLED_KEY = 'bot:enabled';

/**
 * Retorna true si el bot está activo (default).
 * Si la clave no existe en Redis, se asume habilitado.
 */
export async function isBotEnabled(): Promise<boolean> {
  const val = await redisClient.get(BOT_ENABLED_KEY);
  return val !== 'false';
}

/**
 * Activa o desactiva el bot.
 * Cuando está deshabilitado, los mensajes de clientes se reenvían al admin.
 */
export async function setBotEnabled(enabled: boolean): Promise<void> {
  await redisClient.set(BOT_ENABLED_KEY, enabled ? 'true' : 'false');
}
