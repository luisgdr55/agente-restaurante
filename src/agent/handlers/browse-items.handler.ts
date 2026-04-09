/**
 * Estado BROWSE_ITEMS — ítems de una categoría.
 *
 * Transiciones:
 *   BROWSE_ITEMS → BROWSE_ITEMS          (añade ítem al carrito, sigue navegando)
 *   BROWSE_ITEMS → BROWSE_CATEGORIES     (botón "Otras categorías")
 *   BROWSE_ITEMS → BUILDING_ORDER        (botón "Ver carrito")
 *   BROWSE_ITEMS → MAIN_MENU             (texto "menú")
 */
import type { IncomingMessage } from '../types';
import type { SessionData, CartItem } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import {
  buttonMessage,
  imageMessage,
  textMessage,
  TEMPLATES,
} from '../../whatsapp/message-builder';
import { getItemById } from '../../menu/menu-service';
import { getExchangeRate, usdToBs } from '../../menu/config-service';
import { showCategories, showItems } from './menu-display';
import { showCartSummary, trySmartFallback } from './building-order.handler';
import { logger } from '../../utils/logger';

const BACK_KEYWORDS = ['atrás', 'atras', 'volver', 'categorías', 'categorias'];
const CART_KEYWORDS = ['carrito', 'cart', 'ver carrito'];
const MENU_KEYWORDS = ['menú', 'menu', 'inicio'];

export async function handleBrowseItems(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;
  const name = session.customerName ?? 'cliente';

  // ── Texto libre ──────────────────────────────────────────────────────────
  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase().trim();

    if (MENU_KEYWORDS.some((kw) => lower.includes(kw))) {
      await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
      return updateSessionState(phone, 'MAIN_MENU', { customerId: session.customerId });
    }

    if (BACK_KEYWORDS.some((kw) => lower.includes(kw))) {
      const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId });
      await showCategories(phone, ns);
      return ns;
    }

    if (lower.includes('vaciar') || lower.includes('limpiar')) {
      if (session.cart.length > 0) {
        await whatsappClient.sendMessage(textMessage(phone, '🗑️ Carrito vaciado.'));
        const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId, cart: [] });
        await showCategories(phone, ns);
        return ns;
      }
      await whatsappClient.sendMessage(textMessage(phone, '🛒 Tu carrito ya está vacío.'));
      if (session.currentCategoryId) await showItems(phone, session.currentCategoryId, session);
      return session;
    }

    if (CART_KEYWORDS.some((kw) => lower.includes(kw))) {
      if (session.cart.length > 0) {
        return updateSessionState(phone, 'BUILDING_ORDER', { customerId: session.customerId });
      }
      await whatsappClient.sendMessage(textMessage(phone, '🛒 Tu carrito está vacío.'));
    }

    // Texto libre genérico → intentar respuesta contextual con LLM primero
    const answered = await trySmartFallback(msg.text, phone, session);
    if (answered) return session;
    // Si LLM no responde → mostrar ítems de la categoría actual
    if (session.currentCategoryId) {
      await showItems(phone, session.currentCategoryId, session);
    }
    return session;
  }

  // ── Botones interactivos ─────────────────────────────────────────────────
  if (msg.type === 'interactive' && msg.interactiveReply) {
    const { id } = msg.interactiveReply;

    // Añadir ítem al carrito
    if (id.startsWith('item:')) {
      const itemId = id.replace('item:', '');
      return handleAddToCart(phone, itemId, 1, session);
    }

    // Añadir uno más del mismo ítem
    if (id.startsWith('item_more:')) {
      const itemId = id.replace('item_more:', '');
      return handleAddToCart(phone, itemId, 1, session);
    }

    // Volver a los ítems de la misma categoría (botón "Seguir eligiendo")
    if (id.startsWith('show_category:')) {
      const categoryId = id.replace('show_category:', '');
      const newSession = await updateSessionState(phone, 'BROWSE_ITEMS', {
        customerId: session.customerId,
        currentCategoryId: categoryId,
        cart: session.cart,
      });
      await showItems(phone, categoryId, newSession);
      return newSession;
    }

    // Navegar a todas las categorías
    if (id === 'back_categories') {
      const newSession = await updateSessionState(phone, 'BROWSE_CATEGORIES', {
        customerId: session.customerId,
        cart: session.cart,
      });
      await showCategories(phone, newSession);
      return newSession;
    }

    // Ver carrito
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

  // ── Mostrar items de la categoría actual ─────────────────────────────────
  if (session.currentCategoryId) {
    await showItems(phone, session.currentCategoryId, session);
  } else {
    return updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId });
  }

  return session;
}

export { showItems } from './menu-display';

// ─── Añadir ítem al carrito ───────────────────────────────────────────────────

async function handleAddToCart(
  phone: string,
  itemId: string,
  quantity: number,
  session: SessionData,
): Promise<SessionData> {
  const item = await getItemById(itemId);

  if (!item) {
    await whatsappClient.sendMessage(
      textMessage(phone, '⚠️ Ese ítem ya no está disponible. Por favor elige otro.'),
    );
    return session;
  }

  // Actualizar carrito en sesión
  const existingIndex = session.cart.findIndex((i) => i.menuItemId === itemId);
  let updatedCart: CartItem[];

  if (existingIndex >= 0) {
    updatedCart = session.cart.map((cartItem, idx) =>
      idx === existingIndex
        ? { ...cartItem, quantity: cartItem.quantity + quantity }
        : cartItem,
    );
  } else {
    const newItem: CartItem = {
      menuItemId: item.id,
      name: item.name,
      quantity,
      unitPriceUsd: item.priceUsdNum,
    };
    updatedCart = [...session.cart, newItem];
  }

  // Si el ítem tiene imagen, enviarla primero
  if (item.imageUrl) {
    await whatsappClient.sendMessage(
      imageMessage(phone, item.imageUrl, `${item.name} — $${item.priceUsdNum.toFixed(2)} | Bs ${item.priceBs.toFixed(2)}`),
    );
  }

  // Mensaje de confirmación + opciones post-agregar
  const rate = await getExchangeRate();
  const totalUnits = updatedCart.reduce((s, i) => s + i.quantity, 0);
  const totalUsd = updatedCart.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0);
  const totalBs = usdToBs(totalUsd, rate);

  await whatsappClient.sendMessage(
    buttonMessage(
      phone,
      `✅ *${item.name}* añadido al carrito!\n\n📦 Carrito: ${totalUnits} item${totalUnits !== 1 ? 's' : ''} · $${totalUsd.toFixed(2)} | Bs ${totalBs.toFixed(2)}`,
      [
        { id: `show_category:${item.categoryId}`, title: '🍽️ Seguir eligiendo' },
        { id: 'back_categories', title: '📋 Menú principal' },
        { id: 'cart_view', title: '🛒 Comprar ahora' },
      ],
    ),
  );

  logger.info(
    { phone, itemId, itemName: item.name, quantity, totalCartItems: totalUnits },
    'Item added to cart',
  );

  // Actualizar sesión con carrito y volver a BROWSE_ITEMS
  const newSession = await updateSessionState(phone, 'BROWSE_ITEMS', {
    customerId: session.customerId,
    currentCategoryId: session.currentCategoryId,
    cart: updatedCart,
  });

  return newSession;
}
