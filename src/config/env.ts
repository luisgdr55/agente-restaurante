import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Jest sets NODE_ENV=test before workers start.
// In test mode: env vars come from jest.env.js setupFiles — skip dotenv file loading.
// In other modes: load from .env file in project root.
if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Evolution API
  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1),

  // META_LEGACY: WHATSAPP_TOKEN: z.string().min(1),
  // META_LEGACY: WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  // META_LEGACY: WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1),
  // META_LEGACY: WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  // META_LEGACY: WHATSAPP_APP_SECRET: z.string().min(1).optional(),

  // OpenRouter (para Gemini)
  OPENROUTER_API_KEY: z.string().startsWith('sk-'),

  // Modelo LLM (default: Gemini Flash — más barato)
  LLM_MODEL: z.string().default('google/gemini-2.0-flash-001'),

  // Dashboard
  DASHBOARD_PIN: z.string().length(6).regex(/^\d{6}$/),
  KITCHEN_PIN: z.string().length(6).regex(/^\d{6}$/).optional(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // OCR — opcional
  GOOGLE_VISION_API_KEY: z.string().optional(),

  // BullMQ
  QUEUE_CONCURRENCY: z.coerce.number().default(10),
  QUEUE_MAX_RETRIES: z.coerce.number().default(3),
  QUEUE_RETRY_DELAY_MS: z.coerce.number().default(1000),

  // Rate limits
  RATE_LIMIT_PER_PHONE_RPS: z.coerce.number().default(3),

  // META_LEGACY: WHATSAPP_APP_SECRET: z.string().min(1).optional(),
  // (firma HMAC-SHA256 de Meta Cloud API — no aplica a Evolution API)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
