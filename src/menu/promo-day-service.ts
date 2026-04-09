/**
 * Servicio de promos del día — almacenadas en Redis con TTL de 24h.
 *
 * Dos conceptos:
 *   - DayPromo: descripción completa de la promo (incluye precio)
 *   - PROMO_DAYS: qué días de la semana aplica el modo promo (SystemConfig)
 *
 * Flujo normal:
 *   1. Admin registra promos: /estado Combo Pollo + refresco — $4.50
 *   2. Admin configura días: /diaspromo mie,jue
 *   3. Bot muestra promos automáticamente en esos días o cuando detecta status reply
 */
import { redisClient } from '../redis/client';
import { getConfig, setConfig } from './config-service';

const DAY_PROMOS_KEY = 'promo:day:items';
const DAY_PROMOS_TTL = 24 * 60 * 60; // 24h

export interface DayPromo {
  name: string;
  description?: string;
  priceBs: number;
  menuItemId?: string;   // ID del MenuItem en BD (para que sea pedible por la LLM)
  autoCreated?: boolean; // true = fue creado automáticamente; borrar al eliminar la promo
}

// ─── Promos del día (Redis) ───────────────────────────────────────────────────

export async function getDayPromos(): Promise<DayPromo[]> {
  const raw = await redisClient.get(DAY_PROMOS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<DayPromo | { text: string }>;
    // Legacy migration: old promos stored as { text: string }
    return parsed.map((p) =>
      'text' in p && !('name' in p)
        ? { name: (p as { text: string }).text, priceBs: 0 }
        : (p as DayPromo),
    );
  } catch {
    return [];
  }
}

export async function addDayPromo(promo: DayPromo): Promise<number> {
  const promos = await getDayPromos();
  promos.push(promo);
  await redisClient.set(DAY_PROMOS_KEY, JSON.stringify(promos), 'EX', DAY_PROMOS_TTL);
  return promos.length;
}

export async function updateDayPromo(index: number, update: Partial<DayPromo>): Promise<void> {
  const promos = await getDayPromos();
  if (index < 0 || index >= promos.length) return;
  promos[index] = { ...promos[index]!, ...update };
  await redisClient.set(DAY_PROMOS_KEY, JSON.stringify(promos), 'EX', DAY_PROMOS_TTL);
}

export async function removeDayPromo(index: number): Promise<void> {
  const promos = await getDayPromos();
  if (index < 0 || index >= promos.length) return;
  promos.splice(index, 1);
  if (promos.length === 0) {
    await redisClient.del(DAY_PROMOS_KEY);
  } else {
    await redisClient.set(DAY_PROMOS_KEY, JSON.stringify(promos), 'EX', DAY_PROMOS_TTL);
  }
}

export async function clearDayPromos(): Promise<void> {
  await redisClient.del(DAY_PROMOS_KEY);
}

// ─── Días de promo (SystemConfig) ────────────────────────────────────────────
// JS day numbers: 0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb

export async function getPromoDays(): Promise<number[]> {
  const raw = await getConfig('PROMO_DAYS');
  if (!raw || raw.trim() === '') return [];
  return raw.split(',').map(Number).filter((n) => !isNaN(n) && n >= 0 && n <= 6);
}

export async function setPromoDays(days: number[]): Promise<void> {
  const unique = [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  await setConfig('PROMO_DAYS', unique.join(','));
}

export async function isPromoDay(): Promise<boolean> {
  const days = await getPromoDays();
  if (days.length === 0) return false;
  const today = new Date().getDay();
  return days.includes(today);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatDayPromos(promos: DayPromo[], rateUsd?: number): string {
  return promos
    .map((p, i) => {
      const priceStr =
        p.priceBs > 0
          ? rateUsd && rateUsd > 0
            ? `Bs ${p.priceBs.toFixed(2)} (~$${(p.priceBs / rateUsd).toFixed(2)})`
            : `Bs ${p.priceBs.toFixed(2)}`
          : '';
      const line = [`${i + 1}. *${p.name}*${priceStr ? ` — ${priceStr}` : ''}`];
      if (p.description) line.push(`   _${p.description}_`);
      return line.join('\n');
    })
    .join('\n');
}

export const DAY_NAMES_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DAY_NAMES_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
