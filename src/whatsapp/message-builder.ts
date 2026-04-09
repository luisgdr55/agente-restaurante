/**
 * Constructores de mensajes de WhatsApp.
 * Centraliza la creación de todos los payloads interactivos.
 */
import type { OutgoingMessage, WhatsAppInteractive, ButtonAction, ListAction } from '../agent/types';
import { WA_MAX_BUTTONS } from '../config/constants';

// ─── Texto simple ─────────────────────────────────────────────────────────────

export function textMessage(to: string, body: string): OutgoingMessage {
  return { to, type: 'text', text: { body } };
}

// ─── Botones interactivos (máx 3) ─────────────────────────────────────────────

export interface ButtonOption {
  id: string;
  title: string;
}

export function buttonMessage(
  to: string,
  body: string,
  buttons: ButtonOption[],
  options?: { header?: string; footer?: string },
): OutgoingMessage {
  if (buttons.length > WA_MAX_BUTTONS) {
    throw new Error(`WhatsApp buttons limited to ${WA_MAX_BUTTONS}, got ${buttons.length}`);
  }

  const action: ButtonAction = {
    buttons: buttons.map((b) => ({
      type: 'reply' as const,
      reply: { id: b.id, title: b.title.slice(0, 20) },
    })),
  };

  const interactive: WhatsAppInteractive = {
    type: 'button',
    body: { text: body },
    action,
  };

  if (options?.header) interactive.header = { type: 'text', text: options.header };
  if (options?.footer) interactive.footer = { text: options.footer };

  return { to, type: 'interactive', interactive };
}

// ─── Lista interactiva ────────────────────────────────────────────────────────

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export function listMessage(
  to: string,
  body: string,
  buttonLabel: string,
  sections: ListSection[],
  options?: { header?: string; footer?: string },
): OutgoingMessage {
  const action: ListAction = {
    button: buttonLabel.slice(0, 20),
    sections: sections.map((s) => ({
      title: s.title.slice(0, 24),
      rows: s.rows.slice(0, 10).map((r) => {
        const row: ListAction['sections'][0]['rows'][0] = {
          id: r.id,
          title: r.title.slice(0, 24),
        };
        if (r.description) row.description = r.description.slice(0, 72);
        return row;
      }),
    })),
  };

  const interactive: WhatsAppInteractive = {
    type: 'list',
    body: { text: body },
    action,
  };

  if (options?.header) interactive.header = { type: 'text', text: options.header };
  if (options?.footer) interactive.footer = { text: options.footer };

  return { to, type: 'interactive', interactive };
}

// ─── Imagen con caption ───────────────────────────────────────────────────────

export function imageMessage(
  to: string,
  imageUrlOrId: string,
  caption?: string,
  isId = false,
): OutgoingMessage {
  const image: OutgoingMessage['image'] = isId
    ? { id: imageUrlOrId }
    : { link: imageUrlOrId };
  if (caption) image.caption = caption;
  return { to, type: 'image', image };
}

// ─── Mensajes de flujo estándar (templates) ───────────────────────────────────

export const TEMPLATES = {
  mainMenu: (to: string, name: string) =>
    listMessage(
      to,
      `¿Qué deseas hacer, *${name}*? 😊`,
      'Ver opciones',
      [
        {
          title: 'Opciones',
          rows: [
            { id: 'menu_browse',       title: '🍔 Ver Menú y Ordenar' },
            { id: 'menu_visual',       title: '📸 Ver Menú en Imagen' },
            { id: 'menu_promos',       title: '🔥 PROMOS DEL DÍA' },
            { id: 'menu_human',        title: '🧑 Hablar con humano' },
          ],
        },
      ],
    ),

  mainMenuWithCancel: (to: string, name: string) =>
    listMessage(
      to,
      `¿Qué deseas hacer, *${name}*? 😊`,
      'Ver opciones',
      [
        {
          title: 'Opciones',
          rows: [
            { id: 'menu_browse',  title: '🍔 Ver Menú y Ordenar' },
            { id: 'menu_visual',  title: '📸 Ver Menú en Imagen' },
            { id: 'menu_promos',  title: '🔥 PROMOS DEL DÍA' },
            { id: 'menu_human',   title: '🧑 Hablar con humano' },
            { id: 'menu_cancel',  title: '❌ Cancelar pedido' },
          ],
        },
      ],
    ),

  askName: (to: string, restaurantName: string) =>
    textMessage(
      to,
      `¡Hola! 👋 Bienvenido a *${restaurantName}*.\n\n¿Cómo te llamas? 😊`,
    ),

  askNameRetryA: (to: string) =>
    textMessage(to, '¡Necesito al menos 2 letras para saber tu nombre! 😅 ¿Cómo te llamas?'),

  askNameRetryB: (to: string) =>
    textMessage(to, 'Eso parece un número 🤔 ¿Me dices tu nombre?'),

  askNameRetryC: (to: string) =>
    textMessage(to, '¡Hola! No entendí bien tu nombre. ¿Puedes escribirlo de nuevo? 😊'),

  welcomeBack: (to: string, name: string) =>
    textMessage(to, `¡Hola de nuevo, *${name}*! 👋 ¿Qué vas a querer hoy?`),

  businessClosed: (to: string, hours: string) =>
    textMessage(
      to,
      `😴 Por el momento estamos cerrados.\n\n⏰ *Horario:* ${hours}\n\n¡Vuelve pronto!`,
    ),

  unsupportedMedia: (to: string) =>
    textMessage(
      to,
      '😅 Solo proceso *texto* e *imágenes* de comprobante de pago.\n¿En qué te puedo ayudar?',
    ),

  orderConfirmation: (
    to: string,
    items: Array<{ name: string; quantity: number; subtotalBs: number; subtotalUsd: number }>,
    totalBs: number,
    totalUsd: number,
  ) => {
    const itemLines = items
      .map((i) => `• ${i.quantity}x ${i.name} — *$${i.subtotalUsd.toFixed(2)} | Bs ${i.subtotalBs.toFixed(2)}*`)
      .join('\n');
    const body = `📋 *Resumen de tu pedido:*\n\n${itemLines}\n\n💰 *Total: $${totalUsd.toFixed(2)} | Bs ${totalBs.toFixed(2)}*`;
    return buttonMessage(to, body, [
      { id: 'order_confirm', title: '✅ Confirmar pedido' },
      { id: 'order_modify', title: '✏️ Modificar' },
      { id: 'order_cancel', title: '❌ Cancelar' },
    ]);
  },

  askPaymentMethod: (to: string) =>
    buttonMessage(
      to,
      '💳 ¿Cómo vas a pagar?',
      [
        { id: 'pay_movil', title: '📱 Pago Móvil' },
        { id: 'pay_cash', title: '💵 Efectivo (Pickup)' },
        { id: 'cancel_order', title: '❌ Cancelar pedido' },
      ],
      { footer: 'Pago móvil disponible para delivery y pickup' },
    ),

  askPaymentMethodDelivery: (to: string) =>
    buttonMessage(
      to,
      '💳 ¿Cómo vas a pagar?',
      [
        { id: 'pay_movil',      title: '📱 Pago Móvil' },
        { id: 'change_address', title: '📍 Cambiar dirección' },
      ],
      { footer: 'Solo pago móvil disponible para delivery' },
    ),

  askDeliveryType: (to: string) =>
    buttonMessage(
      to,
      '🚚 ¿Cómo prefieres recibir tu pedido?',
      [
        { id: 'delivery_delivery', title: '🛵 Delivery a domicilio' },
        { id: 'delivery_pickup', title: '🏃 Retirar en local' },
        { id: 'cancel_order', title: '❌ Cancelar pedido' },
      ],
    ),

  askDeliveryAddress: (to: string) =>
    textMessage(
      to,
      '📍 ¿A qué dirección enviamos tu pedido?\n\nPuedes escribirla o compartir tu ubicación de WhatsApp 📌\n\n_Escribe *cancelar* para anular el pedido._',
    ),

  askDeliveryAddressWithSaved: (to: string, savedAddress: string) =>
    buttonMessage(
      to,
      `📍 ¿A qué dirección enviamos tu pedido?\n\n📌 *Última dirección usada:*\n${savedAddress}`,
      [
        { id: 'addr_use_saved', title: '✅ Usar esta' },
        { id: 'addr_enter_new', title: '📝 Nueva dirección' },
        { id: 'cancel_order', title: '❌ Cancelar pedido' },
      ],
      { footer: 'O escribe directamente una nueva dirección' },
    ),

  paymentDetails: (
    to: string,
    bank: string,
    phone: string,
    holder: string,
    rif: string,
    totalBs: number,
    totalUsd: number,
  ) =>
    textMessage(
      to,
      `💳 *Datos para Pago Móvil:*\n\n🏦 Banco: *${bank}*\n📱 Teléfono: *${phone}*\n👤 Titular: *${holder}*\n🪪 RIF/CI: *${rif}*\n💰 Monto: *$${totalUsd.toFixed(2)} | Bs ${totalBs.toFixed(2)}*\n\nEnvía el comprobante de pago (foto o número de referencia) 📸`,
    ),

  paymentReceived: (to: string) =>
    textMessage(
      to,
      '✅ *¡Recibimos tu comprobante!*\nEstamos verificando tu pago,\nen un momento confirmamos 🔍',
    ),

  paymentConfirmed: (to: string, cartSummary: string) =>
    textMessage(
      to,
      `🎉 *¡Pago confirmado!*\n\nTu pedido:\n${cartSummary}\n\n...ya está en preparación 🍳\nTe mantenemos al tanto 😊`,
    ),

  paymentRejected: (to: string, reason?: string) =>
    textMessage(
      to,
      `❌ No pudimos confirmar tu pago.${reason ? `\n\n_Motivo: ${reason}_` : ''}\n\nPor favor envía el comprobante nuevamente o contáctanos. 📸`,
    ),

  orderInKitchen: (to: string, _orderId: string, etaMinutes: number) =>
    textMessage(
      to,
      `👨‍🍳 Tu pedido está en cocina, preparándose con todo el cariño.\nTiempo estimado: ~${etaMinutes} minutos ⏱️`,
    ),

  orderAwaitingDriver: (to: string) =>
    textMessage(
      to,
      '✅ *¡Tu pedido está listo!*\nEstamos asignando tu motorizado, te avisamos en unos minutos 🛵',
    ),

  orderReady: (to: string, deliveryType: 'DELIVERY' | 'PICKUP') =>
    textMessage(
      to,
      deliveryType === 'PICKUP'
        ? '🎉 *¡Tu pedido está listo!* Puedes pasar a recogerlo. 🏃'
        : '🛵 *¡Tu pedido está en camino!* El repartidor ya va hacia tu dirección. 📍',
    ),

  orderOutForDelivery: (
    to: string,
    driverName: string,
    driverPhone: string,
    address: string,
  ) =>
    textMessage(
      to,
      `🛵 *¡Tu pedido va en camino!*\nTu motorizado es: *${driverName}*\nSi necesitas contactarlo: ${driverPhone}\nDirección confirmada: ${address}\n\n¡Prepárate para recibirlo! 🎉`,
    ),

  orderDelivered: (to: string, _restaurantName: string) =>
    textMessage(to, '✅ *¡Pedido entregado!*\nGracias por preferirnos 😊\n¿Todo estuvo a tu gusto?'),

  driverDeliveryConfirmed: (to: string, driverName: string) =>
    textMessage(
      to,
      `✅ ¡Perfecto! Entrega registrada.\nGracias *${driverName}* 👊`,
    ),

  driverDeliveryPrompt: (to: string, driverName: string) =>
    textMessage(
      to,
      `Hola *${driverName}*, para confirmar la entrega escribe: *entregado* ✅`,
    ),

  driverNotRegistered: (to: string) =>
    textMessage(
      to,
      'Hola, no encontramos tu número registrado como motorizado.\n\n' +
        'Pídele al encargado que confirme la entrega desde el dashboard 📱',
    ),

  feedbackRating: (to: string) =>
    listMessage(
      to,
      '¿Cómo calificarías tu experiencia? ⭐',
      'Calificar',
      [
        {
          title: 'Tu experiencia',
          rows: [
            { id: 'feedback_rating_1', title: '⭐ Muy malo' },
            { id: 'feedback_rating_2', title: '⭐⭐ Malo' },
            { id: 'feedback_rating_3', title: '⭐⭐⭐ Regular' },
            { id: 'feedback_rating_4', title: '⭐⭐⭐⭐ Bueno' },
            { id: 'feedback_rating_5', title: '⭐⭐⭐⭐⭐ Excelente' },
          ],
        },
      ],
    ),

  feedbackCommentPositive: (to: string) =>
    textMessage(
      to,
      '¡Qué bueno saberlo! 😊 ¿Quieres dejarnos un comentario?\n\n_Escribe lo que quieras o envía **/menu** para continuar._',
    ),

  feedbackCommentNegative: (to: string) =>
    textMessage(
      to,
      'Lamentamos eso 😔 ¿Qué podemos mejorar?\n\n_Tu opinión nos ayuda mucho. Escribe o envía **/menu** para continuar._',
    ),

  feedbackThanks: (to: string, hasComment: boolean) =>
    textMessage(
      to,
      hasComment
        ? '¡Gracias por tu opinión! Nos ayuda a mejorar cada día 🙏'
        : '¡Gracias! Hasta la próxima 😊',
    ),

  humanTransfer: (to: string) =>
    textMessage(
      to,
      '👨‍💼 Te estoy conectando con un asesor. Por favor espera un momento...\n\nEscribe *menú* en cualquier momento para volver al bot.',
    ),

  error: (to: string) =>
    textMessage(
      to,
      '😟 Ocurrió un error inesperado. Por favor intenta de nuevo o escribe *menú* para volver al inicio.',
    ),

} as const;
