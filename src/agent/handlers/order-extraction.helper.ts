/**
 * Helper compartido para extraer ítems del carrito desde texto libre.
 *
 * Devuelve CartExtraction con:
 *   - toAdd:    ítems a agregar/aumentar en el carrito
 *   - toRemove: ítems a quitar/disminuir del carrito
 *   - notFound: nombres que el cliente mencionó pero no están en el menú
 *
 * Estrategia en cascada:
 *   1. LLM (Gemini) — interpreta lenguaje natural, detecta add/remove, identifica notFound
 *   2. Fallback por texto — busca nombres de ítems + verbos de remoción literalmente en el mensaje
 */
import type { CartItem } from '../../redis/session-manager';
import type { CategoryWithItems } from '../../menu/menu-service';
import { getActiveMenuForLlm, getItemById } from '../../menu/menu-service';
import { extractOrderFromText } from '../../llm/gemini-client';
import type { UserIntent } from '../../llm/gemini-client';
import { getDayPromos, isPromoDay } from '../../menu/promo-day-service';
import { PROMO_CATEGORY_NAME } from './menu-display';
import { logger } from '../../utils/logger';

export interface AmbiguousCandidate {
  menuItemId: string;
  name: string;
  priceUsdNum: number;
}

export interface CartExtraction {
  toAdd: CartItem[];
  toRemove: CartItem[];
  notFound: string[];
  intent: UserIntent;
  ambiguous: Array<{ userText: string; candidates: AmbiguousCandidate[] }>;
  frustrationLevel: 0 | 1 | 2 | 3;
  escalationReason: string | null;
}

export async function extractCartFromText(
  text: string,
  customerId?: string,
  cart?: CartItem[],
): Promise<CartExtraction> {
  const empty: CartExtraction = { toAdd: [], toRemove: [], notFound: [], intent: 'OTHER', ambiguous: [], frustrationLevel: 0, escalationReason: null };
  if (text.trim().length < 3) return empty;

  const [menu, dayPromos, promoDay] = await Promise.all([
    getActiveMenuForLlm(),
    getDayPromos(),
    isPromoDay(),
  ]);

  // Exclude PROMO DÍA category from LLM context when today is not a promo day
  const menuForLlm = promoDay
    ? menu
    : menu.filter((c) => c.name !== PROMO_CATEGORY_NAME);

  const cartSummary = cart && cart.length > 0
    ? cart.map((i) => `${i.quantity}x ${i.name} — $${i.unitPriceUsd.toFixed(2)}`).join('\n')
    : undefined;

  // ── 1: LLM ────────────────────────────────────────────────────────────────
  try {
    const extraction = await extractOrderFromText(
      text,
      menuForLlm,
      customerId ? { customerId } : undefined,
      dayPromos.length > 0 && promoDay ? dayPromos : undefined,
      cartSummary,
    );

    const toAdd: CartItem[] = [];
    const toRemove: CartItem[] = [];

    for (const extracted of extraction.items) {
      let item = await getItemById(extracted.menuItemId);

      // Fallback: buscar por nombre si el ID no coincidió
      if (!item && extracted.name) {
        item = findItemByName(extracted.name, menu) ?? null;
      }

      if (!item) continue;

      const cartItem: CartItem = {
        menuItemId: item.id,
        name: item.name,
        quantity: extracted.quantity,
        unitPriceUsd: item.priceUsdNum,
      };

      if (extracted.action === 'remove') {
        toRemove.push(cartItem);
      } else {
        toAdd.push(cartItem);
      }
    }

    // Resolver candidatos ambiguos a items reales del menú
    const resolvedAmbiguous = (extraction.ambiguous ?? [])
      .map((amb) => ({
        userText: amb.userText,
        candidates: amb.candidates
          .map((name) => findItemByName(name, menu))
          .filter((item): item is NonNullable<typeof item> => item !== undefined)
          .map((item) => ({ menuItemId: item.id, name: item.name, priceUsdNum: item.priceUsdNum })),
      }))
      .filter((amb) => amb.candidates.length > 0);

    const result: CartExtraction = {
      toAdd,
      toRemove,
      notFound: extraction.notFound ?? [],
      intent: extraction.intent ?? 'OTHER',
      ambiguous: resolvedAmbiguous,
      frustrationLevel: extraction.frustrationLevel ?? 0,
      escalationReason: extraction.escalationReason ?? null,
    };

    const hasData = toAdd.length > 0 || toRemove.length > 0 || result.notFound.length > 0 || result.ambiguous.length > 0 || result.intent !== 'OTHER';
    if (hasData) {
      logger.info(
        { add: toAdd.length, remove: toRemove.length, notFound: result.notFound.length },
        'extractCartFromText: LLM matched',
      );
      return result;
    }
  } catch (err) {
    logger.warn({ err }, 'extractCartFromText: LLM failed, trying text fallback');
  }

  // ── 2: Fallback por texto ─────────────────────────────────────────────────
  const fallback = findItemsDirectlyInText(text, menuForLlm);
  if (fallback.toAdd.length > 0 || fallback.toRemove.length > 0) {
    logger.info(
      { add: fallback.toAdd.length, remove: fallback.toRemove.length },
      'extractCartFromText: text fallback matched',
    );
  }
  return { ...fallback, ambiguous: [], intent: fallback.toAdd.length > 0 ? 'ORDER' : 'OTHER', frustrationLevel: 0, escalationReason: null };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findItemByName(name: string, menu: CategoryWithItems[]) {
  const lower = name.toLowerCase();
  for (const cat of menu) {
    const found = cat.items.find(
      (i) => i.name.toLowerCase().includes(lower) || lower.includes(i.name.toLowerCase()),
    );
    if (found) return found;
  }
  return undefined;
}

// Verbos que indican intención de QUITAR un ítem
const REMOVE_VERBS = ['elimina', 'quita', 'borra', 'saca', 'remueve', 'sin ', 'no quiero', 'cancela'];

/**
 * Detecta si el texto justo antes del ítem contiene un verbo de remoción.
 */
function detectAction(lowerText: string, itemNameIdx: number): 'add' | 'remove' {
  const windowBefore = lowerText.slice(Math.max(0, itemNameIdx - 30), itemNameIdx);
  return REMOVE_VERBS.some((v) => windowBefore.includes(v)) ? 'remove' : 'add';
}

/** Busca nombres de ítems del menú literalmente en el texto del usuario. */
function findItemsDirectlyInText(text: string, menu: CategoryWithItems[]): CartExtraction {
  const lower = text.toLowerCase();
  const toAdd: CartItem[] = [];
  const toRemove: CartItem[] = [];

  for (const cat of menu) {
    for (const item of cat.items) {
      const nameIdx = lower.indexOf(item.name.toLowerCase());
      if (nameIdx === -1) continue;

      const qty = extractQtyBeforeName(lower, item.name.toLowerCase());
      const action = detectAction(lower, nameIdx);
      const cartItem: CartItem = {
        menuItemId: item.id,
        name: item.name,
        quantity: qty,
        unitPriceUsd: item.priceUsdNum,
      };

      if (action === 'remove') {
        mergeIntoCart(toRemove, cartItem);
      } else {
        mergeIntoCart(toAdd, cartItem);
      }
    }
  }

  return { toAdd, toRemove, notFound: [], ambiguous: [], intent: 'OTHER', frustrationLevel: 0, escalationReason: null };
}

/** Extrae cantidad mencionada justo antes del nombre del ítem (e.g. "2 nestea", "un nestea"). */
function extractQtyBeforeName(lowerText: string, lowerName: string): number {
  const WORD_NUMS: Record<string, number> = {
    'un': 1, 'una': 1, 'uno': 1,
    'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
  };

  const idx = lowerText.indexOf(lowerName);
  if (idx < 0) return 1;

  const before = lowerText.slice(Math.max(0, idx - 20), idx).trim();

  // Número dígito
  const numMatch = before.match(/(\d+)\s*$/);
  if (numMatch) return Math.min(parseInt(numMatch[1]!, 10), 20);

  // Número en letras
  for (const [word, num] of Object.entries(WORD_NUMS)) {
    if (new RegExp(`\\b${word}\\s*$`).test(before)) return num;
  }

  return 1;
}

function mergeIntoCart(cart: CartItem[], item: CartItem): void {
  const existing = cart.find((c) => c.menuItemId === item.menuItemId);
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    cart.push({ ...item });
  }
}
