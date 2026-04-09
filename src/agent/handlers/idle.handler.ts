/**
 * Estado IDLE — primer contacto o sesión expirada.
 *
 * Casos:
 *   A. Cliente nuevo + mensaje con productos → guardar carrito, pedir nombre
 *   B. Cliente nuevo + sin productos          → pedir nombre
 *   C. Cliente conocido + mensaje con productos → saludar + carrito directo
 *   D. Cliente conocido + sin productos         → bienvenida + menú principal
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { TEMPLATES, textMessage } from '../../whatsapp/message-builder';
import { getConfig, isBusinessActive, getExchangeRate } from '../../menu/config-service';
import { isPromoDay, getDayPromos, formatDayPromos } from '../../menu/promo-day-service';
import { showCartSummary } from './building-order.handler';
import { extractCartFromText } from './order-extraction.helper';
import { logger } from '../../utils/logger';

export async function handleIdle(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  // 1. Verificar si el negocio está activo
  const businessActive = await isBusinessActive();
  if (!businessActive) {
    const hours = (await getConfig('RESTAURANT_HOURS')) ?? 'Próximamente';
    await whatsappClient.sendMessage(TEMPLATES.businessClosed(phone, hours));
    return session;
  }

  // 2. Detectar admin
  const adminPhone = await getConfig('ADMIN_PHONE');
  if (adminPhone && phone === adminPhone) {
    logger.info({ phone }, 'Admin session started');
    return updateSessionState(phone, 'ADMIN_MODE', {
      customerId: session.customerId,
      customerName: session.customerName,
    });
  }

  // 3. Promo del día — aplica si es día de promo O si el cliente respondió a un estado
  const [dayPromos, promoDay, rate] = await Promise.all([getDayPromos(), isPromoDay(), getExchangeRate()]);
  const shouldShowPromos = dayPromos.length > 0 && (promoDay || !!msg.statusReplyId);

  if (shouldShowPromos) {
    const promoText = formatDayPromos(dayPromos, rate);
    const restaurantName = (await getConfig('RESTAURANT_NAME')) ?? 'el restaurante';

    if (session.customerName) {
      // Cliente conocido → saludar por nombre + mostrar promos
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          `🔥 ¡Hola de nuevo, *${session.customerName}*! Hoy tenemos promos especiales:\n\n${promoText}\n\n_Escríbeme qué quieres pedir o escribe *menú* para ver la carta completa 🍽️_`,
        ),
      );
      return updateSessionState(phone, 'MAIN_MENU', {
        customerId: session.customerId,
        customerName: session.customerName,
        cart: [],
        activeOrderId: undefined,
      });
    } else {
      // Cliente nuevo → mostrar promos + pedir nombre en un solo mensaje
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          `🔥 ¡Hola! Bienvenido a *${restaurantName}*.\n\nHoy tenemos promos especiales:\n\n${promoText}\n\n_Escríbeme qué quieres pedir o escribe *menú* para ver la carta completa._\n\n¿Cómo te llamas? 😊`,
        ),
      );
      return updateSessionState(phone, 'AWAITING_NAME', { customerId: session.customerId });
    }
  }

  const hasText = msg.type === 'text' && !!msg.text && msg.text.trim().length > 5;

  // ── Caso C & D: cliente conocido ─────────────────────────────────────────
  if (session.customerName) {
    // Caso C: tiene productos en el mensaje → carrito directo
    if (hasText) {
      const { toAdd } = await extractCartFromText(msg.text!, session.customerId);
      if (toAdd.length > 0) {
        const names = toAdd.map((i) => `• ${i.quantity}x ${i.name}`).join('\n');
        await whatsappClient.sendMessage(
          textMessage(
            phone,
            `¡Hola de nuevo, *${session.customerName}*! 👋\n\nAñadí a tu carrito:\n${names}`,
          ),
        );
        const newSession = await updateSessionState(phone, 'BUILDING_ORDER', {
          customerId: session.customerId,
          customerName: session.customerName,
          cart: toAdd,
        });
        await showCartSummary(phone, newSession);
        return newSession;
      }
    }

    // Caso D: sin productos → bienvenida + menú (carrito limpio)
    await whatsappClient.sendMessage(TEMPLATES.welcomeBack(phone, session.customerName));
    await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, session.customerName));
    return updateSessionState(phone, 'MAIN_MENU', {
      customerId: session.customerId,
      customerName: session.customerName,
      cart: [],
      activeOrderId: undefined,
    });
  }

  // ── Caso A & B: cliente nuevo ─────────────────────────────────────────────
  const restaurantName = (await getConfig('RESTAURANT_NAME')) ?? 'el restaurante';

  // Caso A: tiene productos → guardar en carrito de sesión, pedir nombre
  if (hasText) {
    const { toAdd } = await extractCartFromText(msg.text!, session.customerId);
    if (toAdd.length > 0) {
      await whatsappClient.sendMessage(TEMPLATES.askName(phone, restaurantName));
      return updateSessionState(phone, 'AWAITING_NAME', {
        customerId: session.customerId,
        cart: toAdd,
      });
    }
  }

  // Caso B: sin productos → pedir nombre
  await whatsappClient.sendMessage(TEMPLATES.askName(phone, restaurantName));
  return updateSessionState(phone, 'AWAITING_NAME', { customerId: session.customerId });
}
