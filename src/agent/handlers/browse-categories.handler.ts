/**
 * Estado BROWSE_CATEGORIES — lista de categorías del menú.
 *
 * Transiciones:
 *   BROWSE_CATEGORIES → BROWSE_ITEMS      (selecciona categoría)
 *   BROWSE_CATEGORIES → BUILDING_ORDER    (texto "carrito" o botón carrito)
 *   BROWSE_CATEGORIES → MAIN_MENU         (texto "menú" / "inicio")
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage, TEMPLATES } from '../../whatsapp/message-builder';
import { showCategories, showItems, PROMO_CATEGORY_NAME } from './menu-display';
import { showCartSummary, trySmartFallback } from './building-order.handler';
import { handleMenuQuestion, isMenuQuestion } from './menu-question.helper';
import { getActiveCategories } from '../../menu/menu-service';
import { isPromoDay } from '../../menu/promo-day-service';

export { showCategories } from './menu-display';

const BACK_TO_MENU_KEYWORDS = ['menú', 'menu', 'inicio', 'volver', 'atrás'];
const CART_KEYWORDS = ['carrito', 'cart', 'pedido', 'ver pedido'];

export async function handleBrowseCategories(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;
  const name = session.customerName ?? 'cliente';

  // ── Texto libre ──────────────────────────────────────────────────────────
  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase().trim();

    if (BACK_TO_MENU_KEYWORDS.some((kw) => lower.includes(kw))) {
      await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
      return updateSessionState(phone, 'MAIN_MENU', { customerId: session.customerId });
    }

    if (lower.includes('vaciar') || lower.includes('limpiar')) {
      if (session.cart.length > 0) {
        await whatsappClient.sendMessage(textMessage(phone, '🗑️ Carrito vaciado.'));
        const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId, cart: [] });
        await showCategories(phone, ns);
        return ns;
      }
      await whatsappClient.sendMessage(textMessage(phone, '🛒 Tu carrito ya está vacío.'));
      await showCategories(phone, session);
      return session;
    }

    if (CART_KEYWORDS.some((kw) => lower.includes(kw))) {
      if (session.cart.length === 0) {
        await whatsappClient.sendMessage(textMessage(phone, '🛒 Tu carrito está vacío. ¡Elige algo del menú!'));
      } else {
        const ns = await updateSessionState(phone, 'BUILDING_ORDER', { customerId: session.customerId, cart: session.cart });
        await showCartSummary(phone, ns);
        return ns;
      }
    }

    // Pregunta sobre el menú → responder sin LLM
    if (isMenuQuestion(lower)) {
      const handled = await handleMenuQuestion(msg.text, phone);
      if (handled) return session;
      // handleMenuQuestion devolvió false (sin candidatos) → caer al LLM
    }
    // Texto libre no reconocido → trySmartFallback con menú completo
    const answered = await trySmartFallback(msg.text, phone, session);
    if (answered) return session;
    // Si LLM falla → mostrar categorías como fallback
  }

  // ── Selección de categoría (interactive list_reply) ──────────────────────
  if (msg.type === 'interactive' && msg.interactiveReply) {
    const { id } = msg.interactiveReply;

    if (id.startsWith('cat:')) {
      const categoryId = id.replace('cat:', '');

      // Guard: if this is the PROMO DÍA category and today is not a promo day, block access
      const [allCats, promoDay] = await Promise.all([getActiveCategories(), isPromoDay()]);
      const selectedCat = allCats.find((c) => c.id === categoryId);
      if (selectedCat?.name === PROMO_CATEGORY_NAME && !promoDay) {
        await whatsappClient.sendMessage(
          textMessage(phone, '❌ Las promos del día no están disponibles hoy. ¡Echa un vistazo a nuestro menú regular!'),
        );
        await showCategories(phone, session);
        return session;
      }

      const newSession = await updateSessionState(phone, 'BROWSE_ITEMS', {
        customerId: session.customerId,
        currentCategoryId: categoryId,
        cart: session.cart,
      });
      await showItems(phone, categoryId, newSession);
      return newSession;
    }

    if (id === 'cart_view') {
      if (session.cart.length === 0) {
        await whatsappClient.sendMessage(textMessage(phone, '🛒 Tu carrito está vacío.'));
      } else {
        const newSession = await updateSessionState(phone, 'BUILDING_ORDER', { customerId: session.customerId, cart: session.cart });
        await showCartSummary(phone, newSession);
        return newSession;
      }
    }
  }

  // ── Mostrar lista de categorías ──────────────────────────────────────────
  await showCategories(phone, session);
  return session;
}
