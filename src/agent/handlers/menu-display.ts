/**
 * Funciones de display del menú — separadas para evitar dependencias circulares
 * entre browse-categories.handler y browse-items.handler.
 */
import type { SessionData } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { listMessage, textMessage } from '../../whatsapp/message-builder';
import { getActiveCategories, getItemsByCategory } from '../../menu/menu-service';
import { getExchangeRate, usdToBs } from '../../menu/config-service';
import { isPromoDay } from '../../menu/promo-day-service';

export const PROMO_CATEGORY_NAME = 'PROMO DÍA';

export async function showCategories(phone: string, session: SessionData): Promise<void> {
  const [allCategories, promoDay] = await Promise.all([getActiveCategories(), isPromoDay()]);
  // Hide PROMO DÍA category when today is not a promo day
  const categories = promoDay
    ? allCategories
    : allCategories.filter((c) => c.name !== PROMO_CATEGORY_NAME);

  if (categories.length === 0) {
    await whatsappClient.sendMessage(
      textMessage(phone, '😔 El menú está siendo actualizado. Intenta más tarde.'),
    );
    return;
  }

  const rows = categories.map((cat) => ({
    id: `cat:${cat.id}`,
    title: `${cat.emoji} ${cat.name}`,
  }));

  if (session.cart.length > 0) {
    const cartTotal = session.cart.reduce((sum, i) => sum + i.quantity, 0);
    rows.push({ id: 'cart_view', title: `🛒 Ver carrito (${cartTotal} items)` });
    rows.push({ id: 'cancel_order', title: '❌ Cancelar pedido' });
  }

  await whatsappClient.sendMessage(
    listMessage(
      phone,
      '🍽️ ¿Qué vas a pedir hoy?\n\nElige una categoría:',
      'Ver categorías',
      [{ title: 'Menú', rows }],
      { footer: 'Desliza para ver todas las opciones' },
    ),
  );
}

export async function showItems(
  phone: string,
  categoryId: string,
  session: SessionData,
): Promise<void> {
  const items = await getItemsByCategory(categoryId);

  if (items.length === 0) {
    await whatsappClient.sendMessage(
      textMessage(phone, '😔 No hay ítems disponibles en esta categoría por el momento.'),
    );
    return;
  }

  const productRows = items.map((item) => ({
    id: `item:${item.id}`,
    title: item.name,
    description: `$${item.priceUsdNum.toFixed(2)} | Bs ${item.priceBs.toFixed(2)}${item.description ? ` · ${item.description.slice(0, 40)}` : ''}`,
  }));

  // WhatsApp list message: max 10 rows total across all sections
  const MAX_ROWS = 10;
  const cartRows: Array<{ id: string; title: string; description: string }> = [];

  if (session.cart.length > 0) {
    const rate = await getExchangeRate();
    const cartCount = session.cart.reduce((s, i) => s + i.quantity, 0);
    const cartTotalUsd = session.cart.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0);
    const cartTotalBs = usdToBs(cartTotalUsd, rate);
    cartRows.push({
      id: 'cart_view',
      title: `🛒 Ver carrito (${cartCount} items)`,
      description: `Total: $${cartTotalUsd.toFixed(2)} | Bs ${cartTotalBs.toFixed(2)}`,
    });
    cartRows.push({
      id: 'cancel_order',
      title: '❌ Cancelar pedido',
      description: 'Anular y volver al menú principal',
    });
  }

  const maxProductRows = MAX_ROWS - cartRows.length;
  const visibleProducts = productRows.slice(0, maxProductRows);
  const hiddenCount = productRows.length - visibleProducts.length;
  const allRows = [...visibleProducts, ...cartRows];

  const body = hiddenCount > 0
    ? `👇 (mostrando ${visibleProducts.length} de ${productRows.length})\n_+${hiddenCount} más — escribe el nombre del que quieras_ 😊`
    : '👇 Selecciona un ítem para añadirlo a tu pedido:';

  await whatsappClient.sendMessage(
    listMessage(
      phone,
      body,
      'Ver ítems',
      [{ title: 'Disponibles', rows: allRows }],
      { footer: 'Escribe "atrás" para cambiar de categoría' },
    ),
  );
}
