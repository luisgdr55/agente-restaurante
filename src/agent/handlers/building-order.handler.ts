/**
 * Estado BUILDING_ORDER — texto libre + revisión del carrito.
 *
 * AQUÍ SE USA EL LLM (Gemini via OpenRouter) para extraer pedidos de texto libre.
 * Ej: "quiero 2 big burger y una coca" → extrae items + cantidades.
 *
 * Transiciones:
 *   BUILDING_ORDER → BUILDING_ORDER      (ítem añadido, sigue construyendo)
 *   BUILDING_ORDER → ORDER_CONFIRMATION  (confirmar pedido → Paso 6)
 *   BUILDING_ORDER → BROWSE_CATEGORIES   (seguir comprando / vaciar)
 *   BUILDING_ORDER → MAIN_MENU           (cancelar)
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { buttonMessage, textMessage, TEMPLATES } from '../../whatsapp/message-builder';
import { getExchangeRate, usdToBs, getConfig, getConfigs } from '../../menu/config-service';
import { getItemById, getActiveMenuForLlm } from '../../menu/menu-service';
import { listMessage } from '../../whatsapp/message-builder';
import { updateOrderStatus } from '../../orders/order-service';
import { extractCartFromText } from './order-extraction.helper';
import { handleMenuQuestion, isMenuQuestion } from './menu-question.helper';
import { generateFreeResponse } from '../../llm/gemini-client';
import type { RestaurantContext } from '../../llm/gemini-client';
import { showCategories } from './menu-display';
import { showConfirmationSummary } from './order-confirmation.handler';
import { logger } from '../../utils/logger';

export async function handleBuildingOrder(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;
  const name = session.customerName ?? 'cliente';

  if (session.cart.length === 0 && msg.type !== 'text') {
    await whatsappClient.sendMessage(
      textMessage(phone, '🛒 Tu carrito está vacío. ¡Elige algo del menú!'),
    );
    return updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId });
  }

  // ── Botones interactivos ─────────────────────────────────────────────────
  if (msg.type === 'interactive' && msg.interactiveReply) {
    const { id } = msg.interactiveReply;

    switch (id) {
      case 'order_confirm': {
        const ns = await updateSessionState(phone, 'ORDER_CONFIRMATION', { customerId: session.customerId, cart: session.cart });
        await showConfirmationSummary(phone, ns);
        return ns;
      }

      case 'order_continue':
      case 'back_categories': {
        const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', {
          customerId: session.customerId,
          cart: session.cart,
        });
        await showCategories(phone, ns);
        return ns;
      }

      case 'order_clear': {
        await whatsappClient.sendMessage(textMessage(phone, '🗑️ Carrito vaciado.'));
        const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', {
          customerId: session.customerId,
          cart: [],
        });
        await showCategories(phone, ns);
        return ns;
      }

      case 'order_cancel':
        await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
        return updateSessionState(phone, 'MAIN_MENU', {
          customerId: session.customerId,
          cart: [],
        });

      default:
        if (id.startsWith('remove:')) {
          const itemId = id.replace('remove:', '');
          return handleRemoveItem(phone, itemId, session);
        }
        // Selección de ítem desde lista de disambiguación
        if (id.startsWith('item:')) {
          const itemId = id.replace('item:', '');
          const item = await getItemById(itemId);
          if (item) {
            const idx = session.cart.findIndex((c) => c.menuItemId === item.id);
            const updatedCart = [...session.cart];
            if (idx >= 0) {
              updatedCart[idx] = { ...updatedCart[idx]!, quantity: updatedCart[idx]!.quantity + 1 };
            } else {
              updatedCart.push({ menuItemId: item.id, name: item.name, quantity: 1, unitPriceUsd: item.priceUsdNum });
            }
            await whatsappClient.sendMessage(textMessage(phone, `✅ *${item.name}* añadido al carrito.`));
            const ns = await updateSessionState(phone, 'BUILDING_ORDER', { customerId: session.customerId, cart: updatedCart });
            await showCartSummary(phone, ns);
            return ns;
          }
        }
    }
  }

  // ── Texto libre — INVOCAR LLM ────────────────────────────────────────────
  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase().trim();

    // Keywords rápidos sin LLM
    if (lower === 'confirmar' || lower === 'sí' || lower === 'si' || lower === 'ok') {
      if (session.cart.length > 0) {
        const ns = await updateSessionState(phone, 'ORDER_CONFIRMATION', { customerId: session.customerId, cart: session.cart });
        await showConfirmationSummary(phone, ns);
        return ns;
      }
    }

    if (lower.includes('carrito') || lower.includes('resumen') || lower.includes('ver pedido')) {
      if (session.cart.length > 0) {
        await showCartSummary(phone, session);
        return session;
      }
      await whatsappClient.sendMessage(textMessage(phone, '🛒 Tu carrito está vacío.'));
      return updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId });
    }

    if (lower.includes('vaciar') || lower.includes('limpiar')) {
      await whatsappClient.sendMessage(textMessage(phone, '🗑️ Carrito vaciado.'));
      const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId, cart: [] });
      await showCategories(phone, ns);
      return ns;
    }

    if (lower.includes('menú') || lower.includes('menu')) {
      await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
      return updateSessionState(phone, 'MAIN_MENU', { customerId: session.customerId });
    }

    // ¿Es una pregunta sobre el menú? → responder sin LLM y quedarse en BUILDING_ORDER
    if (isMenuQuestion(lower)) {
      await handleMenuQuestion(msg.text, phone);
      return session; // no cambiar estado, el cliente sigue construyendo su pedido
    }

    // Parece un pedido en texto libre → LLM
    return handleFreeTextOrder(msg.text, session);
  }

  // ── Fallback — mostrar carrito ────────────────────────────────────────────
  if (session.cart.length > 0) {
    await showCartSummary(phone, session);
  } else {
    return updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId });
  }

  return session;
}

// ─── Extracción de pedido con LLM ─────────────────────────────────────────────

async function handleFreeTextOrder(
  userText: string,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = session;

  await whatsappClient.sendMessage(textMessage(phone, '⏳ Procesando tu pedido...'));

  const { toAdd, toRemove, notFound, intent, ambiguous } = await extractCartFromText(userText, session.customerId, session.cart);

  logger.info({
    intent,
    toAdd: toAdd.map((i) => ({ name: i.name, id: i.menuItemId })),
    toRemove: toRemove.map((i) => ({ name: i.name, id: i.menuItemId })),
    notFound,
    cartBefore: session.cart.map((i) => ({ name: i.name, id: i.menuItemId })),
  }, 'MODIFY_INTENT');

  // ── Fallback upgrade a combo ─────────────────────────────────────────────
  // Si el LLM no detectó MODIFY pero el cliente pidió refresco/coca/papas
  // y hay exactamente una hamburguesa SOLA en el carrito → ejecutar upgrade
  // directamente sin preguntar (intención clara).
  const UPGRADE_TRIGGERS = ['coca', 'pepsi', 'refresco', 'papas', 'combo', 'todo'];
  const clientAskedUpgrade = notFound.some((n) =>
    UPGRADE_TRIGGERS.some((t) => n.toLowerCase().includes(t)),
  );
  if (clientAskedUpgrade && toAdd.length === 0 && toRemove.length === 0) {
    const soloInCart = session.cart.filter((i) => !i.name.includes('+ Papas y Refresco'));
    if (soloInCart.length === 1 && session.cart.length === 1) {
      const hamburguesa = soloInCart[0]!;
      const baseName = hamburguesa.name.replace(/\s*\(Sola\)\s*$/i, '').trim();
      const targetName = `${baseName} + Papas y Refresco`;
      const menu = await getActiveMenuForLlm();
      const comboItem = menu.flatMap((c) => c.items).find((i) => i.name === targetName);
      if (comboItem) {
        logger.info({ from: hamburguesa.name, to: comboItem.name }, 'Upgrade a combo aplicado por código');
        const updatedCart = [{ menuItemId: comboItem.id, name: comboItem.name, quantity: 1, unitPriceUsd: comboItem.priceUsdNum }];
        await whatsappClient.sendMessage(
          textMessage(phone, `¡Listo! Te cambié *${hamburguesa.name}* por *${comboItem.name}* 😊`),
        );
        const ns = await updateSessionState(phone, 'BUILDING_ORDER', { customerId: session.customerId, cart: updatedCart });
        await showCartSummary(phone, ns);
        return ns;
      }
    }
  }

  // ── Bebida pedida cuando el carrito ya tiene combo ───────────────────────
  // Si hay notFound con bebida y el carrito ya incluye un combo, informar
  // honestamente sin pasar al LLM (que podría alucinar).
  const DRINK_TRIGGERS = ['coca', 'pepsi', 'refresco', 'bebida', 'cola'];
  const clientAskedDrink = notFound.some((n) =>
    DRINK_TRIGGERS.some((t) => n.toLowerCase().includes(t)),
  );
  const cartHasCombo = session.cart.some((i) => i.name.includes('+ Papas y Refresco'));
  if (clientAskedDrink && cartHasCombo && toAdd.length === 0 && toRemove.length === 0) {
    await whatsappClient.sendMessage(
      textMessage(phone, '🥤 Tu combo ya incluye refresco y papas 😊\n\n¿Quieres agregar algo más al pedido?'),
    );
    return updateSessionState(phone, 'BUILDING_ORDER', { customerId: session.customerId, cart: session.cart });
  }

  // ── Ambigüedad: mostrar opciones al usuario ──────────────────────────────
  if (ambiguous.length > 0 && toAdd.length === 0 && toRemove.length === 0) {
    const rate = await getExchangeRate();
    for (const amb of ambiguous) {
      if (amb.candidates.length === 0) continue;
      const rows = amb.candidates.slice(0, 10).map((c) => ({
        id: `item:${c.menuItemId}`,
        title: c.name,
        description: `$${c.priceUsdNum.toFixed(2)} | Bs ${usdToBs(c.priceUsdNum, rate).toFixed(2)}`,
      }));
      await whatsappClient.sendMessage(
        listMessage(
          phone,
          `¿Cuál *${amb.userText}* deseas agregar? 👇`,
          'Ver opciones',
          [{ title: 'Disponibles', rows }],
        ),
      );
    }
    return updateSessionState(phone, 'BUILDING_ORDER', { customerId: session.customerId, cart: session.cart });
  }

  // ── MODIFY sin ítems válidos → tratar como OTHER
  if (intent === 'MODIFY' && toAdd.length === 0 && toRemove.length === 0) {
    const llmAnswered = await trySmartFallback(userText, phone, session);
    if (!llmAnswered) {
      await whatsappClient.sendMessage(
        buttonMessage(phone, '🤔 No entendí bien qué querías cambiar. ¿Me lo explicas de otra forma?',
          [{ id: 'cart_view', title: '🛒 Ver mi carrito' }, { id: 'back_categories', title: '🍽️ Ver el menú' }]),
      );
    }
    return updateSessionState(phone, 'BUILDING_ORDER', { customerId: session.customerId, cart: session.cart });
  }

  // ── Manejar por intención cuando no hay ítems ────────────────────────────
  if (toAdd.length === 0 && toRemove.length === 0 && notFound.length === 0) {
    if (intent === 'QUIT') {
      await whatsappClient.sendMessage(
        textMessage(phone, `¡Hasta luego, *${session.customerName ?? 'cliente'}*! 👋 Cuando quieras pedir, aquí estamos.`),
      );
      await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, session.customerName ?? 'cliente'));
      return updateSessionState(phone, 'MAIN_MENU', { customerId: session.customerId, cart: [], customerName: session.customerName });
    }
    if (intent === 'CANCEL') {
      if (session.activeOrderId) {
        await updateOrderStatus(session.activeOrderId, 'CANCELLED', {
          cancelReason: 'Cancelado por cliente via mensaje',
        }).catch(() => undefined);
      }
      await whatsappClient.sendMessage(
        textMessage(phone, '❌ Pedido cancelado. ¡Cuando quieras volver a pedir, aquí estamos!'),
      );
      await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, session.customerName ?? 'cliente'));
      return updateSessionState(phone, 'MAIN_MENU', { customerId: session.customerId, cart: [], customerName: session.customerName });
    }
    if (intent === 'CONFIRM' && session.cart.length > 0) {
      const ns = await updateSessionState(phone, 'ORDER_CONFIRMATION', { customerId: session.customerId, cart: session.cart });
      await showConfirmationSummary(phone, ns);
      return ns;
    }
    if (intent === 'BROWSE') {
      const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', { customerId: session.customerId, cart: session.cart });
      await showCategories(phone, ns);
      return ns;
    }
    if (intent === 'CART') {
      await showCartSummary(phone, session);
      return session;
    }
    // Ningún ítem y ninguna intención clara — intentar respuesta contextual con LLM
    {
      const llmAnswered = await trySmartFallback(userText, phone, session);
      if (!llmAnswered) {
        await whatsappClient.sendMessage(
          buttonMessage(
            phone,
            '🤔 No encontré ese producto en el menú.\n\nPuedes escribir el nombre exacto, buscar en el menú o decirme "cancelar" para empezar de nuevo.',
            [
              { id: 'back_categories', title: '🍽️ Ver el menú' },
              { id: 'cart_view',       title: '🛒 Ver mi carrito' },
              { id: 'cancel_order',    title: '❌ Cancelar' },
            ],
          ),
        );
      }
      return updateSessionState(phone, 'BUILDING_ORDER', {
        customerId: session.customerId,
        cart: session.cart,
      });
    }
  }

  let updatedCart = [...session.cart];

  // ── Agregar ítems ────────────────────────────────────────────────────────
  for (const item of toAdd) {
    const idx = updatedCart.findIndex((c) => c.menuItemId === item.menuItemId);
    if (idx >= 0) {
      updatedCart[idx] = { ...updatedCart[idx]!, quantity: updatedCart[idx]!.quantity + item.quantity };
    } else {
      updatedCart.push(item);
    }
  }

  // ── Quitar ítems ─────────────────────────────────────────────────────────
  const removedNames: string[] = [];
  for (const item of toRemove) {
    const idx = updatedCart.findIndex((c) => c.menuItemId === item.menuItemId);
    if (idx >= 0) {
      const newQty = updatedCart[idx]!.quantity - item.quantity;
      if (newQty <= 0) {
        removedNames.push(updatedCart[idx]!.name);
        updatedCart.splice(idx, 1);
      } else {
        updatedCart[idx] = { ...updatedCart[idx]!, quantity: newQty };
        removedNames.push(updatedCart[idx]!.name);
      }
    } else {
      // El ítem existe en el menú pero no está en el carrito
      removedNames.push(item.name);
    }
  }

  // ── Construir mensaje de respuesta ───────────────────────────────────────
  if (intent === 'MODIFY' && (toAdd.length > 0 || removedNames.length > 0)) {
    // Mensaje natural venezolano para modificaciones
    const removedStr = removedNames.map((n) => `*${n}*`).join(', ');
    const addedStr = toAdd.map((i) => `*${i.name}*`).join(', ');

    let modifyMsg: string;
    if (removedNames.length > 0 && toAdd.length > 0) {
      modifyMsg = `¡Listo! Te cambié ${removedStr} por ${addedStr} 😊`;
    } else if (removedNames.length > 0) {
      modifyMsg = `¡Listo! Quité ${removedStr} de tu pedido 👌`;
    } else {
      modifyMsg = `¡Agregado! ${addedStr} va en tu pedido 🎉`;
    }
    await whatsappClient.sendMessage(textMessage(phone, modifyMsg));
  } else {
    const feedbackLines: string[] = [];

    if (toAdd.length > 0) {
      const added = toAdd.map((i) => `*${i.name}* x${i.quantity}`).join(', ');
      feedbackLines.push(`✅ Agregado: ${added}`);
    }

    if (removedNames.length > 0) {
      feedbackLines.push(`🗑️ Quitado: ${removedNames.map((n) => `*${n}*`).join(', ')}`);
    }

    if (notFound.length > 0) {
      const list = notFound.map((n) => `*${n}*`).join(', ');
      feedbackLines.push(`❌ No encontrado en el menú: ${list}`);
    }

    if (feedbackLines.length > 0) {
      await whatsappClient.sendMessage(textMessage(phone, feedbackLines.join('\n')));
    }
  }

  logger.info(
    { phone, added: toAdd.length, removed: toRemove.length, notFound: notFound.length },
    'Order text processed',
  );

  // Carrito vacío después de quitar
  if (updatedCart.length === 0) {
    await whatsappClient.sendMessage(textMessage(phone, '🛒 Tu carrito quedó vacío.'));
    const ns = await updateSessionState(phone, 'BROWSE_CATEGORIES', {
      customerId: session.customerId,
      cart: [],
    });
    await showCategories(phone, ns);
    return ns;
  }

  const newSession = await updateSessionState(phone, 'BUILDING_ORDER', {
    customerId: session.customerId,
    cart: updatedCart,
  });
  await showCartSummary(phone, newSession);
  return newSession;
}

// ─── Respuesta inteligente para intent OTHER ──────────────────────────────────

/**
 * Intenta responder un mensaje no reconocido usando el LLM con contexto
 * completo del restaurante (horario, delivery, pedido mínimo).
 *
 * @returns true si el LLM generó una respuesta y fue enviada al cliente;
 *          false si falló o no tenía información suficiente.
 */
export async function trySmartFallback(
  userText: string,
  phone: string,
  session: SessionData,
): Promise<boolean> {
  try {
    const [cfg, menu] = await Promise.all([
      getConfigs(['RESTAURANT_NAME', 'RESTAURANT_HOURS', 'DELIVERY_FEE_USD', 'MIN_ORDER_USD']),
      getActiveMenuForLlm(),
    ]);

    const restaurantCtx: RestaurantContext = {
      restaurantName: cfg.RESTAURANT_NAME ?? 'el restaurante',
      ...(cfg.RESTAURANT_HOURS  && { hours:          cfg.RESTAURANT_HOURS }),
      ...(cfg.DELIVERY_FEE_USD  && { deliveryFeeUsd: parseFloat(cfg.DELIVERY_FEE_USD) }),
      ...(cfg.MIN_ORDER_USD     && { minOrderUsd:    parseFloat(cfg.MIN_ORDER_USD) }),
    };

    const cartSummary = session.cart.length > 0
      ? session.cart.map((i) => `${i.quantity}x ${i.name}`).join(', ')
      : undefined;

    const convCtx = {
      customerName:   session.customerName ?? 'cliente',
      userMessage:    userText,
      restaurantName: restaurantCtx.restaurantName,
      ...(cartSummary && { currentCartSummary: cartSummary }),
    };

    const reply = await generateFreeResponse(
      convCtx,
      session.customerId ? { customerId: session.customerId } : undefined,
      restaurantCtx,
      menu,
    );

    if (!reply) return false;

    // Enviar respuesta del LLM + botones sutiles de contexto
    await whatsappClient.sendMessage(textMessage(phone, reply));
    await whatsappClient.sendMessage(
      buttonMessage(
        phone,
        '¿Qué deseas hacer?',
        [
          { id: 'back_categories', title: '🍽️ Ver el menú' },
          { id: 'cart_view',       title: '🛒 Ver mi carrito' },
        ],
      ),
    );

    return true;
  } catch {
    return false;
  }
}

// ─── Mostrar carrito ──────────────────────────────────────────────────────────

export async function showCartSummary(phone: string, session: SessionData): Promise<void> {
  const rate = await getExchangeRate();
  const deliveryFeeUsd = parseFloat((await getConfig('DELIVERY_FEE_USD')) ?? '1.50');
  const minOrderUsd = parseFloat((await getConfig('MIN_ORDER_USD')) ?? '3.00');

  const subtotalUsd = session.cart.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0);
  const subtotalBs = usdToBs(subtotalUsd, rate);

  if (subtotalUsd < minOrderUsd) {
    const minBs = usdToBs(minOrderUsd, rate);
    await whatsappClient.sendMessage(
      textMessage(
        phone,
        `⚠️ El pedido mínimo es *$${minOrderUsd.toFixed(2)} | Bs ${minBs.toFixed(2)}*.\nAgrega algo más a tu pedido 😊`,
      ),
    );
  }

  const itemLines = session.cart
    .map((i) => {
      const subtotalItemUsd = i.quantity * i.unitPriceUsd;
      const subtotalItemBs = usdToBs(subtotalItemUsd, rate);
      return `• ${i.quantity}x *${i.name}* — $${subtotalItemUsd.toFixed(2)} | Bs ${subtotalItemBs.toFixed(2)}`;
    })
    .join('\n');

  const body =
    `🛒 *Tu pedido:*\n\n${itemLines}\n\n` +
    `💰 *Subtotal: $${subtotalUsd.toFixed(2)} | Bs ${subtotalBs.toFixed(2)}*\n` +
    `🛵 Delivery: $${deliveryFeeUsd.toFixed(2)} | Bs ${usdToBs(deliveryFeeUsd, rate).toFixed(2)} _(si aplica)_`;

  await whatsappClient.sendMessage(
    buttonMessage(
      phone,
      body,
      [
        { id: 'order_confirm', title: '✅ Confirmar pedido' },
        { id: 'order_continue', title: '🛍️ Seguir comprando' },
        { id: 'order_clear', title: '🗑️ Vaciar carrito' },
      ],
      { footer: 'Escribe tu pedido o usa los botones' },
    ),
  );
}

// ─── Quitar ítem del carrito ──────────────────────────────────────────────────

async function handleRemoveItem(
  phone: string,
  itemId: string,
  session: SessionData,
): Promise<SessionData> {
  const updatedCart = session.cart.filter((i) => i.menuItemId !== itemId);
  const removed = session.cart.find((i) => i.menuItemId === itemId);

  await whatsappClient.sendMessage(
    textMessage(phone, `🗑️ *${removed?.name ?? 'Ítem'}* eliminado del carrito.`),
  );

  if (updatedCart.length === 0) {
    await whatsappClient.sendMessage(textMessage(phone, '🛒 Tu carrito está vacío.'));
    return updateSessionState(phone, 'BROWSE_CATEGORIES', {
      customerId: session.customerId,
      cart: [],
    });
  }

  const newSession = await updateSessionState(phone, 'BUILDING_ORDER', {
    customerId: session.customerId,
    cart: updatedCart,
  });
  await showCartSummary(phone, newSession);
  return newSession;
}
