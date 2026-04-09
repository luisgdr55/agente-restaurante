/**
 * Estado MAIN_MENU — menú principal de opciones.
 *
 * Transiciones:
 *   MAIN_MENU → BROWSE_CATEGORIES    (botón "Ver Menú")
 *   MAIN_MENU → MAIN_MENU            (botón "Promociones" — muestra promos y vuelve)
 *   MAIN_MENU → AWAITING_HUMAN       (botón "Hablar con humano")
 *   MAIN_MENU → ORDER_CONFIRMATION   (botón "Cancelar pedido")
 *   MAIN_MENU → MAIN_MENU            (texto libre → re-mostrar menú o delegar a handler de texto)
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { TEMPLATES, textMessage } from '../../whatsapp/message-builder';
import { getActivePromotions, formatPromotionsText } from '../../promotions/promotions-service';
import { getExchangeRate, getConfig } from '../../menu/config-service';
import { getDayPromos, isPromoDay, formatDayPromos } from '../../menu/promo-day-service';
import { updateOrderStatus } from '../../orders/order-service';
import { showCategories } from './menu-display';
import { showConfirmationSummary } from './order-confirmation.handler';
import { showCartSummary, trySmartFallback } from './building-order.handler';
import { extractCartFromText } from './order-extraction.helper';
import { getItemById } from '../../menu/menu-service';
import type { CartItem } from '../../redis/session-manager';
import { handleMenuQuestion, isMenuQuestion } from './menu-question.helper';
import { handleVisualMenuRequest } from './visual-menu.handler';
import { logger } from '../../utils/logger';

// Palabras clave que relanzan el menú principal (sin LLM)
const MENU_KEYWORDS = ['menú', 'menu', 'inicio', 'start', 'hola', 'hello', 'hi', 'hey'];
const CANCEL_KEYWORDS = ['cancelar', 'cancel'];

export async function handleMainMenu(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;
  const name = session.customerName ?? 'cliente';

  // ── Respuesta a botón interactivo ────────────────────────────────────────
  if (msg.type === 'interactive' && msg.interactiveReply) {
    const { id } = msg.interactiveReply;

    switch (id) {
      case 'menu_browse': {
        const newSession = await updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId });
        await showCategories(phone, newSession);
        return newSession;
      }

      case 'menu_visual':
        return handleVisualMenuRequest(msg, session);

      case 'menu_promos': {
        const [dayPromos, promoDay, activePromos, rate] = await Promise.all([
          getDayPromos(),
          isPromoDay(),
          getActivePromotions(),
          getExchangeRate(),
        ]);
        if (dayPromos.length > 0 && promoDay) {
          await whatsappClient.sendMessage(
            textMessage(
              phone,
              `🔥 *Promos de hoy:*\n\n${formatDayPromos(dayPromos, rate)}\n\n_Escríbeme qué quieres pedir, o elige *Ver Menú* para ver la carta completa 🍽️_`,
            ),
          );
        } else if (activePromos.length > 0) {
          await whatsappClient.sendMessage(
            textMessage(phone, formatPromotionsText(activePromos, rate)),
          );
        } else {
          await whatsappClient.sendMessage(
            textMessage(phone, '🎁 No hay promociones activas hoy. ¡Echa un vistazo a nuestro menú!'),
          );
        }
        await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
        return session;
      }

      case 'menu_human': {
        await whatsappClient.sendMessage(TEMPLATES.humanTransfer(phone));
        // Notificar al admin
        const adminPhone = await getConfig('ADMIN_PHONE');
        if (adminPhone) {
          await whatsappClient.sendMessage(
            textMessage(
              adminPhone,
              `🧑 *${name}* (${phone}) quiere hablar con un humano.\n\nPuedes escribirle directamente a ese número o responderle aquí con /responder.`,
            ),
          );
        }
        return updateSessionState(phone, 'AWAITING_HUMAN', {
          customerId: session.customerId,
          customerName: name,
        });
      }

      case 'menu_cancel':
        if (!session.activeOrderId) {
          await whatsappClient.sendMessage(
            textMessage(phone, '❌ No tienes ningún pedido activo para cancelar.'),
          );
          await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
          return session;
        }
        // Delegar cancelación al handler de órdenes (Paso 6)
        const ns = await updateSessionState(phone, 'ORDER_CONFIRMATION', { customerId: session.customerId, customerName: name });
        await showConfirmationSummary(phone, ns);
        return ns;

      default:
        logger.warn({ id, phone }, 'Unknown button id in MAIN_MENU');
        break;
    }
  }

  // ── Texto libre ──────────────────────────────────────────────────────────
  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase().trim();

    // Cancelar por texto
    if (CANCEL_KEYWORDS.some((kw) => lower.includes(kw)) && session.activeOrderId) {
      return updateSessionState(phone, 'ORDER_CONFIRMATION', {
        customerId: session.customerId,
        customerName: name,
      });
    }

    // Ver carrito
    if (lower.includes('carrito') || lower.includes('ver pedido') || lower.includes('mi pedido')) {
      if (session.cart && session.cart.length > 0) {
        const ns = await updateSessionState(phone, 'BUILDING_ORDER', {
          customerId: session.customerId,
          customerName: name,
          cart: session.cart,
        });
        await showCartSummary(phone, ns);
        return ns;
      }
      await whatsappClient.sendMessage(
        textMessage(phone, '🛒 Tu carrito está vacío. ¡Elige algo del menú!'),
      );
      const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', {
        customerId: session.customerId,
        customerName: name,
      });
      await showCategories(phone, ns);
      return ns;
    }

    // Pregunta sobre el menú → responder sin LLM y quedarse en MAIN_MENU
    if (isMenuQuestion(lower)) {
      const handled = await handleMenuQuestion(msg.text, phone);
      if (handled) return session;
      // handleMenuQuestion devolvió false (sin candidatos) → caer al LLM
    }

    // ── Referencia vaga a promo del día ("quiero esa promo", "dame ese combo", etc.) ──
    const isPromoRef =
      lower.includes('promo') ||
      /\b(quiero|dame|me\s+das?|ponme|tráeme|añade|agrega)\s+(esa|ese|la|el|una|un)\b/.test(lower);

    if (isPromoRef) {
      const [dayPromos, promoDay] = await Promise.all([
        getDayPromos(),
        isPromoDay(),
      ]);
      if (dayPromos.length > 0 && promoDay) {
        if (dayPromos.length === 1) {
          // Una sola promo activa → agregar directo al carrito
          const promo = dayPromos[0]!;
          const menuItem = promo.menuItemId ? await getItemById(promo.menuItemId) : null;
          if (menuItem) {
            const cartItem: CartItem = {
              menuItemId: menuItem.id,
              name: menuItem.name,
              quantity: 1,
              unitPriceUsd: menuItem.priceUsdNum,
            };
            await whatsappClient.sendMessage(
              textMessage(phone, `🔥 ¡Perfecto! Agregué *${promo.name}* a tu carrito.`),
            );
            const newSession = await updateSessionState(phone, 'BUILDING_ORDER', {
              customerId: session.customerId,
              customerName: name,
              cart: [cartItem],
            });
            await showCartSummary(phone, newSession);
            return newSession;
          }
        } else {
          // Múltiples promos → preguntar cuál
          const promoList = dayPromos
            .map((p, i) => `${i + 1}. *${p.name}*${p.priceBs > 0 ? ` — Bs ${p.priceBs.toFixed(2)}` : ''}`)
            .join('\n');
          await whatsappClient.sendMessage(
            textMessage(phone, `¿Cuál de estas promos te llevo? 😊\n\n${promoList}\n\nEscríbeme el nombre o número.`),
          );
          return session;
        }
      }
    }

    // Palabras clave simples → re-mostrar menú ANTES de intentar LLM
    // (evita que "dame menu", "hola menu", etc. lleguen a tryQuickOrder)
    if (MENU_KEYWORDS.some((kw) => lower.includes(kw))) {
      const [dayPromos, promoDay, rate] = await Promise.all([getDayPromos(), isPromoDay(), getExchangeRate()]);
      if (dayPromos.length > 0 && promoDay) {
        await whatsappClient.sendMessage(
          textMessage(
            phone,
            `🔥 *¡Hoy tenemos promos especiales, ${name}!*\n\n${formatDayPromos(dayPromos, rate)}\n\n_Escríbeme qué quieres pedir, o elige *Ver Menú* para ver la carta completa 🍽️_`,
          ),
        );
      }
      await whatsappClient.sendMessage(
        session.activeOrderId
          ? TEMPLATES.mainMenuWithCancel(phone, name)
          : TEMPLATES.mainMenu(phone, name),
      );
      return session;
    }

    // Pedido rápido: si el mensaje tiene suficiente contenido, intentar extraer ítems con LLM
    // Ej: "hola quiero 2 big burger" → saltar menú y armar carrito directo
    if (msg.text.trim().length > 6) {
      const quickResult = await tryQuickOrder(phone, msg.text, session);
      if (quickResult) return quickResult;
    }

    // Primero intentar respuesta contextual con LLM (pregunta sobre el menú, etc.)
    const answered = await trySmartFallback(msg.text, phone, session);
    if (!answered) {
      const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId, customerName: name });
      await showCategories(phone, ns);
      return ns;
    }
    return session;
  }

  // ── Tipos no soportados (imagen, audio) ──────────────────────────────────
  if (msg.type === 'image' || msg.type === 'audio') {
    await whatsappClient.sendMessage(TEMPLATES.unsupportedMedia(phone));
    await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
    return session;
  }

  // Fallback → re-mostrar menú
  await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
  return session;
}

// ─── Pedido rápido desde texto libre ─────────────────────────────────────────
// Intenta extraer ítems del mensaje con LLM. Si encuentra productos del menú,
// arma el carrito directo y va a BUILDING_ORDER. Retorna null si no hay ítems.

async function tryQuickOrder(
  phone: string,
  text: string,
  session: SessionData,
): Promise<SessionData | null> {
  const { toAdd, notFound, intent } = await extractCartFromText(text, session.customerId, session.cart);
  const customerName = session.customerName ?? 'cliente';

  // Intención de despedida / no querer nada
  if (intent === 'QUIT') {
    if (session.activeOrderId) {
      await updateOrderStatus(session.activeOrderId, 'CANCELLED', {
        cancelReason: 'Cancelado por cliente via mensaje',
      }).catch(() => undefined);
    }
    await whatsappClient.sendMessage(
      textMessage(phone, `¡Hasta luego, *${customerName}*! 👋 Cuando quieras pedir, aquí estamos.`),
    );
    return updateSessionState(phone, 'MAIN_MENU', { customerId: session.customerId, cart: [], customerName: session.customerName });
  }

  // Si el LLM detectó ítems para agregar, armar carrito directo
  if (toAdd.length === 0) return null;

  const itemLines = toAdd.map((i) => `• ${i.quantity}x ${i.name}`).join('\n');

  let msg = `¡Hola, *${customerName}*! 👋\n\nAñadí a tu carrito:\n${itemLines}`;
  if (notFound.length > 0) {
    msg += `\n\n❌ No encontrado en el menú: ${notFound.map((n) => `*${n}*`).join(', ')}`;
  }

  await whatsappClient.sendMessage(textMessage(phone, msg));

  const newSession = await updateSessionState(phone, 'BUILDING_ORDER', {
    customerId: session.customerId,
    customerName: session.customerName,
    cart: toAdd,
  });
  await showCartSummary(phone, newSession);

  logger.info({ phone, items: toAdd.length }, 'Quick order from MAIN_MENU text');
  return newSession;
}
