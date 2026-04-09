/**
 * Responde preguntas sobre el menú (precios, descripciones, disponibilidad)
 * SIN gastar tokens de LLM.
 *
 * Estrategia:
 *   1. Detectar si el mensaje es una pregunta (regex, 0 tokens)
 *   2. Extraer términos de búsqueda del texto (quitar stop-words)
 *   3. Fuzzy match por solapamiento de tokens contra el menú en memoria (0 tokens)
 *   4. Responder desde DB con precio + descripción
 *
 * Ejemplos que este helper resuelve sin LLM:
 *   "¿cuál es el precio de la big maba?"   → "big" coincide con "Big Burger"
 *   "¿cuánto cuesta el nestea?"            → match exacto
 *   "¿tienen hamburguesa veggie?"          → match exacto
 *   "¿qué ingredientes tiene el big burger?" → descripción desde DB
 */
import type { CategoryWithItems, MenuItemWithBs } from '../../menu/menu-service';
import { getActiveMenuForLlm } from '../../menu/menu-service';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage } from '../../whatsapp/message-builder';

// ─── Detección de preguntas ────────────────────────────────────────────────────

const QUESTION_PATTERNS: RegExp[] = [
  /\?/,
  /^(qué|que|cual|cuál|cuanto|cuánto|cómo|como|tienen|hay|existe|tienes|me puedes|puedes)\b/i,
  /\b(precio|costo|vale|cuesta|cuanto vale|cuanto cuesta|cuánto vale|cuánto cuesta)\b/i,
  /\b(ingrediente|descripci[oó]n|contiene|lleva|incluye|viene|trae)\b/i,
  /\b(qu[eé] es|qu[eé] tiene|qu[eé] lleva|qu[eé] incluye|qu[eé] viene)\b/i,
  /\b(est[aá] disponible|tienen disponible|lo tienen|la tienen)\b/i,
];

export function isMenuQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return QUESTION_PATTERNS.some((p) => p.test(lower));
}

// ─── Extracción de términos de búsqueda ──────────────────────────────────────

// Palabras que no aportan al nombre del producto (se ignoran al buscar)
const STOP_RE = /\b(cual|cuál|es|el|la|los|las|un|una|de|del|al|y|o|precio|costo|cuanto|cuánto|vale|cuesta|tienen|hay|existe|que|qué|me|puedes|dices|decir|tienes|como|cómo|est[aá]|incluye|contiene|lleva|ingredientes|descripci[oó]n|disponible|tienen disponible)\b/gi;

function extractSearchQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/[¿?¡!,.:]/g, ' ')
    .replace(STOP_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Normalización ────────────────────────────────────────────────────────────

/** Elimina tildes y pasa a minúsculas para comparaciones robustas. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Fuzzy match por solapamiento de tokens ───────────────────────────────────

const MIN_TOKEN_LENGTH = 3; // ignorar palabras de ≤2 letras

/**
 * Calcula un score de coincidencia entre la query y el nombre del ítem.
 * Score = fracción de tokens de la query que aparecen en el nombre del ítem.
 * Soporta coincidencias parciales: "maba" no coincide, pero "big" coincide con "big burger".
 */
function matchScore(queryNorm: string, itemNameNorm: string): number {
  const queryTokens = queryNorm.split(' ').filter((t) => t.length >= MIN_TOKEN_LENGTH);
  if (queryTokens.length === 0) return 0;

  const itemTokens = itemNameNorm.split(' ');
  let hits = 0;

  for (const qt of queryTokens) {
    const matched = itemTokens.some(
      (it) =>
        it === qt ||          // exacto
        it.startsWith(qt) ||  // prefijo: "burg" → "burger"
        qt.startsWith(it),    // el ítem es prefijo del query: "nestea" → "nestea"
    );
    if (matched) hits++;
  }

  return hits / queryTokens.length;
}

const SCORE_THRESHOLD = 0.5; // al menos la mitad de los tokens deben coincidir

/** Busca ítems del menú que coincidan con la query. Retorna candidatos ordenados por score. */
export function fuzzyFindItems(
  query: string,
  menu: CategoryWithItems[],
): Array<{ item: MenuItemWithBs; score: number }> {
  const queryNorm = normalize(extractSearchQuery(query));
  if (!queryNorm) return [];

  const results: Array<{ item: MenuItemWithBs; score: number }> = [];

  for (const cat of menu) {
    for (const item of cat.items) {
      const nameNorm = normalize(item.name);
      const score = matchScore(queryNorm, nameNorm);
      if (score >= SCORE_THRESHOLD) {
        results.push({ item, score });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// ─── Handler principal ────────────────────────────────────────────────────────

/**
 * Intenta responder una pregunta sobre el menú sin usar LLM.
 *
 * @returns true si la pregunta fue manejada, false si debe seguir al LLM.
 */
export async function handleMenuQuestion(
  text: string,
  phone: string,
): Promise<boolean> {
  if (!isMenuQuestion(text)) return false;

  const menu = await getActiveMenuForLlm();
  const candidates = fuzzyFindItems(text, menu);

  // ── Ningún producto encontrado → dejar que el LLM responda con contexto completo
  if (candidates.length === 0) {
    return false;
  }

  // ── Un solo producto (o el primero tiene score claramente superior) ──────
  const best = candidates[0]!;
  const secondBest = candidates[1];
  const isClear = !secondBest || best.score - secondBest.score >= 0.4;

  if (isClear) {
    const { item } = best;
    const lines = [
      `*${item.name}*`,
    ];
    if (item.description) lines.push(`📝 ${item.description}`);
    lines.push(`💰 $${item.priceUsdNum.toFixed(2)} USD  |  Bs ${item.priceBs.toFixed(2)}`);
    lines.push(`\n_¿Lo agregas a tu pedido? Escribe "quiero ${item.name.toLowerCase()}" o usa el menú_ 👇`);

    await whatsappClient.sendMessage(textMessage(phone, lines.join('\n')));
    return true;
  }

  // ── Múltiples candidatos (ambiguo) ───────────────────────────────────────
  // Mostrar hasta 5 opciones con precios
  const top = candidates.slice(0, 5);
  const optionLines = top.map(({ item }) =>
    `• *${item.name}* — $${item.priceUsdNum.toFixed(2)} | Bs ${item.priceBs.toFixed(2)}${item.description ? `\n  _${item.description}_` : ''}`,
  );

  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `🔍 Encontré varios productos que podrían ser:\n\n${optionLines.join('\n\n')}\n\n¿Cuál te interesa?`,
    ),
  );
  return true;
}
