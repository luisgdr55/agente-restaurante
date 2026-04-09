/**
 * Servicio de configuración dinámica del sistema.
 * Carga claves de SystemConfig desde Postgres con cache en Redis (TTL 60s).
 * Permite actualizar valores en caliente sin reiniciar el servidor.
 */
import { prisma } from '../db/prisma';
import { redisClient } from '../redis/client';
import { logger } from '../utils/logger';

const CONFIG_CACHE_TTL = 60; // segundos
const MENU_CACHE_TTL = 120; // segundos
const MENU_CACHE_KEY = 'menu:active';

// Claves conocidas de SystemConfig
export interface SystemConfigMap {
  USD_TO_BS_RATE: string;
  PAGO_MOVIL_PHONE: string;
  PAGO_MOVIL_BANK: string;
  PAGO_MOVIL_HOLDER: string;
  PAGO_MOVIL_RIF: string;
  RESTAURANT_NAME: string;
  RESTAURANT_HOURS: string;
  DELIVERY_FEE_USD: string;
  MIN_ORDER_USD: string;
  ADMIN_PHONE: string;
  NOTIFICATION_PHONE: string;
  WELCOME_MESSAGE: string;
  BUSINESS_ACTIVE: string;
  DELIVERY_AVAILABLE: string;
  DELIVERY_ETA_MINUTES: string;  // Tiempo estimado de entrega en minutos
  RESTAURANT_ADDRESS: string;    // Dirección física del restaurante
  // Horario automático
  SCHEDULE_ENABLED: string;    // "true" | "false"
  SCHEDULE_OPEN_TIME: string;  // "HH:MM" en hora Venezuela (UTC-4)
  SCHEDULE_CLOSE_TIME: string; // "HH:MM" en hora Venezuela (UTC-4)
  SCHEDULE_DAYS: string;       // JSON array de días activos, ej: "[1,2,3,4,5,6]" (0=Dom, 6=Sáb)
}

export type ConfigKey = keyof SystemConfigMap;

export async function getConfig(key: ConfigKey): Promise<string | null> {
  const cacheKey = `cfg:${key}`;

  // 1. Buscar en cache Redis
  const cached = await redisClient.get(cacheKey);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as string;
    } catch {
      return cached;
    }
  }

  // 2. Buscar en DB
  const record = await prisma.systemConfig.findUnique({ where: { key } });
  if (!record) {
    logger.warn({ key }, 'Config key not found in DB');
    return null;
  }

  // 3. Guardar en cache
  await redisClient.set(cacheKey, JSON.stringify(record.value), 'EX', CONFIG_CACHE_TTL);
  return record.value;
}

export async function getAllConfig(): Promise<Partial<SystemConfigMap>> {
  const cacheKey = 'cfg:all';

  // 1. Buscar en cache Redis
  const cached = await redisClient.get(cacheKey);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as Partial<SystemConfigMap>;
    } catch {
      // fall through to DB
    }
  }

  // 2. Buscar en DB
  const records = await prisma.systemConfig.findMany();
  const result: Partial<SystemConfigMap> = {};
  for (const r of records) {
    (result as Record<string, string>)[r.key] = r.value;
  }

  // 3. Guardar en cache
  await redisClient.set(cacheKey, JSON.stringify(result), 'EX', CONFIG_CACHE_TTL);
  return result;
}

export async function getConfigs(keys: ConfigKey[]): Promise<Partial<SystemConfigMap>> {
  const result: Partial<SystemConfigMap> = {};
  await Promise.all(
    keys.map(async (key) => {
      const value = await getConfig(key);
      if (value !== null) (result as Record<string, string>)[key] = value;
    }),
  );
  return result;
}

export async function getMenu() {
  // 1. Buscar en cache Redis
  const cached = await redisClient.get(MENU_CACHE_KEY);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as unknown[];
    } catch {
      // fall through to DB
    }
  }

  // 2. Buscar en DB
  const items = await prisma.menuItem.findMany({
    where: { isAvailable: true, deletedAt: null },
    include: { category: true },
    orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });

  // 3. Guardar en cache
  await redisClient.set(MENU_CACHE_KEY, JSON.stringify(items), 'EX', MENU_CACHE_TTL);
  return items;
}

export async function setConfig(key: ConfigKey, value: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  // Invalidar cache
  await invalidateConfigCache(key);
  logger.info({ key, value }, 'Config updated');
}

export async function invalidateConfigCache(key?: ConfigKey): Promise<void> {
  if (key) {
    await redisClient.del(`cfg:${key}`);
  }
  // Always invalidate the all-config cache since it may contain stale data
  await redisClient.del('cfg:all');
}

export async function invalidateMenuCache(categoryId?: string): Promise<void> {
  // Borra TODAS las claves de caché del menú (config-service + menu-service)
  const keys = [
    MENU_CACHE_KEY,   // menu:active  (config-service)
    'menu:full',      // menu:full    (menu-service LLM)
    'menu:categories',// categorías   (menu-service)
  ];
  if (categoryId) keys.push(`menu:cat:${categoryId}`);
  await Promise.all(keys.map((k) => redisClient.del(k)));
}

// ─── Horario automático ───────────────────────────────────────────────────────

/**
 * Redis key para override manual de horario.
 * Valor: Unix timestamp (ms) hasta el que dura el override.
 * No usa SystemConfig para evitar el delay del cache de 60s.
 */
const MANUAL_OVERRIDE_KEY = 'schedule:manual_override_until';

/**
 * Devuelve la hora actual en Venezuela (UTC-4, sin DST).
 */
function getVenezuelaTime(): { totalMinutes: number; dayOfWeek: number } {
  const venMs = Date.now() - 4 * 60 * 60 * 1000; // UTC-4
  const d = new Date(venMs);
  return {
    totalMinutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    dayOfWeek: d.getUTCDay(), // 0=Dom, 1=Lun … 6=Sáb
  };
}

/**
 * Evalúa si el horario configurado en DB corresponde a "abierto" ahora mismo.
 */
async function isWithinSchedule(): Promise<boolean> {
  const [openTime, closeTime, daysRaw] = await Promise.all([
    getConfig('SCHEDULE_OPEN_TIME'),
    getConfig('SCHEDULE_CLOSE_TIME'),
    getConfig('SCHEDULE_DAYS'),
  ]);

  if (!openTime || !closeTime) return false;

  const { totalMinutes, dayOfWeek } = getVenezuelaTime();

  // Parsear horario
  const [openH = 0, openM = 0] = openTime.split(':').map(Number);
  const [closeH = 0, closeM = 0] = closeTime.split(':').map(Number);
  const openMins  = openH  * 60 + openM;
  const closeMins = closeH * 60 + closeM;

  // Verificar días activos
  let activeDays: number[] = [1, 2, 3, 4, 5, 6]; // Lunes-Sábado por defecto
  try {
    if (daysRaw) activeDays = JSON.parse(daysRaw) as number[];
  } catch { /* usar default */ }

  if (!activeDays.includes(dayOfWeek)) return false;

  // Verificar ventana horaria (soporta horarios que cruzan medianoche)
  if (closeMins > openMins) {
    return totalMinutes >= openMins && totalMinutes < closeMins;
  } else {
    // Overnight: ej. 22:00 → 02:00
    return totalMinutes >= openMins || totalMinutes < closeMins;
  }
}

/**
 * Determina si el restaurante está abierto considerando:
 *  1. Override manual (temporal o permanente) — máxima prioridad
 *  2. Horario automático (si SCHEDULE_ENABLED = true)
 *  3. Flag BUSINESS_ACTIVE (fallback, igual que antes)
 */
export async function isBusinessActive(): Promise<boolean> {
  // 1. Override manual activo?
  const overrideRaw = await redisClient.get(MANUAL_OVERRIDE_KEY);
  if (overrideRaw !== null) {
    const until = parseInt(overrideRaw, 10);
    if (Date.now() < until) {
      // Override vigente — usar BUSINESS_ACTIVE como referencia de estado
      const value = await getConfig('BUSINESS_ACTIVE');
      return value?.toLowerCase() === 'true';
    }
    // Override expirado — limpiarlo
    await redisClient.del(MANUAL_OVERRIDE_KEY);
    logger.info('Manual schedule override expired, reverting to auto-schedule');
  }

  // 2. Horario automático
  const scheduleEnabled = await getConfig('SCHEDULE_ENABLED');
  if (scheduleEnabled === 'true') {
    return isWithinSchedule();
  }

  // 3. Fallback: flag manual
  const value = await getConfig('BUSINESS_ACTIVE');
  return value?.toLowerCase() === 'true';
}

/**
 * Activa el restaurante.
 * @param hours  Si se especifica, activa solo por N horas (override temporal).
 *               Si es undefined, activa indefinidamente (limpia el horario automático).
 */
export async function activateBusiness(hours?: number): Promise<void> {
  await setConfig('BUSINESS_ACTIVE', 'true');
  if (hours && hours > 0) {
    const until = Date.now() + hours * 60 * 60 * 1000;
    await redisClient.set(MANUAL_OVERRIDE_KEY, until.toString());
  } else {
    await redisClient.del(MANUAL_OVERRIDE_KEY);
  }
}

/**
 * Desactiva el restaurante manualmente (anula el horario automático hasta que el admin lo reactive).
 */
export async function deactivateBusiness(): Promise<void> {
  await setConfig('BUSINESS_ACTIVE', 'false');
  // Override permanente: poner fecha muy lejana para que el schedule no lo reactive
  // Se limpia cuando el admin use /activar o /horario on
  const FAR_FUTURE = Date.now() + 365 * 24 * 60 * 60 * 1000;
  await redisClient.set(MANUAL_OVERRIDE_KEY, FAR_FUTURE.toString());
}

/**
 * Elimina cualquier override manual, dejando el horario automático al mando.
 */
export async function clearManualOverride(): Promise<void> {
  await redisClient.del(MANUAL_OVERRIDE_KEY);
}

/**
 * Configura el horario automático.
 */
export async function setSchedule(
  openTime: string,
  closeTime: string,
  days?: number[],
): Promise<void> {
  await setConfig('SCHEDULE_OPEN_TIME', openTime);
  await setConfig('SCHEDULE_CLOSE_TIME', closeTime);
  if (days) {
    await setConfig('SCHEDULE_DAYS', JSON.stringify(days));
  }
}

/**
 * Devuelve un resumen legible del estado del horario para el admin.
 */
export async function getScheduleStatus(): Promise<string> {
  const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  const [schedEnabled, openTime, closeTime, daysRaw] = await Promise.all([
    getConfig('SCHEDULE_ENABLED'),
    getConfig('SCHEDULE_OPEN_TIME'),
    getConfig('SCHEDULE_CLOSE_TIME'),
    getConfig('SCHEDULE_DAYS'),
  ]);

  const overrideRaw = await redisClient.get(MANUAL_OVERRIDE_KEY);
  const isOpen = await isBusinessActive();

  const lines: string[] = [];
  lines.push(`*Estado actual:* ${isOpen ? '🟢 Abierto' : '🔴 Cerrado'}`);

  if (overrideRaw !== null) {
    const until = parseInt(overrideRaw, 10);
    if (Date.now() < until && until < Date.now() + 364 * 24 * 60 * 60 * 1000) {
      // Override temporal con fecha real
      const venMs = until - 4 * 60 * 60 * 1000;
      const d = new Date(venMs);
      lines.push(`*Override manual activo hasta:* ${d.getUTCHours().toString().padStart(2,'0')}:${d.getUTCMinutes().toString().padStart(2,'0')}`);
    } else if (Date.now() < until) {
      lines.push(`*Override manual:* activo (desactivado manualmente)`);
    }
  }

  if (schedEnabled === 'true') {
    let daysText = 'todos los días';
    try {
      const days = daysRaw ? (JSON.parse(daysRaw) as number[]) : [1,2,3,4,5,6];
      daysText = days.map((d) => DAY_NAMES[d] ?? d).join(', ');
    } catch { /* usar default */ }
    lines.push(`*Horario auto:* ✅ activado`);
    lines.push(`*Apertura:* ${openTime ?? '--'} | *Cierre:* ${closeTime ?? '--'}`);
    lines.push(`*Días:* ${daysText}`);
  } else {
    lines.push(`*Horario auto:* 🔴 desactivado`);
  }

  const { totalMinutes, dayOfWeek } = getVenezuelaTime();
  const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const m = (totalMinutes % 60).toString().padStart(2, '0');
  lines.push(`\n_Hora VEN actual: ${h}:${m} ${DAY_NAMES[dayOfWeek]}_`);

  return lines.join('\n');
}

// ─── Notificación de cierre (una sola vez por contacto) ──────────────────────

const CLOSED_NOTIFIED_TTL = 8 * 60 * 60; // 8 horas en segundos

export async function hasClosedNotification(phone: string): Promise<boolean> {
  const key = `closed_notified:${phone}`;
  return (await redisClient.exists(key)) === 1;
}

export async function markClosedNotified(phone: string): Promise<void> {
  const key = `closed_notified:${phone}`;
  await redisClient.set(key, '1', 'EX', CLOSED_NOTIFIED_TTL);
}

export async function getExchangeRate(): Promise<number> {
  const value = await getConfig('USD_TO_BS_RATE');
  return parseFloat(value ?? '1');
}

export function usdToBs(amountUsd: number, rate: number): number {
  return Math.round(amountUsd * rate * 100) / 100;
}
