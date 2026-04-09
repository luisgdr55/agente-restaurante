// ─── WhatsApp ─────────────────────────────────────────────────────────────────
export const WA_API_VERSION = 'v21.0';
export const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`;
export const WA_MAX_BUTTONS = 3;
export const WA_MAX_LIST_ROWS = 10;
export const WA_MAX_LIST_SECTIONS = 10;

// ─── LLM (OpenRouter / Gemini) ────────────────────────────────────────────────
// El modelo se configura por env var LLM_MODEL — default: google/gemini-2.0-flash-001
export const LLM_MAX_TOKENS_EXTRACTION = 500;
export const LLM_MAX_TOKENS_RESPONSE = 300;
export const LLM_MAX_TOKENS_CLASSIFICATION = 150;

// ─── Session ──────────────────────────────────────────────────────────────────
export const SESSION_TTL_SECONDS = 86_400;          // 24h en Redis
export const SESSION_KEY_PREFIX = 'session:';
export const RATE_LIMIT_KEY_PREFIX = 'ratelimit:';
export const IDEMPOTENCY_KEY_PREFIX = 'msgid:';
export const IDEMPOTENCY_TTL_SECONDS = 3_600;       // 1h

// ─── BullMQ ───────────────────────────────────────────────────────────────────
export const QUEUE_MESSAGE_PROCESSING = 'message-processing';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_OCR = 'ocr-processing';
export const DEAD_LETTER_QUEUE = 'dead-letter';

// ─── Orders ───────────────────────────────────────────────────────────────────
export const ORDER_ID_PREFIX = 'ORD';

// Estados post-pago donde una sesión puede tener activeOrderId válido.
// Compartido entre conversation-agent.ts y session-cleanup.ts para evitar desincronización.
export const POST_ORDER_STATES: readonly string[] = [
  'ORDER_IN_KITCHEN', 'ORDER_READY', 'PAYMENT_UNDER_REVIEW',
  'AWAITING_DRIVER_ASSIGNMENT', 'OUT_FOR_DELIVERY',
  'AWAITING_FEEDBACK_RATING', 'AWAITING_FEEDBACK_COMMENT',
];

// ─── Admin ────────────────────────────────────────────────────────────────────
export const ADMIN_COMMAND_PREFIX = '/';

// ─── Regex patterns ───────────────────────────────────────────────────────────
export const REGEX_PAYMENT_REFERENCE = /\b\d{15,25}\b/;
export const REGEX_PHONE = /^[0-9]{10,15}$/;
export const REGEX_NAME = /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s]{2,50}$/;
export const REGEX_ONLY_NUMBERS = /^\d+$/;
