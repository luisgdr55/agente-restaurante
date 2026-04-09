/**
 * Cliente LLM via OpenRouter → Gemini.
 *
 * Principios de ahorro de tokens:
 * - Se invoca SOLO para: (1) extraer pedidos de texto libre, (2) respuestas a preguntas
 * - max_tokens estrictamente limitado (200 extracción, 300 respuestas)
 * - System prompt del menú se envía en cada llamada (OpenRouter cachea automáticamente
 *   prompts repetidos — mismo hash de contenido → cache hit sin costo adicional)
 * - Nunca se envía historial completo — solo contexto mínimo necesario
 */
import OpenAI from 'openai';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { LLM_MAX_TOKENS_EXTRACTION, LLM_MAX_TOKENS_RESPONSE } from '../config/constants';
import type { CategoryWithItems } from '../menu/menu-service';

// ─── Configuración del cliente ────────────────────────────────────────────────

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://restaurant-agent.app',
    'X-Title': 'Restaurant WhatsApp Agent',
  },
});

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type UserIntent =
  | 'ORDER'     // quiere pedir o agregar algo al pedido (sin quitar nada del carrito)
  | 'MODIFY'    // quiere cambiar, reemplazar o ajustar algo del carrito actual
  | 'QUIT'      // no va a pedir nada en este momento (despedida, desinterés, rechazo amable)
  | 'CANCEL'    // quiere anular un pedido YA CONFIRMADO y pagado
  | 'CONFIRM'   // confirma su pedido ("sí", "ok", "dale", "confirmar")
  | 'BROWSE'    // quiere ver el menú o explorar opciones
  | 'CART'      // quiere ver su carrito
  | 'QUESTION'  // pregunta sobre precios, horarios, disponibilidad
  | 'HUMAN'     // quiere hablar con una persona
  | 'GREETING'  // saludo simple
  | 'OTHER';    // no determinado

export interface OrderExtraction {
  items: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    action: 'add' | 'remove';
  }>;
  notFound: string[];
  ambiguous: Array<{
    userText: string;
    candidates: string[];
  }>;
  intent: UserIntent;
  frustrationLevel: 0 | 1 | 2 | 3;
  escalationReason: string | null;
}

export interface ConversationContext {
  customerName: string;
  userMessage: string;
  restaurantName: string;
  currentCartSummary?: string;
}

export interface RestaurantContext {
  restaurantName: string;
  hours?: string;
  deliveryFeeUsd?: number;
  minOrderUsd?: number;
}

export interface ActiveOrderContext {
  orderNumber: number;
  status: string;
  cartSummary: string;
  deliveryType: 'DELIVERY' | 'PICKUP';
  deliveryAddress?: string;
  estimatedMinutes?: number;
}

// ─── System prompt del menú (se reutiliza entre llamadas) ────────────────────

export interface DayPromoContext {
  name: string;
  description?: string;
  priceBs: number;
}

// Formato legible por humano (para free response — sin IDs, con Bs)
function formatMenuText(menu: CategoryWithItems[]): string {
  return menu
    .map((cat) => {
      const items = cat.items
        .map((i) => `  - ${i.name} — $${i.priceUsdNum.toFixed(2)} USD / Bs ${i.priceBs.toFixed(2)}`)
        .join('\n');
      return `## ${cat.name}\n${items}`;
    })
    .join('\n\n');
}

function buildMenuSystemPrompt(menu: CategoryWithItems[], dayPromos?: DayPromoContext[], cartSummary?: string): string {
  const menuText = menu
    .map((cat) => {
      const items = cat.items
        .map((i) => {
          const desc = i.description ? ` — ${i.description.slice(0, 80)}` : '';
          return `  - ID:"${i.id}" | "${i.name}"${desc} | $${i.priceUsdNum.toFixed(2)} USD`;
        })
        .join('\n');
      return `## ${cat.name}\n${items}`;
    })
    .join('\n\n');

  let promoSection = '';
  if (dayPromos && dayPromos.length > 0) {
    const promoLines = dayPromos
      .map((p, i) => `  - PROMO-${i} | "${p.name}"${p.description ? ` (${p.description})` : ''} | Bs ${p.priceBs.toFixed(2)}`)
      .join('\n');
    promoSection = `\n\nPROMOS ESPECIALES DE HOY (también están disponibles para pedir; mapéalas al ítem del menú con nombre más similar):
${promoLines}
NOTA PROMOS:
- Si el cliente menciona una promo por nombre, usa el ID del ítem del menú más parecido.
- Si el cliente dice "esa promo", "la promo", "quiero esa", "dame ese combo", "eso quiero" y hay UNA sola promo activa, mapéala automáticamente.
- Si hay varias promos y la referencia es vaga, ponlas todas en "ambiguous".
- Si no hay ítem similar en el menú, ponlo en "notFound".`;
  }

  const cartSection = cartSummary
    ? `\n\nCARRITO ACTUAL DEL CLIENTE:\n${cartSummary}\n\nCONTEXTO DE CARRITO: Si el cliente corrige, ajusta o reemplaza algo de este carrito ("no, mejor con refresco", "quita eso y ponme X", "mejor la triple", "no era eso", "cámbialo"), usa intent:"MODIFY" e incluye action:"remove" para lo que sale y action:"add" para lo que entra.`
    : `\n\nCARRITO ACTUAL DEL CLIENTE:\n[vacío]`;

  return `Eres el asistente de pedidos de un restaurante de comida rápida.
Tu única función es interpretar mensajes de clientes y devolver JSON estructurado.

MENÚ DISPONIBLE (solo estos productos existen):
${menuText}${promoSection}${cartSection}

SCHEMA DE RESPUESTA (usa EXACTAMENTE estos campos):
{
  "items": [
    { "menuItemId": "<ID exacto>", "name": "<nombre>", "quantity": <entero>, "action": "add" }
  ],
  "notFound": ["<nombre mencionado que NO está en el menú>"],
  "ambiguous": [
    { "userText": "<texto>", "candidates": ["<opción A>", "<opción B>"] }
  ],
  "intent": "<ver valores permitidos abajo>",
  "frustration_level": <0-3>,
  "escalation_reason": "<motivo en español o null>"
}

VALORES DE FRUSTRATION_LEVEL:
- 0 → neutral, sin señales de malestar
- 1 → ligera incomodidad (repite pregunta, expresa confusión leve)
- 2 → frustración clara (queja explícita, tono molesto, segunda vez sin respuesta útil)
- 3 → frustración severa (insultos, amenazas, "esto es un asco", "hablar con gerente", abandono inminente)
ESCALATION_REASON: si frustration_level >= 2, describe brevemente el motivo en español (ej: "Cliente no encontró su pedido dos veces"). Si es 0-1, devuelve null.

VALORES DE INTENT — clasifica según la INTENCIÓN REAL del mensaje, no las palabras exactas:
- "ORDER"    → el cliente quiere agregar algo al pedido. Incluye cuando agrega algo adicional
              a lo que ya tiene en el carrito sin quitar nada.
- "MODIFY"   → el cliente quiere cambiar algo del carrito actual: corregir, reemplazar o ajustar.
              items debe contener action:"remove" para lo que sale y action:"add" para lo que entra.
              Si el cliente solo agrega sin quitar → usar ORDER, no MODIFY.
- "QUIT"     → el cliente no va a pedir nada en este momento: despedida, desinterés, rechazo amable.
              Aplica aunque el carrito tenga ítems. "no quiero nada", "gracias", "mejor no", "chao".
              NUNCA confundir con CANCEL — QUIT no requiere pedido confirmado ni pagado.
- "CANCEL"   → el cliente quiere anular un pedido YA CONFIRMADO y pagado. Solo en ese contexto.
              NUNCA usar CANCEL mientras el carrito está en construcción.
- "CONFIRM"  → confirma o acepta el pedido que está viendo
- "BROWSE"   → quiere explorar el menú sin tener un pedido concreto en mente
- "CART"     → quiere ver el resumen de lo que lleva en el carrito
- "QUESTION" → pregunta sobre el negocio: precios, horarios, ingredientes, disponibilidad
- "HUMAN"    → quiere hablar con una persona real
- "GREETING" → saludo puro sin ninguna otra intención
- "OTHER"    → genuinamente no es posible determinar la intención

REGLAS DE COINCIDENCIA (CRÍTICO — lee con atención):
1. Responde SOLO con JSON, sin texto extra, sin markdown
2. El campo "intent" es OBLIGATORIO en toda respuesta
3. Campos obligatorios por ítem: "menuItemId", "name", "quantity", "action"
4. "action" debe ser "add" o "remove":
   - Palabras que indican AGREGAR: quiero, dame, agrega, pon, añade, también, más, tráeme, necesito, mándame
   - Palabras que indican QUITAR: elimina, quita, borra, saca, remueve, sin, no quiero, cancela
5. "menuItemId" debe ser el ID exacto copiado de la lista del menú
6. MATCHING FLEXIBLE — debes identificar productos aunque el cliente escriba mal:
   - Ignora tildes/acentos: "nestea" = "néstea", "limon" = "limón"
   - Ignora guiones/espacios: "cocacola" = "coca-cola", "bigmac" = "big mac", "hotdog" = "hot dog"
   - Tolera errores tipográficos de 1-2 letras: "hamburgesa" = "hamburguesa", "piza" = "pizza"
   - Tolera variaciones fonéticas: "maba" = "mab", "wichh" = "wich"
   - Ignora mayúsculas/minúsculas
   - Palabras parciales si son únicas en el menú: "crispy" identifica "Pollo Crispy"
   - Abreviaciones comunes: usa el contexto del menú disponible para inferir
   - Si hay duda entre dos ítems parecidos → usa "ambiguous"
7. Si el cliente menciona algo que definitivamente NO está en el menú → agrégalo al array "notFound"
8. Si un ítem es ambiguo (múltiples coincidencias posibles) → ponlo en "ambiguous"
9. Cantidades: enteros positivos, máx 20 por ítem. Si no indica cantidad → asume 1
10. Si no hay ítems válidos: {"items":[],"notFound":[],"ambiguous":[],"intent":"OTHER"}
11. REGLA CRÍTICA — CANCEL vs MODIFY vs QUIT:
    CANCEL: solo para pedidos ya confirmados y pagados. NUNCA durante construcción del carrito.
    QUIT: el cliente se va sin pedir (puede tener ítems en el carrito o no).
    MODIFY: el cliente ajusta o reemplaza ítems del carrito actual.

ESTRUCTURA DEL MENÚ — REGLA CRÍTICA:
Este restaurante NO vende bebidas ni papas sueltas.
El "refresco" y las "papas" solo existen como parte de los combos
(ítems con el sufijo "+ Papas y Refresco").

Cuando el cliente pida:
- "con refresco", "con papas", "el combo", "y unas papas" junto a una hamburguesa →
  mapear al ítem "[Hamburguesa] + Papas y Refresco" correspondiente.
  NO agregar la hamburguesa sola + refresco/papas en notFound.
- "una coca", "una pepsi", "un refresco solo" SIN hamburguesa en el carrito ni en el mensaje →
  notFound: ["Coca Cola"] + ambiguous con los combos disponibles.
- "una coca", "refresco", "papas" cuando hay una hamburguesa SOLA en el carrito (sin "+ Papas y Refresco") →
  MODIFY: quitar la hamburguesa sola, agregar el ítem del menú con el MISMO nombre + "+ Papas y Refresco".
  REGLA: busca en el menú el ítem cuyo nombre sea "[Mismo nombre de la hamburguesa del carrito] + Papas y Refresco".
  NUNCA poner la bebida/papas en notFound cuando hay una hamburguesa sola en el carrito.
- "quiero una Clásica con refresco" →
  items: [{ "Clásica + Papas y Refresco", action:"add" }] — NO "Clásica" sola.

EJEMPLOS:
CARRITO: [vacío]
"quiero una clásica con refresco" → ORDER
  add: "Clásica + Papas y Refresco"

"dame una pana y una coca" → ORDER
  add: "Pana + Papas y Refresco"
  notFound: [] (la coca se asume incluida en el combo)

"quiero una coca cola sola" → OTHER
  notFound: ["Coca Cola"]
  (no hay bebidas sueltas en el menú)

"hamburgesa doble" → ORDER
"qué tienen de comer?" → BROWSE
"no gracias" → QUIT
"cancelar mi pedido" → CANCEL (pedido ya confirmado y pagado)
"sí, confirmar" → CONFIRM

CARRITO: [1x Yebram's Burger (Sola)]
"no, con refresco" → MODIFY | remove: "Yebram's Burger (Sola)", add: "Yebram's Burger + Papas y Refresco"
"y una coca también" → MODIFY | remove: "Yebram's Burger (Sola)", add: "Yebram's Burger + Papas y Refresco"
"mejor el combo" → MODIFY | remove: "Yebram's Burger (Sola)", add: "Yebram's Burger + Papas y Refresco"
"quita esa vaina" → MODIFY | remove: "Yebram's Burger (Sola)"
"eso no, cámbialo" → MODIFY | remove: "Yebram's Burger (Sola)"
"y unas papas también" → MODIFY | remove: "Yebram's Burger (Sola)", add: "Yebram's Burger + Papas y Refresco"
"ponme además unas alitas" → ORDER (agrega sin quitar, la hamburguesa sola permanece)

CARRITO: [1x Pana + Papas y Refresco]
"no quiero nada" → QUIT (no CANCEL — el pedido no está pagado)

IMPORTANTE: Usa tu comprensión semántica del español para clasificar, no busques coincidencias exactas con los ejemplos.`;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  PAYMENT_UNDER_REVIEW:       'comprobante recibido, verificando pago',
  PAYMENT_CONFIRMED:          'pago confirmado',
  ORDER_IN_KITCHEN:           'en preparación en cocina',
  AWAITING_DRIVER_ASSIGNMENT: 'listo, asignando motorizado',
  OUT_FOR_DELIVERY:           'en camino a domicilio',
  ORDER_READY:                'listo para retirar',
};

function buildFreeResponseSystemPrompt(
  restaurantName: string,
  ctx?: RestaurantContext,
  activeOrder?: ActiveOrderContext,
  menu?: CategoryWithItems[],
): string {
  const infoLines: string[] = [];
  if (ctx?.hours)              infoLines.push(`• Horario: ${ctx.hours}`);
  if (ctx?.deliveryFeeUsd !== undefined) infoLines.push(`• Costo de delivery: $${ctx.deliveryFeeUsd.toFixed(2)} USD`);
  if (ctx?.minOrderUsd !== undefined)    infoLines.push(`• Pedido mínimo: $${ctx.minOrderUsd.toFixed(2)} USD`);

  const infoSection = infoLines.length > 0
    ? `\n\nINFORMACIÓN DEL RESTAURANTE:\n${infoLines.join('\n')}`
    : '';

  let orderSection = '';
  if (activeOrder) {
    const statusLabel = ORDER_STATUS_LABELS[activeOrder.status] ?? 'en proceso';
    const modalidad = activeOrder.deliveryType === 'DELIVERY' ? 'Delivery' : 'Pickup (retiro en local)';
    orderSection = `\n\nPEDIDO ACTIVO DEL CLIENTE:\n• Pedido #${activeOrder.orderNumber}: ${activeOrder.cartSummary}\n• Estado: ${statusLabel}\n• Modalidad: ${modalidad}`;
    if (activeOrder.deliveryAddress) orderSection += `\n• Dirección: ${activeOrder.deliveryAddress}`;
    if (activeOrder.estimatedMinutes) orderSection += `\n• ETA aproximado: ~${activeOrder.estimatedMinutes} minutos (puede ser antes, es una estimación)`;
    const deliveryRules = activeOrder.deliveryType === 'DELIVERY'
      ? `\n\nREGLAS DE LENGUAJE (DELIVERY):\n- Si está en cocina: di "se está preparando, pronto saldrá a tu dirección"\n- Si está listo/asignando motorizado: di "ya va en camino a tu dirección"\n- NUNCA digas "puedes pasar a buscarlo" ni "retíralo en local"\n- Puedes mencionar la dirección de entrega si aplica`
      : `\n\nREGLAS DE LENGUAJE (PICKUP):\n- Si está en cocina: di "se está preparando, pronto podrás pasar a buscarlo"\n- Si está listo: di "ya está listo, puedes pasar a buscarlo"\n- NUNCA digas "va en camino" ni menciones dirección de entrega\n- Recuerda al cliente que debe retirar en el local`;
    orderSection += deliveryRules;
  }

  const menuSection = menu && menu.length > 0
    ? `\n\nMENÚ DISPONIBLE HOY:\n${formatMenuText(menu)}\n\nREGLA ABSOLUTA: Solo menciona productos que aparezcan en esta lista. Si el cliente pregunta por algo que no está en el menú, dilo honestamente y sugiere alternativas disponibles. Nunca inventes productos.`
    : '';

  return `Eres el asistente virtual de *${restaurantName}*, un restaurante de comida rápida.
Responde de forma amigable, breve (máx 2-3 oraciones) y en español venezolano casual.
Cuando menciones el tiempo de espera, usa lenguaje flexible y optimista:
  "en unos 20 minuticos o menos", "en menos de 20 minutos", "pronto estará listo, máximo 20 minutos"
  NUNCA digas exactamente "20 minutos" como si fuera una promesa exacta.${infoSection}${orderSection}${menuSection}
Si el cliente pregunta algo que genuinamente no puedes responder con la información disponible,
indica amablemente que puede consultar con el equipo del restaurante. No inventes información.
NUNCA menciones página web, sitio web, redes sociales, Instagram, Facebook, teléfono de contacto
ni ningún canal de comunicación que no esté explícitamente en la información del restaurante de arriba.
Cierra siempre tu respuesta con una micro-invitación a continuar, por ejemplo "¿Te ayudo con algo más? 😊"`;
}

// ─── Extracción de pedido ─────────────────────────────────────────────────────

export async function extractOrderFromText(
  userText: string,
  menu: CategoryWithItems[],
  context?: { customerId?: string; orderId?: string },
  dayPromos?: DayPromoContext[],
  cartSummary?: string,
): Promise<OrderExtraction> {
  const start = Date.now();

  try {
    const response = await openrouter.chat.completions.create({
      model: env.LLM_MODEL,
      max_tokens: LLM_MAX_TOKENS_EXTRACTION,
      temperature: 0.1, // bajo para consistencia en extracción
      messages: [
        { role: 'system', content: buildMenuSystemPrompt(menu, dayPromos, cartSummary) },
        {
          role: 'user',
          content: `Extrae el pedido del siguiente mensaje y devuelve JSON:\n"${userText}"`,
        },
      ],
    });

    const rawContent = response.choices[0]?.message?.content?.trim() ?? '{}';
    const durationMs = Date.now() - start;

    // Log de uso
    await logLlmUsage({
      ...(context?.customerId !== undefined && { customerId: context.customerId }),
      ...(context?.orderId !== undefined && { orderId: context.orderId }),
      purpose: 'ORDER_EXTRACTION',
      model: env.LLM_MODEL,
      usage: response.usage,
      durationMs,
    });

    return parseOrderExtraction(rawContent);
  } catch (err) {
    logger.error({ err, userText: userText.slice(0, 100) }, 'LLM order extraction failed');
    throw new Error('LLM_UNAVAILABLE');
  }
}

// ─── Respuesta libre ─────────────────────────────────────────────────────────

export async function generateFreeResponse(
  ctx: ConversationContext,
  context?: { customerId?: string },
  restaurantCtx?: RestaurantContext,
  menu?: CategoryWithItems[],
): Promise<string> {
  const start = Date.now();

  try {
    const userContent = ctx.currentCartSummary
      ? `Carrito actual: ${ctx.currentCartSummary}\n\nPregunta del cliente: ${ctx.userMessage}`
      : ctx.userMessage;

    const systemPrompt = buildFreeResponseSystemPrompt(ctx.restaurantName, restaurantCtx, undefined, menu);

    const response = await openrouter.chat.completions.create({
      model: env.LLM_MODEL,
      max_tokens: LLM_MAX_TOKENS_RESPONSE,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });

    const reply = response.choices[0]?.message?.content?.trim() ?? '';
    const durationMs = Date.now() - start;

    await logLlmUsage({
      ...(context?.customerId !== undefined && { customerId: context.customerId }),
      purpose: 'FREE_RESPONSE',
      model: env.LLM_MODEL,
      usage: response.usage,
      durationMs,
    });

    return reply;
  } catch (err) {
    logger.error({ err }, 'LLM free response failed');
    throw new Error('LLM_UNAVAILABLE');
  }
}

// ─── Respuesta contextual a estado del pedido ─────────────────────────────────

/**
 * Genera una respuesta natural cuando el cliente escribe en estados post-pago.
 * Usa el contexto completo del pedido activo para responder con empatía y precisión.
 */
export async function generateOrderStatusResponse(
  customerName: string,
  userMessage: string,
  restaurantName: string,
  activeOrder: ActiveOrderContext,
  restaurantCtx?: RestaurantContext,
  context?: { customerId?: string },
): Promise<string> {
  const start = Date.now();

  try {
    const systemPrompt = buildFreeResponseSystemPrompt(restaurantName, restaurantCtx, activeOrder);
    const userContent = `${customerName} dice: ${userMessage}`;

    const response = await openrouter.chat.completions.create({
      model: env.LLM_MODEL,
      max_tokens: LLM_MAX_TOKENS_RESPONSE,
      temperature: 0.6,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });

    const reply = response.choices[0]?.message?.content?.trim() ?? '';
    const durationMs = Date.now() - start;

    await logLlmUsage({
      ...(context?.customerId !== undefined && { customerId: context.customerId }),
      purpose: 'FREE_RESPONSE',
      model: env.LLM_MODEL,
      usage: response.usage,
      durationMs,
    });

    return reply;
  } catch (err) {
    logger.error({ err }, 'LLM order status response failed');
    throw new Error('LLM_UNAVAILABLE');
  }
}

// ─── Logger de uso ────────────────────────────────────────────────────────────

interface UsageLog {
  customerId?: string | undefined;
  orderId?: string | undefined;
  purpose: 'ORDER_EXTRACTION' | 'FREE_RESPONSE' | 'INTENT_CLASSIFICATION';
  model: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
  durationMs: number;
}

// Precios OpenRouter de Gemini Flash (actualizar si cambia)
const COST_PER_TOKEN: Record<string, { input: number; output: number }> = {
  'google/gemini-2.0-flash-001':    { input: 0.10  / 1_000_000, output: 0.40  / 1_000_000 },
  'google/gemini-flash-1.5':        { input: 0.075 / 1_000_000, output: 0.30  / 1_000_000 },
  'google/gemini-flash-1.5-8b':     { input: 0.0375/ 1_000_000, output: 0.15  / 1_000_000 },
  'google/gemini-2.5-pro-preview':  { input: 1.25  / 1_000_000, output: 10.0  / 1_000_000 },
};

async function logLlmUsage(log: UsageLog): Promise<void> {
  const tokensIn = log.usage?.prompt_tokens ?? 0;
  const tokensOut = log.usage?.completion_tokens ?? 0;
  const pricing = COST_PER_TOKEN[log.model] ?? { input: 0, output: 0 };
  const costUsd = tokensIn * pricing.input + tokensOut * pricing.output;

  logger.info(
    {
      purpose: log.purpose,
      model: log.model,
      tokensIn,
      tokensOut,
      costUsd: costUsd.toFixed(8),
      durationMs: log.durationMs,
    },
    'LLM usage',
  );

  // Persistir en DB de forma no bloqueante
  void prisma.llmUsageLog
    .create({
      data: {
        ...(log.customerId !== undefined && { customerId: log.customerId }),
        ...(log.orderId !== undefined && { orderId: log.orderId }),
        purpose: log.purpose,
        model: log.model,
        tokensInput: tokensIn,
        tokensOutput: tokensOut,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        costUsd: costUsd.toString(),
        durationMs: log.durationMs,
      },
    })
    .catch((err: unknown) => logger.warn({ err }, 'Failed to persist LLM usage log'));
}

// ─── Parser de JSON ───────────────────────────────────────────────────────────

function parseOrderExtraction(raw: string): OrderExtraction {
  try {
    // Limpiar posibles ``` que Gemini a veces añade pese al system prompt
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned) as Partial<OrderExtraction>;

    // Normalizar items: tolerar aliases que el LLM pueda devolver
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items = rawItems
      .map((raw: Record<string, unknown>) => ({
        menuItemId: (raw.menuItemId ?? raw.id ?? '') as string,
        name: (raw.name ?? '') as string,
        quantity: Number(raw.quantity ?? raw.qty ?? 1),
        action: ((raw.action === 'remove' ? 'remove' : 'add') as 'add' | 'remove'),
      }))
      .filter((i) => i.menuItemId && i.quantity > 0);

    const VALID_INTENTS: UserIntent[] = [
      'ORDER', 'MODIFY', 'QUIT', 'CANCEL', 'CONFIRM', 'BROWSE', 'CART', 'QUESTION', 'HUMAN', 'GREETING', 'OTHER',
    ];
    const rawIntent = parsed.intent as string | undefined;
    const intent: UserIntent = VALID_INTENTS.includes(rawIntent as UserIntent)
      ? (rawIntent as UserIntent)
      : items.length > 0 ? 'ORDER' : 'OTHER';

    const rawLevel = Number((parsed as Record<string, unknown>).frustration_level ?? 0);
    const frustrationLevel = ([0, 1, 2, 3].includes(rawLevel) ? rawLevel : 0) as 0 | 1 | 2 | 3;
    const rawReason = (parsed as Record<string, unknown>).escalation_reason;
    const escalationReason = typeof rawReason === 'string' && rawReason ? rawReason : null;

    return {
      items,
      notFound: Array.isArray(parsed.notFound)
        ? (parsed.notFound as unknown[]).map(String).filter(Boolean)
        : [],
      ambiguous: Array.isArray(parsed.ambiguous) ? parsed.ambiguous : [],
      intent,
      frustrationLevel,
      escalationReason,
    };
  } catch {
    logger.warn({ raw: raw.slice(0, 200) }, 'Failed to parse LLM order extraction JSON');
    return { items: [], notFound: [], ambiguous: [], intent: 'OTHER', frustrationLevel: 0, escalationReason: null };
  }
}

// ─── Agradecimiento personalizado post-entrega ───────────────────────────────

/**
 * Genera un mensaje de agradecimiento personalizado para el cliente
 * al cierre del pedido. Si el LLM falla, retorna un fallback hardcodeado
 * para no interrumpir el flujo de cierre ni el paso a Feature 3.
 */
export async function generateThankYouMessage(
  customerName: string,
  cartSummary: string,
  restaurantName: string,
  context?: { customerId?: string },
): Promise<string> {
  const FALLBACK = `¡Gracias por tu pedido, ${customerName}! Fue un placer atenderte 😊`;

  try {
    const response = await openrouter.chat.completions.create({
      model: env.LLM_MODEL,
      max_tokens: LLM_MAX_TOKENS_RESPONSE,
      temperature: 0.85,
      messages: [
        {
          role: 'system',
          content:
            `Eres el asistente de ${restaurantName}.\n` +
            'Genera un mensaje de agradecimiento para un cliente que acaba de recibir su pedido.\n\n' +
            'REGLAS ESTRICTAS:\n' +
            '- NUNCA empieces el mensaje con el nombre del cliente — suena robótico. ' +
            'El nombre puede aparecer en el medio o al final naturalmente.\n' +
            '- Menciona algo específico de su pedido\n' +
            '- Tono cálido, acento venezolano natural y casual\n' +
            '- Máximo 3 líneas\n' +
            '- Termina invitando a volver\n' +
            '- 1-2 emojis máximo, sin exagerar\n' +
            '- Creativo y sorprendente, nunca genérico\n' +
            '- NUNCA inventes información extra sobre el cliente\n' +
            '- NUNCA salgas del contexto del restaurante',
        },
        {
          role: 'user',
          content: `Cliente: ${customerName}\nPedido recibido: ${cartSummary}\nGenera el mensaje de agradecimiento.`,
        },
      ],
    });

    const reply = response.choices[0]?.message?.content?.trim() ?? '';

    await logLlmUsage({
      ...(context?.customerId !== undefined && { customerId: context.customerId }),
      purpose: 'FREE_RESPONSE',
      model: env.LLM_MODEL,
      usage: response.usage,
      durationMs: 0,
    });

    return reply || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

// ─── Detección de confirmación de entrega ────────────────────────────────────

/**
 * Detecta si un mensaje del motorizado indica que entregó el pedido.
 * Usada en dos contextos:
 *   1. Motorizado registrado → si true: cierra pedido
 *   2. Número desconocido → si true: alerta al admin (no registrado)
 *
 * Fallback conservador: false en cualquier error (nunca cierra pedido por accidente).
 */
export async function detectDeliveryConfirmation(text: string): Promise<boolean> {
  try {
    const response = await openrouter.chat.completions.create({
      model: env.LLM_MODEL,
      max_tokens: 30,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Eres un clasificador de mensajes de motorizado de delivery. ' +
            'Responde SOLO con JSON: {"confirmed":true} o {"confirmed":false}. ' +
            'confirmed=true si el mensaje indica que una entrega fue completada. ' +
            'Ejemplos true: "entregado", "listo", "ya entregué", "llegué", ' +
            '"lo dejé", "entrega hecha", "está listo", "ya lo entregué", ' +
            '"lo entregué", "hecho", "ok listo", "llegue", "deje el pedido", ' +
            '"ya ta", "ta listo", "llegó", "aquí toy", "se lo dejé", "recibido". ' +
            'confirmed=false si el mensaje es cualquier otra cosa.',
        },
        {
          role: 'user',
          content: text.slice(0, 200),
        },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned) as { confirmed?: unknown };
    return parsed.confirmed === true;
  } catch {
    return false;
  }
}

// ─── Resumen de conversación para escalado ────────────────────────────────────

/**
 * Genera un resumen de 3 líneas de la situación del cliente para el admin.
 * Se invoca justo antes de activar AWAITING_HUMAN.
 */
export async function generateConversationSummary(opts: {
  customerName: string;
  lastMessage: string;
  cartSummary: string;
  escalationReason: string | null;
  restaurantName: string;
}): Promise<string> {
  const { customerName, lastMessage, cartSummary, escalationReason, restaurantName } = opts;

  const contextLines = [
    cartSummary ? `Carrito: ${cartSummary}` : 'Sin carrito activo',
    escalationReason ? `Motivo de escalado: ${escalationReason}` : '',
    `Último mensaje: "${lastMessage}"`,
  ].filter(Boolean).join('\n');

  try {
    const response = await openrouter.chat.completions.create({
      model: env.LLM_MODEL,
      max_tokens: 120,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `Eres asistente de ${restaurantName}. Resume en exactamente 3 líneas cortas la situación de un cliente que necesita atención humana. Sé directo y útil para el asesor. Sin saludos ni relleno.`,
        },
        {
          role: 'user',
          content: `Cliente: ${customerName}\n${contextLines}`,
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim()
      ?? 'Cliente requiere atención personalizada.';
  } catch {
    // Fallback sin LLM
    return [
      escalationReason ?? 'Requiere atención personalizada.',
      cartSummary ? `Carrito: ${cartSummary}` : 'Sin pedido activo.',
      `Último mensaje: "${lastMessage.slice(0, 80)}"`,
    ].join('\n');
  }
}
