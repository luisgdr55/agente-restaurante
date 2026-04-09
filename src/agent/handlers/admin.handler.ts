/**
 * Handler para el admin — estado ADMIN_MODE.
 *
 * Botones interactivos (button_reply desde mensajes del sistema):
 *   confirm_payment:<orderId>  → pago confirmado → cliente a ORDER_IN_KITCHEN
 *   reject_payment:<orderId>   → pago rechazado  → cliente a AWAITING_PAYMENT_PROOF
 *   order_ready:<orderId>      → pedido listo    → notificar cliente, enviar botón entregado
 *   order_delivered:<orderId>  → pedido entregado → finalizar stats
 *
 * Comandos de texto:
 *   /help                    — Lista de comandos
 *   /tasa <valor>            — Actualizar tasa USD→Bs
 *   /activar                 — Abrir restaurante
 *   /desactivar              — Cerrar restaurante
 *   /delivery on|off         — Activar/desactivar delivery
 *   /listo <número>          — Marcar pedido como listo (ej. /listo 1 o /listo 0001)
 *   /entregado <número>      — Marcar pedido como entregado
 *   /pedidos                 — Ver pedidos activos
 *   /precio <nombre> <usd>   — Actualizar precio de un ítem del menú
 *   /menu                    — Ver ítems del menú con precios
 *   /stats                   — Estadísticas del día
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { getSession, updateSessionState, setBotEnabled } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage, buttonMessage, imageMessage, TEMPLATES } from '../../whatsapp/message-builder';
import { getMenuImages, addMenuImage, clearMenuImages } from '../../menu/menu-images-service';
import {
  getDayPromos,
  addDayPromo,
  removeDayPromo,
  clearDayPromos,
  getPromoDays,
  setPromoDays,
  formatDayPromos,
  DAY_NAMES_FULL,
} from '../../menu/promo-day-service';
import {
  updateOrderStatus,
  getOrderById,
  getOrderWithItems,
  buildCartSummary,
  friendlyOrderId,
  findOrderByShortId,
} from '../../orders/order-service';
import { triggerOrderDelivered } from './order-delivered.helper';
import { finalizeCustomerStats } from '../../customers/customer-stats';
import {
  setConfig,
  getConfig,
  getExchangeRate,
  usdToBs,
  invalidateMenuCache,
  activateBusiness,
  deactivateBusiness,
  clearManualOverride,
  setSchedule,
  getScheduleStatus,
} from '../../menu/config-service';
import { getActivePromotions } from '../../promotions/promotions-service';
import { logger } from '../../utils/logger';
import { prisma } from '../../db/prisma';
import { emitOrderUpdated } from '../../websocket/socket-server';

export async function handleAdminMode(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  // ── Respuesta a botón de notificación ─────────────────────────────────────
  if (msg.type === 'interactive' && msg.interactiveReply) {
    const { id } = msg.interactiveReply;

    if (id.startsWith('confirm_payment:')) {
      return handleConfirmPayment(phone, session, id.replace('confirm_payment:', ''));
    }
    if (id.startsWith('reject_payment:')) {
      return handleRejectPayment(phone, session, id.replace('reject_payment:', ''));
    }
    if (id.startsWith('order_in_kitchen:')) {
      const order = await getOrderById(id.replace('order_in_kitchen:', ''));
      if (!order) {
        await whatsappClient.sendMessage(textMessage(phone, '❌ Pedido no encontrado.'));
        return session;
      }
      await updateOrderStatus(order.id, 'IN_KITCHEN');
      const fId = friendlyOrderId(order.orderNumber);
      const customerName = order.customer?.name ?? 'Cliente';
      await whatsappClient.sendMessage(
        textMessage(phone, `🍳 Pedido *#${fId} — ${customerName}* enviado a cocina.\n\nLa cocina lo marcará listo cuando esté preparado.`),
      );
      return session;
    }
    if (id.startsWith('order_ready:')) {
      const order = await getOrderById(id.replace('order_ready:', ''));
      if (!order) {
        await whatsappClient.sendMessage(textMessage(phone, '❌ Pedido no encontrado.'));
        return session;
      }
      return doMarkOrderReady(phone, session, order);
    }
    if (id.startsWith('order_delivered:')) {
      const order = await getOrderById(id.replace('order_delivered:', ''));
      if (!order) {
        await whatsappClient.sendMessage(textMessage(phone, '❌ Pedido no encontrado.'));
        return session;
      }
      return doMarkOrderDelivered(phone, session, order);
    }

    if (id.startsWith('release_customer:')) {
      const clientPhone = id.replace('release_customer:', '');
      await updateSessionState(clientPhone, 'MAIN_MENU', {});
      await whatsappClient.sendMessage(
        textMessage(clientPhone, '✅ Ya puedes continuar con tu pedido 😊'),
      );
      await whatsappClient.sendMessage(
        textMessage(phone, `✅ *${clientPhone}* devuelto al bot.`),
      );
      return session;
    }
    // ir_al_chat: — sin acción del bot, el admin abre el chat manualmente
  }

  // ── Comandos de texto ─────────────────────────────────────────────────────
  if (msg.type === 'text' && msg.text) {
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    // /help
    if (lower === '/help' || lower === 'help') {
      return sendHelp(phone, session);
    }

    // /tasa <valor>
    const tasaMatch = text.match(/^\/tasa\s+(\d+(?:[.,]\d+)?)$/i);
    if (tasaMatch) {
      return handleUpdateRate(phone, session, tasaMatch[1]);
    }

    // /activar [Xh] — activa ahora, opcionalmente por X horas
    const activarMatch = text.match(/^\/activar(?:\s+(\d+)h)?$/i);
    if (activarMatch) {
      const hours = activarMatch[1] ? parseInt(activarMatch[1], 10) : undefined;
      await activateBusiness(hours);
      if (hours) {
        await whatsappClient.sendMessage(
          textMessage(
            phone,
            `✅ Restaurante *activado por ${hours}h*.\n\nSe cerrará automáticamente cuando expire el tiempo.\nUsa */activar* sin horas para dejarlo abierto indefinidamente.`,
          ),
        );
      } else {
        await whatsappClient.sendMessage(
          textMessage(phone, '✅ Restaurante *activado* manualmente.'),
        );
      }
      return session;
    }

    // /desactivar — cierre manual (anula el horario automático)
    if (lower === '/desactivar') {
      await deactivateBusiness();
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          '🔴 Restaurante *desactivado*.\n\nEl horario automático queda suspendido hasta que uses */activar*.',
        ),
      );
      return session;
    }

    // /horario — ver estado o configurar horario automático
    const horarioVerMatch = lower === '/horario' || lower === '/horario ver';
    if (horarioVerMatch) {
      const status = await getScheduleStatus();
      await whatsappClient.sendMessage(
        textMessage(phone, `🕐 *Estado del horario:*\n\n${status}\n\n_Comandos:_\n*/horario 10:00 22:00* — configurar\n*/horario on|off* — activar/desactivar auto\n*/activar 2h* — abrir por 2 horas`),
      );
      return session;
    }

    // /horario on|off — activar/desactivar horario automático
    const horarioToggle = text.match(/^\/horario\s+(on|off)$/i);
    if (horarioToggle) {
      const enabling = horarioToggle[1].toLowerCase() === 'on';
      await setConfig('SCHEDULE_ENABLED', enabling ? 'true' : 'false');
      if (enabling) {
        await clearManualOverride(); // El schedule toma el control
      }
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          enabling
            ? '✅ Horario automático *activado*. El bot abrirá y cerrará según el horario configurado.'
            : '🔴 Horario automático *desactivado*. Usa */activar* y */desactivar* para controlar manualmente.',
        ),
      );
      return session;
    }

    // /horario HH:MM HH:MM [días] — configurar apertura/cierre
    // Ejemplo: /horario 10:00 22:00  o  /horario 10:00 22:00 lun-sab
    const horarioSetMatch = text.match(/^\/horario\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})(?:\s+(.+))?$/i);
    if (horarioSetMatch) {
      const openTime  = horarioSetMatch[1];
      const closeTime = horarioSetMatch[2];
      const daysStr   = horarioSetMatch[3]?.trim().toLowerCase();

      const DAY_MAP: Record<string, number> = {
        dom: 0, sun: 0,
        lun: 1, mon: 1,
        mar: 2, tue: 2,
        mie: 3, mié: 3, wed: 3,
        jue: 4, thu: 4,
        vie: 5, fri: 5,
        sab: 6, sáb: 6, sat: 6,
      };

      let days: number[] | undefined;
      if (daysStr) {
        // Soporta: "lun-vie" (rango) o "lun,mie,vie" (lista) o "todos"
        if (daysStr === 'todos' || daysStr === 'all') {
          days = [0, 1, 2, 3, 4, 5, 6];
        } else if (daysStr.includes('-')) {
          const [fromStr, toStr] = daysStr.split('-');
          const from = DAY_MAP[fromStr?.trim() ?? ''];
          const to   = DAY_MAP[toStr?.trim() ?? ''];
          if (from !== undefined && to !== undefined) {
            days = [];
            for (let d = from; d <= to; d++) days.push(d);
          }
        } else {
          const parts = daysStr.split(',').map((s) => s.trim());
          days = parts.map((p) => DAY_MAP[p]).filter((d): d is number => d !== undefined);
        }
      }

      await setSchedule(openTime, closeTime, days);
      // Activar el schedule automáticamente al configurarlo
      await setConfig('SCHEDULE_ENABLED', 'true');
      await clearManualOverride();

      const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      const daysText = days ? days.map((d) => DAY_NAMES[d]).join(', ') : 'Lun-Sáb (sin cambios)';
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          `✅ *Horario configurado y activado:*\n\n🕐 Apertura: *${openTime}*\n🕐 Cierre: *${closeTime}*\n📅 Días: *${daysText}*\n\n_Hora en Venezuela (UTC-4). El bot abrirá y cerrará automáticamente._`,
        ),
      );
      return session;
    }

    // /bot on|off — modo manual (desactiva/activa el bot completamente)
    if (lower === '/bot on') {
      await setBotEnabled(true);
      await whatsappClient.sendMessage(
        textMessage(phone, '🤖 Bot *activado*. Atendiendo clientes automáticamente.'),
      );
      return session;
    }
    if (lower === '/bot off') {
      await setBotEnabled(false);
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          '🔕 Bot *desactivado*. Los mensajes de clientes serán reenviados a ti.\n\nEscribe */bot on* para reactivarlo.',
        ),
      );
      return session;
    }

    // /delivery on|off
    if (lower === '/delivery on') {
      await setConfig('DELIVERY_AVAILABLE', 'true');
      await whatsappClient.sendMessage(textMessage(phone, '🛵 Delivery *activado*.'));
      return session;
    }
    if (lower === '/delivery off') {
      await setConfig('DELIVERY_AVAILABLE', 'false');
      await whatsappClient.sendMessage(textMessage(phone, '🔴 Delivery *desactivado*.'));
      return session;
    }

    // /listo <número o shortId>
    const listoMatch = text.match(/^\/listo\s+(\S+)$/i);
    if (listoMatch) {
      return handleOrderReadyByRef(phone, session, listoMatch[1]);
    }

    // /entregado <número o shortId>
    const entregadoMatch = text.match(/^\/entregado\s+(\S+)$/i);
    if (entregadoMatch) {
      return handleOrderDeliveredByRef(phone, session, entregadoMatch[1]);
    }

    // /precio <nombre o id> <precio_usd>
    const precioMatch = text.match(/^\/precio\s+(.+?)\s+(\d+(?:[.,]\d+)?)$/i);
    if (precioMatch) {
      return handleUpdatePrice(phone, session, precioMatch[1].trim(), precioMatch[2]);
    }

    // /promo activar|desactivar <id>
    const promoMatch = text.match(/^\/promo\s+(activar|desactivar)\s+(\S+)$/i);
    if (promoMatch) {
      return handleTogglePromo(phone, session, promoMatch[1].toLowerCase(), promoMatch[2]);
    }

    // /promos
    if (lower === '/promos') {
      return handleListPromos(phone, session);
    }

    // /confirmar <número o shortId>
    const confirmarMatch = text.match(/^\/confirmar\s+(\S+)$/i);
    if (confirmarMatch) {
      const order = await findOrderByShortId(confirmarMatch[1]);
      if (!order) {
        await whatsappClient.sendMessage(
          textMessage(phone, `❌ No encontré el pedido *${confirmarMatch[1]}*.`),
        );
        return session;
      }
      return handleConfirmPayment(phone, session, order.id);
    }

    // /rechazar <número o shortId>
    const rechazarMatch = text.match(/^\/rechazar\s+(\S+)$/i);
    if (rechazarMatch) {
      const order = await findOrderByShortId(rechazarMatch[1]);
      if (!order) {
        await whatsappClient.sendMessage(
          textMessage(phone, `❌ No encontré el pedido *${rechazarMatch[1]}*.`),
        );
        return session;
      }
      return handleRejectPayment(phone, session, order.id);
    }

    // /liberar <teléfono> — devolver cliente en AWAITING_HUMAN al bot
    const liberarMatch = text.match(/^\/liberar\s+(\d+)$/i);
    if (liberarMatch) {
      const clientPhone = liberarMatch[1];
      await updateSessionState(clientPhone, 'MAIN_MENU', {});
      await whatsappClient.sendMessage(
        textMessage(clientPhone, '✅ El asesor ha finalizado la atención. ¿En qué más te puedo ayudar?'),
      );
      await whatsappClient.sendMessage(
        textMessage(phone, `✅ *${clientPhone}* devuelto al bot.`),
      );
      return session;
    }

    // /pedidos
    if (lower === '/pedidos') {
      return handleListOrders(phone, session);
    }

    // /menu
    if (lower === '/menu') {
      return handleShowMenu(phone, session);
    }

    // /stats
    if (lower === '/stats') {
      return handleStats(phone, session);
    }

    // /estado — gestión de promos del día
    // /estado <texto>               → agrega una promo
    // /estado lista                 → ver promos activas
    // /estado limpiar               → eliminar todas
    // /estado quitar <número>       → eliminar una promo por índice
    if (lower === '/estado lista' || lower === '/estado ver') {
      const promos = await getDayPromos();
      if (promos.length === 0) {
        await whatsappClient.sendMessage(
          textMessage(phone, '📋 No hay promos del día registradas.\n\n_Usa /estado <descripción> para agregar una._'),
        );
      } else {
        const listRate = await getExchangeRate();
        await whatsappClient.sendMessage(
          textMessage(phone, `🔥 *Promos del día (${promos.length}):*\n\n${formatDayPromos(promos, listRate)}\n\n_/estado limpiar — borrar todas_\n_/estado quitar <número> — borrar una_`),
        );
      }
      return session;
    }

    if (lower === '/estado limpiar') {
      // Desactivar todos los menu items auto-creados
      const promosToClean = await getDayPromos();
      const autoIds = promosToClean.filter((p) => p.autoCreated && p.menuItemId).map((p) => p.menuItemId!);
      if (autoIds.length > 0) {
        await prisma.menuItem.updateMany({ where: { id: { in: autoIds } }, data: { deletedAt: new Date(), isAvailable: false } });
        await invalidateMenuCache();
      }
      await clearDayPromos();
      await whatsappClient.sendMessage(textMessage(phone, '🗑️ Promos del día eliminadas.'));
      return session;
    }

    const estadoQuitarMatch = text.match(/^\/estado\s+quitar\s+(\d+)$/i);
    if (estadoQuitarMatch) {
      const idx = parseInt(estadoQuitarMatch[1], 10) - 1;
      const promosBefore = await getDayPromos();
      if (idx < 0 || idx >= promosBefore.length) {
        await whatsappClient.sendMessage(
          textMessage(phone, `❌ Número inválido. Usa */estado lista* para ver las promos.`),
        );
        return session;
      }
      const removed = promosBefore[idx];
      // Desactivar menu item auto-creado
      if (removed?.autoCreated && removed.menuItemId) {
        await prisma.menuItem.update({ where: { id: removed.menuItemId }, data: { deletedAt: new Date(), isAvailable: false } });
        await invalidateMenuCache();
      }
      await removeDayPromo(idx);
      await whatsappClient.sendMessage(
        textMessage(phone, `🗑️ Promo eliminada: _${removed?.name}_`),
      );
      return session;
    }

    // /estado nombre | priceBs  o  /estado nombre | descripción | priceBs
    const estadoAddMatch = text.match(/^\/estado\s+(.+)$/i);
    if (estadoAddMatch) {
      const parts = estadoAddMatch[1].split('|').map((s) => s.trim());
      let promoName: string;
      let promoDesc: string | undefined;
      let promoPriceBs = 0;

      if (parts.length >= 3) {
        promoName    = parts[0];
        promoDesc    = parts[1] || undefined;
        promoPriceBs = parseFloat(parts[2].replace(',', '.')) || 0;
      } else if (parts.length === 2) {
        const maybePrice = parseFloat(parts[1].replace(',', '.'));
        if (!isNaN(maybePrice)) {
          promoName    = parts[0];
          promoPriceBs = maybePrice;
        } else {
          promoName = parts[0];
          promoDesc = parts[1];
        }
      } else {
        promoName = parts[0];
      }

      // Auto-crear menu item en categoría PROMO DÍA
      const rate = await getExchangeRate();
      const priceUsd = promoPriceBs > 0 && rate > 0 ? promoPriceBs / rate : 0;
      let promoCategory = await prisma.menuCategory.findFirst({ where: { name: 'PROMO DÍA', isActive: true } });
      if (!promoCategory) {
        const catCount = await prisma.menuCategory.count({ where: { isActive: true } });
        promoCategory = await prisma.menuCategory.create({ data: { name: 'PROMO DÍA', emoji: '🔥', sortOrder: catCount } });
      }
      const itemCount = await prisma.menuItem.count({ where: { categoryId: promoCategory.id, deletedAt: null } });
      const menuItem = await prisma.menuItem.create({
        data: {
          categoryId: promoCategory.id,
          name: promoName,
          description: promoDesc ?? null,
          priceUsd: priceUsd.toFixed(10),
          isAvailable: true,
          sortOrder: itemCount,
        },
      });
      await invalidateMenuCache(promoCategory.id);

      const count = await addDayPromo({ name: promoName, ...(promoDesc && { description: promoDesc }), priceBs: promoPriceBs, menuItemId: menuItem.id, autoCreated: true });
      const priceStr = promoPriceBs > 0 ? ` — Bs ${promoPriceBs.toFixed(2)} (~$${(promoPriceBs / rate).toFixed(2)})` : '';
      await whatsappClient.sendMessage(
        textMessage(phone, `✅ Promo agregada (total: ${count}):\n_${promoName}${priceStr}_\n\n*/estado lista* para ver todas.\n\n_Formato: /estado nombre | Bs  o  /estado nombre | descripción | Bs_`),
      );
      return session;
    }

    // /diaspromo — configurar días en que aplica el modo promo
    // /diaspromo mie,jue            → configurar días
    // /diaspromo ver                → ver días configurados
    // /diaspromo limpiar            → quitar todos los días
    if (lower === '/diaspromo' || lower === '/diaspromo ver') {
      const days = await getPromoDays();
      if (days.length === 0) {
        await whatsappClient.sendMessage(
          textMessage(phone, '📅 No hay días de promo configurados.\n\n_Usa /diaspromo mie,jue para configurar._'),
        );
      } else {
        const names = days.map((d) => DAY_NAMES_FULL[d]).join(', ');
        await whatsappClient.sendMessage(
          textMessage(phone, `📅 *Días de promo activos:* ${names}\n\n_/diaspromo limpiar — quitar todos_`),
        );
      }
      return session;
    }

    if (lower === '/diaspromo limpiar') {
      await setPromoDays([]);
      await whatsappClient.sendMessage(textMessage(phone, '🗑️ Días de promo eliminados.'));
      return session;
    }

    const diasPromoSetMatch = text.match(/^\/diaspromo\s+(.+)$/i);
    if (diasPromoSetMatch) {
      const DAY_MAP: Record<string, number> = {
        dom: 0, domingo: 0, sun: 0,
        lun: 1, lunes: 1, mon: 1,
        mar: 2, martes: 2, tue: 2,
        mie: 3, mié: 3, miercoles: 3, miércoles: 3, wed: 3,
        jue: 4, jueves: 4, thu: 4,
        vie: 5, viernes: 5, fri: 5,
        sab: 6, sáb: 6, sabado: 6, sábado: 6, sat: 6,
      };
      const parts = diasPromoSetMatch[1].split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const days = parts.map((p) => DAY_MAP[p]).filter((d): d is number => d !== undefined);
      if (days.length === 0) {
        await whatsappClient.sendMessage(
          textMessage(phone, '❌ Días no reconocidos.\n\nEjemplos: */diaspromo mie,jue* o */diaspromo miercoles jueves*'),
        );
        return session;
      }
      await setPromoDays(days);
      const names = [...new Set(days)].sort((a, b) => a - b).map((d) => DAY_NAMES_FULL[d]).join(', ');
      await whatsappClient.sendMessage(
        textMessage(phone, `✅ Días de promo configurados: *${names}*\n\n_Usa /estado <descripción> para agregar promos del día._`),
      );
      return session;
    }

    // /menuimg — gestión de imágenes del menú visual
    if (lower === '/menuimg' || lower === '/menuimg ver') {
      const images = await getMenuImages();
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          `🖼️ *Menú visual:* ${images.length} imagen(es) guardada(s).\n\n` +
            '_Para agregar: envía una foto con el caption_ */menuimg*\n' +
            '_Para borrar todo:_ */menuimg clear*\n' +
            '_Para probar:_ */menuimg test*',
        ),
      );
      return session;
    }

    if (lower === '/menuimg clear') {
      await clearMenuImages();
      await whatsappClient.sendMessage(
        textMessage(phone, '🗑️ Imágenes del menú visual eliminadas.'),
      );
      return session;
    }

    if (lower === '/menuimg test') {
      const images = await getMenuImages();
      if (images.length === 0) {
        await whatsappClient.sendMessage(
          textMessage(phone, '⚠️ No hay imágenes guardadas. Envía una foto con caption */menuimg*.'),
        );
        return session;
      }
      await whatsappClient.sendMessage(textMessage(phone, `📸 Enviando ${images.length} imagen(es) de prueba...`));
      for (const mediaId of images) {
        await whatsappClient.sendMessage(imageMessage(phone, mediaId, undefined, true));
      }
      return session;
    }

    // Texto libre
    await whatsappClient.sendMessage(
      textMessage(phone, '🤖 Modo admin. Escribe */help* para ver los comandos.'),
    );
  }

  // ── Imagen con caption "/menuimg" → guardar media ID del menú visual ────────
  if (msg.type === 'image' && msg.imageId && msg.text?.toLowerCase().includes('/menuimg')) {
    const count = await addMenuImage(msg.imageId);
    await whatsappClient.sendMessage(
      textMessage(phone, `✅ Imagen guardada. Total: *${count}* imagen(es) en el menú visual.`),
    );
    return session;
  }

  return session;
}

// ─── /help ────────────────────────────────────────────────────────────────────

async function sendHelp(phone: string, session: SessionData): Promise<SessionData> {
  await whatsappClient.sendMessage(
    textMessage(
      phone,
      '🛠 *Comandos admin:*\n\n' +
        '*/bot on|off*                      — Activar/desactivar bot\n' +
        '*/tasa <número>*               — Tasa USD→Bs\n' +
        '*/activar*                           — Abrir restaurante\n' +
        '*/activar <Xh>*                   — Abrir por X horas (ej. /activar 2h)\n' +
        '*/desactivar*                      — Cerrar restaurante\n' +
        '*/horario*                           — Ver estado del horario\n' +
        '*/horario 10:00 22:00*       — Configurar y activar auto-horario\n' +
        '*/horario 10:00 22:00 lun-vie* — Con días específicos\n' +
        '*/horario on|off*               — Activar/desactivar auto-horario\n' +
        '*/delivery on|off*              — Control delivery\n' +
        '*/listo <#>*                  — Pedido listo (ej. /listo 1)\n' +
        '*/entregado <#>*          — Pedido entregado\n' +
        '*/precio <nombre> <$>* — Cambiar precio\n' +
        '*/menu*                        — Ver ítems y precios\n' +
        '*/promos*                      — Ver promociones\n' +
        '*/promo activar <id>*   — Activar promo manual\n' +
        '*/promo desactivar <id>* — Desactivar promo\n' +
        '*/confirmar <#>*           — Confirmar pago\n' +
        '*/rechazar <#>*             — Rechazar pago\n' +
        '*/pedidos*                    — Pedidos activos\n' +
        '*/stats*                        — Estadísticas hoy\n' +
        '*/liberar <tel>*             — Devolver cliente al bot\n' +
        '*/menuimg*                    — Ver/gestionar fotos del menú visual\n' +
        '_  (envía foto con caption /menuimg para agregar)_\n' +
        '*/estado Nombre | Bs*        — Agregar promo (ej. /estado Combo Pollo | 45.50)\n' +
        '*/estado Nombre | Desc | Bs* — Con descripción\n' +
        '*/estado lista*              — Ver promos del día activas\n' +
        '*/estado limpiar*           — Borrar todas las promos del día\n' +
        '*/diaspromo mie,jue*     — Configurar días de promo\n' +
        '*/diaspromo ver*            — Ver días configurados\n\n' +
        '_<#> = número de pedido (ej. 1 ó 0001)_\n' +
        '_También puedes usar los botones de los mensajes_',
    ),
  );
  return session;
}

// ─── /tasa ────────────────────────────────────────────────────────────────────

async function handleUpdateRate(
  phone: string,
  session: SessionData,
  rawValue: string,
): Promise<SessionData> {
  const rate = parseFloat(rawValue.replace(',', '.'));
  if (isNaN(rate) || rate <= 0) {
    await whatsappClient.sendMessage(textMessage(phone, '❌ Tasa inválida. Ej: /tasa 38.50'));
    return session;
  }
  await setConfig('USD_TO_BS_RATE', rate.toString());
  await whatsappClient.sendMessage(
    textMessage(phone, `✅ Tasa actualizada: *1 USD = ${rate.toFixed(2)} Bs*`),
  );
  logger.info({ rate }, 'Exchange rate updated by admin');
  return session;
}

// ─── /listo <ref> — marcar pedido como READY ─────────────────────────────────

async function handleOrderReadyByRef(
  adminPhone: string,
  session: SessionData,
  ref: string,
): Promise<SessionData> {
  const order = await findOrderByShortId(ref);
  if (!order) {
    await whatsappClient.sendMessage(
      textMessage(adminPhone, `❌ No encontré el pedido *${ref}*.\nUsa */pedidos* para ver los activos.`),
    );
    return session;
  }
  return doMarkOrderReady(adminPhone, session, order);
}

async function doMarkOrderReady(
  adminPhone: string,
  session: SessionData,
  order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>,
): Promise<SessionData> {
  const fId = friendlyOrderId(order.orderNumber);
  const customerName = order.customer?.name ?? 'Cliente';
  const isDelivery = order.deliveryType === 'DELIVERY';

  if (isDelivery) {
    // DELIVERY → esperar asignación de motorizado desde el dashboard
    await updateOrderStatus(order.id, 'AWAITING_DRIVER_ASSIGNMENT');
    const updatedOrder = await getOrderWithItems(order.id);
    if (updatedOrder) emitOrderUpdated(updatedOrder);

    await whatsappClient.sendMessage(
      textMessage(
        adminPhone,
        `🛵 Pedido *#${fId} — ${customerName}* listo para enviar.\n\nAsigna el motorizado desde el *dashboard*.`,
      ),
    );

    // Notificar al cliente que su pedido está listo y estamos asignando motorizado
    const customerPhone = order.customer?.phone;
    if (customerPhone) {
      await whatsappClient.sendMessage(TEMPLATES.orderAwaitingDriver(customerPhone));
    }
  } else {
    // PICKUP → flujo original sin cambios
    await updateOrderStatus(order.id, 'READY');
    const updatedOrder = await getOrderWithItems(order.id);
    if (updatedOrder) emitOrderUpdated(updatedOrder);

    await whatsappClient.sendMessage(
      buttonMessage(
        adminPhone,
        `🍳 Pedido *#${fId} — ${customerName}* listo.\n\n_Toca el botón cuando lo entregues:_`,
        [{ id: `order_delivered:${order.id}`, title: '✅ Entregado' }],
      ),
    );

    const customerPhone = order.customer?.phone;
    if (customerPhone) {
      await whatsappClient.sendMessage(TEMPLATES.orderReady(customerPhone, 'PICKUP'));

      const customerSession = await getSession(customerPhone);
      if (customerSession && customerSession.state === 'ORDER_IN_KITCHEN') {
        await updateSessionState(customerPhone, 'ORDER_READY', {
          customerId: customerSession.customerId,
          cart: customerSession.cart,
          activeOrderId: order.id,
          deliveryType: customerSession.deliveryType,
          paymentMethod: customerSession.paymentMethod,
        });
      }
    }
  }

  logger.info({ orderId: order.id, adminPhone, isDelivery }, 'Order marked as ready by admin');
  return session;
}

// ─── /entregado <ref> — marcar pedido como DELIVERED ─────────────────────────

async function handleOrderDeliveredByRef(
  adminPhone: string,
  session: SessionData,
  ref: string,
): Promise<SessionData> {
  const order = await findOrderByShortId(ref);
  if (!order) {
    await whatsappClient.sendMessage(
      textMessage(adminPhone, `❌ No encontré el pedido *${ref}*.\nUsa */pedidos* para ver los activos.`),
    );
    return session;
  }
  return doMarkOrderDelivered(adminPhone, session, order);
}

async function doMarkOrderDelivered(
  adminPhone: string,
  session: SessionData,
  order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>,
): Promise<SessionData> {
  const customerPhone = order.customer?.phone;
  if (customerPhone) await triggerOrderDelivered(customerPhone, order.id);
  else await updateOrderStatus(order.id, 'DELIVERED', { deliveredAt: new Date() });

  const fId = friendlyOrderId(order.orderNumber);
  const customerName = order.customer?.name ?? 'Cliente';
  await whatsappClient.sendMessage(
    textMessage(adminPhone, `✅ Pedido *#${fId} — ${customerName}* entregado. 🍽️`),
  );

  // Actualizar estadísticas del cliente en background
  if (order.customerId) {
    void finalizeCustomerStats(order.customerId).catch((err: unknown) =>
      logger.error({ err, orderId: order.id }, 'Failed to finalize customer stats'),
    );
  }

  logger.info({ orderId: order.id, adminPhone }, 'Order marked as delivered by admin');
  return session;
}

// ─── /precio <nombre> <usd> — actualizar precio de ítem ──────────────────────

async function handleUpdatePrice(
  phone: string,
  session: SessionData,
  nameOrId: string,
  rawPrice: string,
): Promise<SessionData> {
  const priceUsd = parseFloat(rawPrice.replace(',', '.'));
  if (isNaN(priceUsd) || priceUsd < 0) {
    await whatsappClient.sendMessage(
      textMessage(phone, '❌ Precio inválido. Ej: /precio Hamburguesa 3.50'),
    );
    return session;
  }

  const item = await prisma.menuItem.findFirst({
    where: {
      OR: [
        { name: { equals: nameOrId, mode: 'insensitive' } },
        { id: nameOrId },
      ],
      isAvailable: true,
      deletedAt: null,
    },
  });

  if (!item) {
    await whatsappClient.sendMessage(
      textMessage(
        phone,
        `❌ No encontré el ítem *${nameOrId}*. Usa */menu* para ver los disponibles.`,
      ),
    );
    return session;
  }

  await prisma.menuItem.update({
    where: { id: item.id },
    data: { priceUsd: priceUsd.toString() },
  });

  await invalidateMenuCache(item.categoryId);

  const rate = await getExchangeRate();
  const priceBs = usdToBs(priceUsd, rate);

  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `✅ *${item.name}* actualizado:\n💲 $${priceUsd.toFixed(2)} USD\n💰 Bs ${priceBs.toFixed(2)}`,
    ),
  );

  logger.info({ itemId: item.id, name: item.name, priceUsd }, 'Menu item price updated by admin');
  return session;
}

// ─── /menu — ver ítems con precios ───────────────────────────────────────────

async function handleShowMenu(phone: string, session: SessionData): Promise<SessionData> {
  const items = await prisma.menuItem.findMany({
    where: { isAvailable: true, deletedAt: null },
    include: { category: true },
    orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });

  if (items.length === 0) {
    await whatsappClient.sendMessage(textMessage(phone, '📋 No hay ítems activos en el menú.'));
    return session;
  }

  const rate = await getExchangeRate();
  const byCategory = new Map<string, typeof items>();
  for (const item of items) {
    const cat = item.category?.name ?? 'Sin categoría';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(item);
  }

  const lines: string[] = [];
  for (const [catName, catItems] of byCategory) {
    lines.push(`*${catName}:*`);
    for (const i of catItems) {
      const usd = parseFloat(i.priceUsd.toString());
      const bs = usdToBs(usd, rate);
      lines.push(`  • ${i.name} — $${usd.toFixed(2)} / Bs ${bs.toFixed(2)}`);
    }
  }

  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `🍽️ *Menú actual (${items.length} ítems):*\n\n${lines.join('\n')}\n\n_Usa /precio <nombre> <usd> para editar_`,
    ),
  );
  return session;
}

// ─── /pedidos — listar pedidos activos ───────────────────────────────────────

async function handleListOrders(phone: string, session: SessionData): Promise<SessionData> {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ['PAYMENT_UPLOADED', 'PAYMENT_CONFIRMED', 'IN_KITCHEN', 'READY'] },
    },
    include: { customer: true },
    orderBy: { createdAt: 'asc' },
    take: 15,
  });

  if (orders.length === 0) {
    await whatsappClient.sendMessage(textMessage(phone, '📋 No hay pedidos activos ahora.'));
    return session;
  }

  const statusEmoji: Record<string, string> = {
    PAYMENT_UPLOADED: '📤',
    PAYMENT_CONFIRMED: '✅',
    IN_KITCHEN: '🍳',
    READY: '🎉',
  };

  const lines = orders.map((o) => {
    const fId = friendlyOrderId(o.orderNumber);
    const name = o.customer?.name ?? 'Cliente';
    const emoji = statusEmoji[o.status] ?? '•';
    return `${emoji} *#${fId}* — ${name} — ${o.deliveryType}`;
  });

  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `📋 *Pedidos activos (${orders.length}):*\n\n${lines.join('\n')}\n\n` +
        `_Usa /listo <#> o /entregado <#> para actualizar_`,
    ),
  );
  return session;
}

// ─── /stats — estadísticas del día ───────────────────────────────────────────

async function handleStats(phone: string, session: SessionData): Promise<SessionData> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [total, delivered, cancelled, inProgress] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.order.count({ where: { createdAt: { gte: today }, status: 'DELIVERED' } }),
    prisma.order.count({ where: { createdAt: { gte: today }, status: 'CANCELLED' } }),
    prisma.order.count({
      where: {
        createdAt: { gte: today },
        status: { in: ['PAYMENT_CONFIRMED', 'IN_KITCHEN', 'READY'] },
      },
    }),
  ]);

  const revenue = await prisma.order.aggregate({
    where: { createdAt: { gte: today }, status: { in: ['DELIVERED', 'PAYMENT_CONFIRMED'] } },
    _sum: { totalBs: true },
  });

  const totalBs = Number(revenue._sum?.totalBs ?? 0);
  const rate = parseFloat((await getConfig('USD_TO_BS_RATE')) ?? '36.50');

  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `📊 *Estadísticas de hoy:*\n\n` +
        `🛒 Pedidos totales: *${total}*\n` +
        `🍳 En proceso: *${inProgress}*\n` +
        `✅ Entregados: *${delivered}*\n` +
        `❌ Cancelados: *${cancelled}*\n\n` +
        `💰 Ingresos confirmados:\n` +
        `   Bs ${totalBs.toFixed(2)} (~$${(totalBs / rate).toFixed(2)})`,
    ),
  );
  return session;
}

// ─── /promos — listar promociones ────────────────────────────────────────────

async function handleListPromos(phone: string, session: SessionData): Promise<SessionData> {
  const promos = await prisma.promotion.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  if (promos.length === 0) {
    await whatsappClient.sendMessage(textMessage(phone, '🎁 No hay promociones configuradas.'));
    return session;
  }

  const activeNow = await getActivePromotions();
  const activeIds = new Set(activeNow.map((p) => p.id));

  const lines = promos.map((p) => {
    const active = activeIds.has(p.id) ? '✅' : p.isActive ? '⏰' : '🔴';
    const manual = p.isManuallyActive ? ' [manual]' : '';
    const time = p.startTime && p.endTime ? ` ${p.startTime}-${p.endTime}` : '';
    return `${active} *${p.title}*${manual} (ID: ${p.id.slice(0, 8)})\n   ${p.description ?? ''}${time}`;
  });

  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `🎁 *Promociones (${promos.length}):*\n\n${lines.join('\n\n')}\n\n` +
        `✅=activa ahora  ⏰=fuera de horario  🔴=desactivada`,
    ),
  );
  return session;
}

// ─── /promo activar|desactivar <id> ──────────────────────────────────────────

async function handleTogglePromo(
  phone: string,
  session: SessionData,
  action: string,
  promoIdPrefix: string,
): Promise<SessionData> {
  const promo = await prisma.promotion.findFirst({
    where: {
      OR: [
        { id: { startsWith: promoIdPrefix } },
        { title: { contains: promoIdPrefix, mode: 'insensitive' } },
      ],
      deletedAt: null,
    },
  });

  if (!promo) {
    await whatsappClient.sendMessage(
      textMessage(
        phone,
        `❌ No encontré la promoción *${promoIdPrefix}*. Usa /promos para ver IDs.`,
      ),
    );
    return session;
  }

  const isActivating = action === 'activar';

  await prisma.promotion.update({
    where: { id: promo.id },
    data: {
      isManuallyActive: isActivating,
      isActive: isActivating ? true : promo.isActive,
    },
  });

  const statusText = isActivating ? 'activada manualmente ✅' : 'desactivada 🔴';
  await whatsappClient.sendMessage(
    textMessage(phone, `🎁 Promoción *${promo.title}* ${statusText}.`),
  );

  logger.info({ promoId: promo.id, action, adminPhone: phone }, 'Promotion toggled by admin');
  return session;
}

// ─── Confirmar pago ───────────────────────────────────────────────────────────

async function handleConfirmPayment(
  adminPhone: string,
  session: SessionData,
  orderId: string,
): Promise<SessionData> {
  const order = await getOrderById(orderId);
  if (!order) {
    await whatsappClient.sendMessage(textMessage(adminPhone, `❌ Orden no encontrada.`));
    return session;
  }

  // Guard de race condition: evitar doble-confirmación
  if (order.status === 'PAYMENT_CONFIRMED' || order.status === 'IN_KITCHEN') {
    const fIdDup = friendlyOrderId(order.orderNumber);
    await whatsappClient.sendMessage(
      textMessage(adminPhone, `⚠️ Pedido *#${fIdDup}* ya fue confirmado anteriormente.`),
    );
    return session;
  }
  if (order.status !== 'PAYMENT_UPLOADED') {
    const fIdBad = friendlyOrderId(order.orderNumber);
    await whatsappClient.sendMessage(
      textMessage(
        adminPhone,
        `⚠️ No se puede confirmar — pedido *#${fIdBad}* tiene estado: ${order.status}.`,
      ),
    );
    return session;
  }

  await updateOrderStatus(orderId, 'PAYMENT_CONFIRMED');
  const fId = friendlyOrderId(order.orderNumber);
  const customerName = order.customer?.name ?? 'Cliente';
  const fullOrder = await getOrderWithItems(orderId);
  if (fullOrder) emitOrderUpdated(fullOrder);

  // Confirmar al admin + botón para marcar listo cuando esté preparado
  await whatsappClient.sendMessage(
    buttonMessage(
      adminPhone,
      `✅ Pago *#${fId} — ${customerName}* confirmado. En cocina. 🍳\n\n_Toca cuando esté listo:_`,
      [{ id: `order_ready:${orderId}`, title: '🍳 Marcar listo' }],
    ),
  );

  // Notificar al cliente
  const customerPhone = order.customer?.phone;
  if (customerPhone) {
    const cartSummary = fullOrder
      ? buildCartSummary(fullOrder.items)
      : `#${fId}`;
    const etaMinutes = parseInt((await getConfig('DELIVERY_ETA_MINUTES')) ?? '20', 10);

    await whatsappClient.sendMessage(TEMPLATES.paymentConfirmed(customerPhone, cartSummary));
    await whatsappClient.sendMessage(TEMPLATES.orderInKitchen(customerPhone, fId, etaMinutes));

    const customerSession = await getSession(customerPhone);
    if (customerSession && customerSession.state === 'PAYMENT_UNDER_REVIEW') {
      await updateSessionState(customerPhone, 'ORDER_IN_KITCHEN', {
        customerId: customerSession.customerId,
        cart: customerSession.cart,
        activeOrderId: orderId,
        deliveryType: customerSession.deliveryType,
        deliveryAddress: customerSession.deliveryAddress,
        paymentMethod: customerSession.paymentMethod,
      });
    }
  }

  logger.info({ orderId, adminPhone }, 'Payment confirmed by admin');
  return session;
}

// ─── Rechazar pago ────────────────────────────────────────────────────────────

async function handleRejectPayment(
  adminPhone: string,
  session: SessionData,
  orderId: string,
): Promise<SessionData> {
  const order = await getOrderById(orderId);
  if (!order) {
    await whatsappClient.sendMessage(textMessage(adminPhone, `❌ Orden no encontrada.`));
    return session;
  }

  await updateOrderStatus(orderId, 'PAYMENT_REJECTED', {
    cancelReason: 'Pago rechazado por admin',
  });
  const updatedOrder = await getOrderWithItems(orderId);
  if (updatedOrder) emitOrderUpdated(updatedOrder);

  const fId = friendlyOrderId(order.orderNumber);

  await whatsappClient.sendMessage(
    textMessage(adminPhone, `❌ Pago *#${fId}* rechazado.`),
  );

  const customerPhone = order.customer?.phone;
  if (customerPhone) {
    await whatsappClient.sendMessage(
      textMessage(
        customerPhone,
        `❌ *Pago no verificado*\n\nNo pudimos confirmar tu pago del pedido *#${fId}*.\n\n` +
          `Por favor envía:\n• 📸 La foto del comprobante, o\n• 🔢 Los últimos 4 dígitos de la referencia`,
      ),
    );

    const customerSession = await getSession(customerPhone);
    if (customerSession) {
      await updateSessionState(customerPhone, 'AWAITING_PAYMENT_PROOF', {
        customerId: customerSession.customerId,
        cart: customerSession.cart,
        activeOrderId: orderId,
        deliveryType: customerSession.deliveryType,
        deliveryAddress: customerSession.deliveryAddress,
        paymentMethod: customerSession.paymentMethod,
      });
    }
  }

  logger.info({ orderId, adminPhone }, 'Payment rejected by admin');
  return session;
}
