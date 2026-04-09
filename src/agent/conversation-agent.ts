/**
 * Orquestador de la máquina de estados conversacional.
 *
 * Flujo por mensaje:
 *   1. Cargar/crear sesión en Redis
 *   2. Sincronizar con Customer en DB (findOrCreate)
 *   3. Resolver estado efectivo (manejar sesión expirada)
 *   4. Dispatchar al handler del estado actual
 *   5. Persistir nuevo estado en Redis + DB (async)
 */
import { logger } from '../utils/logger';
import type { IncomingMessage } from './types';
import {
  getSession,
  createDefaultSession,
  updateSessionState,
  isBotEnabled,
  type SessionData,
  type ConversationState,
} from '../redis/session-manager';
import { findOrCreateCustomer, isSessionExpired } from './customer-service';
import { updateCustomerConversationState } from './customer-service';
import { getConfig, isBusinessActive, hasClosedNotification, markClosedNotified } from '../menu/config-service';
import { whatsappClient } from '../whatsapp/client';
import { textMessage, TEMPLATES } from '../whatsapp/message-builder';
import { updateOrderStatus, createOrder, getOrderWithItems, buildCartSummary, findActiveDeliveryByDriverPhone, wasRecentDriverPhone } from '../orders/order-service';
import { generateOrderStatusResponse, type ActiveOrderContext, type RestaurantContext } from '../llm/gemini-client';
import { handleRegisteredDriver, handleUnregisteredDriverAttempt } from './handlers/driver-delivery.handler';
import { POST_ORDER_STATES } from '../config/constants';

// Handlers
import { handleIdle } from './handlers/idle.handler';
import { handleAwaitingName } from './handlers/awaiting-name.handler';
import { handleMainMenu } from './handlers/main-menu.handler';
import { handleAwaitingHuman } from './handlers/awaiting-human.handler';
import { handleBrowseCategories } from './handlers/browse-categories.handler';
import { handleBrowseItems } from './handlers/browse-items.handler';
import { handleBuildingOrder } from './handlers/building-order.handler';
import { handleOrderConfirmation } from './handlers/order-confirmation.handler';
import { handleAwaitingDeliveryType } from './handlers/awaiting-delivery-type.handler';
import { handleAwaitingDeliveryAddress } from './handlers/awaiting-delivery-address.handler';
import { handleAwaitingDeliveryReference } from './handlers/awaiting-delivery-reference.handler';
import { handleAwaitingPaymentMethod } from './handlers/awaiting-payment-method.handler';
import { handleAwaitingPaymentProof } from './handlers/awaiting-payment-proof.handler';
import { handlePaymentUnderReview } from './handlers/payment-under-review.handler';
import { handleOrderInKitchen } from './handlers/order-in-kitchen.handler';
import { handleAdminMode } from './handlers/admin.handler';
import { handleAwaitingFeedbackRating } from './handlers/awaiting-feedback-rating.handler';
import { handleAwaitingFeedbackComment } from './handlers/awaiting-feedback-comment.handler';
import { extractCartFromText } from './handlers/order-extraction.helper';
import { showCartSummary } from './handlers/building-order.handler';
import { isVisualMenuRequest, handleVisualMenuRequest } from './handlers/visual-menu.handler';
import { detectFrustrationFromText, offerEscalation, activateHumanEscalation } from './handlers/frustration.helper';

// ─── Menú visual ──────────────────────────────────────────────────────────────

// Estados donde tiene sentido mostrar el menú visual (navegación/pedido, no pagos)
const VISUAL_MENU_STATES: ConversationState[] = [
  'IDLE', 'MAIN_MENU', 'AWAITING_NAME',
  'BROWSE_CATEGORIES', 'BROWSE_ITEMS', 'BUILDING_ORDER',
];

// ─── Cancelación global ───────────────────────────────────────────────────────

// Estados donde aún es posible cancelar (no cuando ya está en cocina o entregado)
const CANCELLABLE_STATES: ConversationState[] = [
  'IDLE', 'MAIN_MENU', 'AWAITING_NAME',
  'BROWSE_CATEGORIES', 'BROWSE_ITEMS', 'BUILDING_ORDER',
  'ORDER_CONFIRMATION', 'AWAITING_DELIVERY_TYPE', 'AWAITING_DELIVERY_ADDRESS',
  'AWAITING_DELIVERY_REFERENCE', 'AWAITING_PAYMENT_METHOD', 'AWAITING_PAYMENT_PROOF',
  'PAYMENT_UNDER_REVIEW',
  'AWAITING_DRIVER_ASSIGNMENT',
  'AWAITING_FEEDBACK_RATING', 'AWAITING_FEEDBACK_COMMENT',
];

const CANCEL_PHRASES = ['cancelar', 'cancel', 'no quiero', 'salir', 'quiero salir', 'olvidalo', 'olvídalo'];

function isCancelRequest(msg: IncomingMessage, state: ConversationState): boolean {
  if (!CANCELLABLE_STATES.includes(state)) return false;
  if (msg.type === 'text' && msg.text) {
    const lower = msg.text.toLowerCase().trim();
    return CANCEL_PHRASES.some((phrase) => lower.includes(phrase));
  }
  if (msg.type === 'interactive' && msg.interactiveReply) {
    return msg.interactiveReply.id === 'cancel_order';
  }
  return false;
}

// ─── Despedida global ─────────────────────────────────────────────────────────

// Estados donde tiene sentido detectar despedidas (no durante un pedido activo en proceso)
const FAREWELL_STATES: ConversationState[] = [
  'IDLE', 'MAIN_MENU', 'BROWSE_CATEGORIES', 'BROWSE_ITEMS',
  'BUILDING_ORDER', 'AWAITING_HUMAN',
];

// Frases que indican que el cliente quiere cerrar la conversación
const FAREWELL_PHRASES = [
  'más nada', 'mas nada', 'nada más', 'nada mas',
  'hasta luego', 'hasta pronto', 'hasta mañana', 'hasta manana',
  'adiós', 'adios', 'bye', 'chao', 'chau', 'nos vemos',
  'eso es todo', 'era todo', 'era nada', 'ya es todo',
];

function isFarewellMessage(msg: IncomingMessage, state: ConversationState): boolean {
  if (msg.type !== 'text' || !msg.text) return false;
  if (!FAREWELL_STATES.includes(state)) return false;
  const lower = msg.text.toLowerCase().trim();
  return FAREWELL_PHRASES.some((phrase) => lower.includes(phrase));
}

async function handleGlobalFarewell(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;
  const name = session.customerName ?? 'cliente';

  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `¡Hasta luego, *${name}*! 👋 Fue un placer atenderte.\n\nCuando quieras pedir algo, aquí estaré 😊`,
    ),
  );

  return updateSessionState(phone, 'IDLE', {
    customerId: session.customerId,
    customerName: session.customerName,
    cart: [],
    activeOrderId: undefined,
  });
}

async function handleGlobalCancel(
  msg: IncomingMessage,
  session: SessionData,
  fromState?: ConversationState,
): Promise<SessionData> {
  const { phone } = msg;
  const name = session.customerName ?? 'cliente';

  if (session.activeOrderId) {
    // Orden ya creada en DB → cancelar + emitir socket para que dashboard actualice
    try {
      await updateOrderStatus(session.activeOrderId, 'CANCELLED', {
        cancelReason: 'Cancelado por el cliente vía WhatsApp',
      });
      // Notificar al admin si cancela mientras esperaba motorizado
      if (fromState === 'AWAITING_DRIVER_ASSIGNMENT') {
        const adminPhone = await getConfig('ADMIN_PHONE');
        if (adminPhone) {
          const order = await getOrderWithItems(session.activeOrderId).catch(() => null);
          const orderRef = order ? `#${order.orderNumber}` : session.activeOrderId;
          await whatsappClient.sendMessage(
            textMessage(
              adminPhone,
              `⚠️ *${name}* (${phone}) canceló el pedido ${orderRef} antes de que saliera el motorizado.\n\nEl pedido fue cancelado automáticamente.`,
            ),
          );
        }
      }
    } catch {
      // La orden puede no existir; ignorar
    }
  } else if (session.customerId && session.cart.length > 0) {
    // Carrito con ítems pero aún sin orden en DB → crear registro cancelado para trazabilidad
    try {
      const order = await createOrder({
        customerId: session.customerId,
        cart: session.cart,
        deliveryType: 'PICKUP',
        paymentMethod: 'PAGO_MOVIL',
      });
      await updateOrderStatus(order.id, 'CANCELLED', {
        cancelReason: 'Cancelado por el cliente vía WhatsApp (antes del pago)',
      });
    } catch {
      // No crítico
    }
  }

  await whatsappClient.sendMessage(
    textMessage(
      phone,
      `Entendido, *${name}*. Tu pedido fue cancelado 👍\n\nSi más tarde quieres pedir algo, escríbeme y con gusto te atiendo 😊`,
    ),
  );

  return updateSessionState(phone, 'IDLE', {
    customerId: session.customerId,
    customerName: session.customerName,
    cart: [],
    activeOrderId: undefined,
  });
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

async function dispatch(
  state: ConversationState,
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  switch (state) {
    case 'IDLE':
      return handleIdle(msg, session);

    case 'AWAITING_NAME':
      return handleAwaitingName(msg, session);

    case 'MAIN_MENU':
      return handleMainMenu(msg, session);

    case 'AWAITING_HUMAN':
      return handleAwaitingHuman(msg, session);

    case 'BROWSE_CATEGORIES':
      return handleBrowseCategories(msg, session);

    case 'BROWSE_ITEMS':
      return handleBrowseItems(msg, session);

    case 'BUILDING_ORDER':
      return handleBuildingOrder(msg, session);

    case 'ORDER_CONFIRMATION':
      return handleOrderConfirmation(msg, session);

    case 'AWAITING_DELIVERY_TYPE':
      return handleAwaitingDeliveryType(msg, session);

    case 'AWAITING_DELIVERY_ADDRESS':
      return handleAwaitingDeliveryAddress(msg, session);

    case 'AWAITING_DELIVERY_REFERENCE':
      return handleAwaitingDeliveryReference(msg, session);

    case 'AWAITING_PAYMENT_METHOD':
      return handleAwaitingPaymentMethod(msg, session);

    case 'AWAITING_PAYMENT_PROOF':
      return handleAwaitingPaymentProof(msg, session);

    case 'PAYMENT_UNDER_REVIEW':
      return handlePaymentUnderReview(msg, session);

    case 'ORDER_IN_KITCHEN':
    case 'AWAITING_DRIVER_ASSIGNMENT':
    case 'OUT_FOR_DELIVERY':
      return handleOrderInKitchen(msg, session);

    case 'ORDER_READY':
    case 'ORDER_DELIVERED':
      // Estado terminal — solo informar al cliente si escribe algo
      await whatsappClient.sendMessage(
        TEMPLATES.mainMenu(msg.phone, session.customerName ?? 'cliente'),
      );
      return updateSessionState(msg.phone, 'MAIN_MENU', { customerId: session.customerId });

    case 'AWAITING_FEEDBACK_RATING':
      return handleAwaitingFeedbackRating(msg, session);

    case 'AWAITING_FEEDBACK_COMMENT':
      return handleAwaitingFeedbackComment(msg, session);

    case 'ADMIN_MODE':
      return handleAdminMode(msg, session);

    default: {
      const _exhaustive: never = state;
      logger.error({ state: _exhaustive, phone: msg.phone }, 'Unhandled conversation state');
      return session;
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function handleMessage(msg: IncomingMessage): Promise<void> {
  const { phone } = msg;
  const msgLog = logger.child({ phone, messageId: msg.messageId });

  try {
    // 0. Identificación de motorizado — ANTES de crear Customer en DB
    //
    //  Tres casos posibles para cualquier número no-admin que escribe texto:
    //
    //  CHECK 1 — driverPhone tiene entrega activa (OUT_FOR_DELIVERY):
    //    → Procesar como motorizado registrado y retornar.
    //      El motorizado nunca llega al flujo de cliente.
    //
    //  CHECK 1.5 — driverPhone entregó en las últimas 24h (sin orden activa ya):
    //    → Responder "entrega registrada" y retornar sin crear Customer.
    //    → Previene Customer basura si el motorizado escribe algo casual post-entrega.
    //
    //  CHECK 2 — Número sin sesión Redis (desconocido total):
    //    → LLM detecta si suena a confirmación de entrega.
    //    → Si sí: alertar admin + responder "número no registrado" + retornar.
    //    → Si no: flujo normal de cliente nuevo.
    //
    //  Clientes con sesión activa (AWAITING_HUMAN, etc.) que escriban
    //  "ya listo" / "ta bien": Check 1 falla, Checks 1.5/2 se saltan (tienen sesión).
    //  → Flujo normal garantizado, sin falsos positivos.
    if ((msg.type === 'text' && msg.text?.trim()) || msg.type === 'interactive') {
      const cfgAdminPhone = await getConfig('ADMIN_PHONE');
      if (!cfgAdminPhone || phone !== cfgAdminPhone) {
        // Check 1: motorizado registrado con entrega activa
        const activeDelivery = await findActiveDeliveryByDriverPhone(phone);
        if (activeDelivery) {
          await handleRegisteredDriver(msg, activeDelivery, msgLog);
          return;
        }

        const existingSession = await getSession(phone);

        // Check 1.5: motorizado que entregó recientemente (sin orden activa ya)
        if (!existingSession && msg.type === 'text') {
          const wasDriver = await wasRecentDriverPhone(phone);
          if (wasDriver) {
            await whatsappClient.sendMessage(textMessage(phone, '¡Gracias! Tu entrega fue registrada exitosamente 👊'));
            msgLog.info({ phone }, 'Post-delivery driver message — no Customer created');
            return;
          }
        }

        // Check 2: número sin sesión → podría ser motorizado no registrado
        if (!existingSession && msg.type === 'text') {
          const handled = await handleUnregisteredDriverAttempt(phone, msg.text ?? '', cfgAdminPhone, msgLog);
          if (handled) return;
        }
      }
    }

    // 1. Cargar sesión Redis
    let session = await getSession(phone);

    // 2. Sincronizar con DB (findOrCreate customer)
    const customer = await findOrCreateCustomer(phone);

    if (!session) {
      session = await createDefaultSession(phone);
    }

    // 3. Enriquecer sesión con datos del cliente de DB
    session.customerId = customer.id;
    if (customer.name && !session.customerName) {
      session.customerName = customer.name;
    }

    // 4. Resolver estado efectivo
    //    Si es el admin enviando un comando (/) o respondiendo a botones del sistema
    //    → forzar ADMIN_MODE sin importar estado actual de la sesión
    const adminPhone = await getConfig('ADMIN_PHONE');

    const ADMIN_BUTTON_PREFIXES = [
      'confirm_payment:',
      'reject_payment:',
      'order_in_kitchen:',
      'order_ready:',
      'order_delivered:',
    ];

    const isAdminCommand =
      adminPhone &&
      msg.phone === adminPhone &&
      msg.type === 'text' &&
      msg.text?.startsWith('/');

    const isAdminButtonReply =
      adminPhone &&
      msg.phone === adminPhone &&
      msg.type === 'interactive' &&
      msg.interactiveReply != null &&
      ADMIN_BUTTON_PREFIXES.some((prefix) => msg.interactiveReply!.id.startsWith(prefix));

    const effectiveState: ConversationState = (isAdminCommand || isAdminButtonReply)
      ? 'ADMIN_MODE'
      : isSessionExpired(customer)
        ? 'IDLE'
        : (session.state as ConversationState);

    msgLog.info(
      { state: effectiveState, type: msg.type },
      'Processing message',
    );

    // 4a-pre. Sesión con orden activa cuyo estado en DB es terminal (DELIVERED/CANCELLED).
    //         Ocurre tras caída de token, deploy o cancelación manual desde dashboard.
    //         Limpiar sesión silenciosamente y devolver al menú principal.
    if (session.activeOrderId && POST_ORDER_STATES.includes(effectiveState)) {
      const activeOrder = await getOrderWithItems(session.activeOrderId).catch(() => null);
      if (activeOrder?.status === 'DELIVERED' || activeOrder?.status === 'CANCELLED') {
        await updateSessionState(phone, 'MAIN_MENU', {
          customerId: session.customerId,
          customerName: session.customerName,
          cart: [],
          activeOrderId: undefined,
        });
        await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, session.customerName ?? 'cliente'));
        void updateCustomerConversationState(customer.id, { state: 'MAIN_MENU' }).catch(() => undefined);
        msgLog.info({ stateFrom: effectiveState, orderId: session.activeOrderId }, 'Stale order session reset to MAIN_MENU');
        return;
      }
    }

    // 4a. Sesión abandonada — cliente retoma una conversación que quedó a medias
    //     sin carrito y sin orden activa. Redirigir al menú principal amablemente.
    const MID_ORDER_STATES: ConversationState[] = [
      'BUILDING_ORDER', 'ORDER_CONFIRMATION',
      'AWAITING_DELIVERY_TYPE', 'AWAITING_DELIVERY_ADDRESS',
      'AWAITING_PAYMENT_METHOD',
    ];
    const isAbandoned =
      MID_ORDER_STATES.includes(effectiveState) &&
      session.cart.length === 0 &&
      !session.activeOrderId;

    if (isAbandoned) {
      const name = session.customerName ?? 'cliente';
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          `Hola de nuevo, *${name}* 👋\n\nParece que quedó una conversación sin terminar. ¡No te preocupes!\n\n¿Qué te gustaría pedir hoy?`,
        ),
      );
      await updateSessionState(phone, 'MAIN_MENU', {
        customerId: session.customerId,
        customerName: session.customerName,
        cart: [],
      });
      await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, name));
      void updateCustomerConversationState(customer.id, { state: 'MAIN_MENU' }).catch(() => undefined);
      msgLog.info({ stateFrom: effectiveState, stateTo: 'MAIN_MENU' }, 'Abandoned session recovered');
      return;
    }

    // 4b. Modo manual — si bot deshabilitado, reenviar mensaje al admin y no procesar
    //     El admin siempre puede seguir usando comandos aunque el bot esté desactivado
    if (!isAdminCommand && !isAdminButtonReply) {
      const botEnabled = await isBotEnabled();
      if (!botEnabled) {
        const adminPhone = await getConfig('ADMIN_PHONE');
        if (adminPhone && msg.phone !== adminPhone) {
          const msgText =
            msg.type === 'text' && msg.text
              ? msg.text
              : `[${msg.type}]`;
          const name = session.customerName ?? msg.phone;
          await whatsappClient
            .sendMessage(
              textMessage(
                adminPhone,
                `📲 *${name}* (+${msg.phone}):\n${msgText}`,
              ),
            )
            .catch(() => undefined);
        }
        msgLog.info({ state: effectiveState }, 'Bot disabled — message forwarded to admin');
        return;
      }
    }

    // 5. Negocio cerrado — bloquear nuevas conversaciones (no pedidos ya en curso ni admin)
    const isAdminPhone = adminPhone && msg.phone === adminPhone;
    const STATES_BLOCKED_WHEN_CLOSED: ConversationState[] = [
      'IDLE', 'MAIN_MENU', 'AWAITING_NAME',
      'BROWSE_CATEGORIES', 'BROWSE_ITEMS', 'BUILDING_ORDER',
    ];
    if (!isAdminPhone && STATES_BLOCKED_WHEN_CLOSED.includes(effectiveState)) {
      const businessActive = await isBusinessActive();
      if (!businessActive) {
        const alreadyNotified = await hasClosedNotification(phone);
        if (!alreadyNotified) {
          const hours = await getConfig('RESTAURANT_HOURS');
          await whatsappClient.sendMessage(TEMPLATES.businessClosed(phone, hours ?? 'Consulta nuestro horario'));
          await markClosedNotified(phone);
        } else if (adminPhone) {
          // Reenviar el mensaje al admin (el bot está en silencio para este contacto)
          const senderName = customer.name ?? phone;
          const content = msg.type === 'text' && msg.text ? msg.text : `[${msg.type}]`;
          await whatsappClient.sendMessage(
            textMessage(adminPhone, `📩 *Mensaje fuera de horario*\nDe: ${senderName} (${phone})\n\n${content}`),
          );
        }
        return;
      }
    }

    // 5a. Cancelación global — intercepta "cancelar" en cualquier estado cancelable
    if (isCancelRequest(msg, effectiveState)) {
      const newSession = await handleGlobalCancel(msg, session, effectiveState);
      void updateCustomerConversationState(customer.id, { state: newSession.state }).catch(
        (err: unknown) => msgLog.error({ err }, 'Failed to persist cancel state'),
      );
      msgLog.info({ stateFrom: effectiveState, stateTo: newSession.state }, 'Global cancel');
      return;
    }

    // 5a'. OUT_FOR_DELIVERY — informar que ya salió el motorizado, sin cancelar nada
    if (
      effectiveState === 'OUT_FOR_DELIVERY' &&
      msg.type === 'text' && msg.text &&
      CANCEL_PHRASES.some((phrase) => msg.text!.toLowerCase().trim().includes(phrase))
    ) {
      const outAdminPhone = await getConfig('ADMIN_PHONE');
      const adminDisplay = outAdminPhone ? `+${outAdminPhone}` : 'el restaurante';
      await whatsappClient.sendMessage(
        textMessage(
          phone,
          `🛵 Tu pedido ya está en camino.\n\nPara cualquier cambio comunícate directamente con el restaurante: *${adminDisplay}*`,
        ),
      );
      void updateCustomerConversationState(customer.id, { state: effectiveState }).catch(() => undefined);
      msgLog.info({ effectiveState }, 'Cancel attempt in OUT_FOR_DELIVERY — informed client');
      return;
    }

    // 5b. Despedida global — intercepta frases de cierre de conversación
    if (isFarewellMessage(msg, effectiveState)) {
      const newSession = await handleGlobalFarewell(msg, session);
      void updateCustomerConversationState(customer.id, { state: newSession.state }).catch(
        (err: unknown) => msgLog.error({ err }, 'Failed to persist farewell state'),
      );
      msgLog.info({ stateFrom: effectiveState, stateTo: newSession.state }, 'Global farewell');
      return;
    }

    // 5c. Menú visual — cliente pide ver el menú en fotos
    if (
      msg.type === 'text' && msg.text &&
      VISUAL_MENU_STATES.includes(effectiveState) &&
      isVisualMenuRequest(msg.text)
    ) {
      const newSession = await handleVisualMenuRequest(msg, session);
      void updateCustomerConversationState(customer.id, { state: newSession.state }).catch(
        (err: unknown) => msgLog.error({ err }, 'Failed to persist visual menu state'),
      );
      msgLog.info({ stateFrom: effectiveState, stateTo: newSession.state }, 'Visual menu request');
      return;
    }

    // 5d. Frustración — detección por frases (rápida, sin LLM) + botones de escalado
    //
    //  Dos sub-casos:
    //   A) Botón "Sí, hablar con asesor" o "No, continuar pidiendo" (respuesta a oferta previa)
    //   B) Texto libre con frases de frustración en estados donde el bot puede responder
    //
    const FRUSTRATION_DETECTABLE_STATES: ConversationState[] = [
      'IDLE', 'MAIN_MENU', 'BROWSE_CATEGORIES', 'BROWSE_ITEMS',
      'BUILDING_ORDER', 'ORDER_CONFIRMATION',
      'AWAITING_DELIVERY_TYPE', 'AWAITING_DELIVERY_ADDRESS', 'AWAITING_DELIVERY_REFERENCE',
      'AWAITING_PAYMENT_METHOD',
    ];
    const isNonAdminState = effectiveState !== 'ADMIN_MODE';

    // A) Respuesta a los botones de escalado
    if (
      isNonAdminState &&
      msg.type === 'interactive' &&
      msg.interactiveReply != null
    ) {
      const btnId = msg.interactiveReply.id;

      if (btnId === 'escalate_to_human') {
        const newSession = await activateHumanEscalation(
          phone,
          session,
          'Solicitado por el cliente tras oferta de escalado',
          msg.interactiveReply.title ?? '',
        );
        void updateCustomerConversationState(customer.id, { state: newSession.state }).catch(() => undefined);
        msgLog.info({ stateFrom: effectiveState, stateTo: 'AWAITING_HUMAN' }, 'Escalation accepted by client');
        return;
      }

      if (btnId === 'continue_ordering') {
        await whatsappClient.sendMessage(
          textMessage(phone, `¡Perfecto! Aquí estoy para ayudarte, *${session.customerName ?? 'cliente'}* 😊`),
        );
        // Resetear contador de frustración y devolver al menú principal
        const ns = await updateSessionState(phone, 'MAIN_MENU', {
          customerId: session.customerId,
          customerName: session.customerName,
          cart: session.cart,
          consecutiveOtherCount: 0,
        });
        await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, session.customerName ?? 'cliente'));
        void updateCustomerConversationState(customer.id, { state: ns.state }).catch(() => undefined);
        msgLog.info({ stateFrom: effectiveState, stateTo: 'MAIN_MENU' }, 'Escalation declined by client');
        return;
      }
    }

    // B) Frases de frustración en texto libre
    if (
      isNonAdminState &&
      FRUSTRATION_DETECTABLE_STATES.includes(effectiveState) &&
      msg.type === 'text' &&
      msg.text &&
      detectFrustrationFromText(msg.text)
    ) {
      await offerEscalation(phone, session.customerName ?? 'cliente');
      void updateCustomerConversationState(customer.id, { state: effectiveState }).catch(() => undefined);
      msgLog.info({ effectiveState }, 'Frustration detected via phrase, offering escalation');
      return;
    }

    // 5e. Interceptor LLM global de carrito
    //
    //  Cubre DOS grupos de estados con texto libre:
    //
    //  GRUPO A — Navegación del menú (BROWSE_CATEGORIES, BROWSE_ITEMS):
    //    El cliente escribe su pedido en cualquier momento mientras navega.
    //    Si el LLM detecta ítems → carrito actualizado → BUILDING_ORDER.
    //    Si el LLM no encuentra nada → el handler recibe el mensaje normalmente
    //    (puede ser un keyword de navegación como "atrás", "menú", etc.).
    //
    //  GRUPO B — Pre-pago (ORDER_CONFIRMATION, AWAITING_DELIVERY_TYPE, etc.):
    //    El cliente quiere agregar/quitar algo después de confirmar el pedido.
    //    Solo actúa si detecta ítems (toAdd/toRemove); si no, cae al handler.
    //
    //  BUILDING_ORDER queda excluido aquí: su handler propio es más completo
    //  (maneja removes, carrito vacío, "⏳ Procesando...", etc.).
    //
    //  Cualquier handler nuevo que se agregue en el futuro a BROWSE_STATES o
    //  PREPAYMENT_STATES hereda automáticamente el procesamiento LLM sin
    //  necesitar código extra.

    const BROWSE_STATES: ConversationState[] = ['BROWSE_CATEGORIES', 'BROWSE_ITEMS'];
    const PREPAYMENT_STATES: ConversationState[] = [
      'ORDER_CONFIRMATION', 'AWAITING_DELIVERY_TYPE', 'AWAITING_PAYMENT_METHOD',
    ];
    const LLM_INTERCEPTED_STATES = [...BROWSE_STATES, ...PREPAYMENT_STATES];

    if (
      LLM_INTERCEPTED_STATES.includes(effectiveState) &&
      msg.type === 'text' &&
      msg.text &&
      msg.text.trim().length > 2
    ) {
      const extraction = await extractCartFromText(msg.text, session.customerId)
        .catch(() => ({ toAdd: [], toRemove: [], notFound: [] as string[], intent: 'OTHER' as const, ambiguous: [], frustrationLevel: 0 as const, escalationReason: null }));
      const { toAdd, toRemove, notFound, frustrationLevel, escalationReason, intent: extractedIntent } = extraction;

      // Actualizar contador de intents OTHER consecutivos
      const newOtherCount = extractedIntent === 'OTHER'
        ? (session.consecutiveOtherCount ?? 0) + 1
        : 0;
      session = { ...session, consecutiveOtherCount: newOtherCount };

      // Escalado automático por frustración LLM o contador
      const shouldEscalate =
        frustrationLevel >= 2 ||
        newOtherCount >= 2;

      if (shouldEscalate) {
        if (frustrationLevel === 3) {
          // Escalado directo sin preguntar
          const newSession = await activateHumanEscalation(phone, session, escalationReason, msg.text);
          void updateCustomerConversationState(customer.id, { state: newSession.state }).catch(() => undefined);
          msgLog.info({ frustrationLevel, newOtherCount, stateTo: 'AWAITING_HUMAN' }, 'Auto-escalation triggered');
          return;
        }
        // Ofrecer escalado
        await offerEscalation(phone, session.customerName ?? 'cliente');
        await updateSessionState(phone, effectiveState, { customerId: session.customerId, consecutiveOtherCount: newOtherCount });
        void updateCustomerConversationState(customer.id, { state: effectiveState }).catch(() => undefined);
        msgLog.info({ frustrationLevel, newOtherCount }, 'Escalation offered after LLM frustration signal');
        return;
      }

      // Persistir el contador actualizado si cambió
      if (newOtherCount !== (session.consecutiveOtherCount ?? 0)) {
        await updateSessionState(phone, effectiveState, { customerId: session.customerId, consecutiveOtherCount: newOtherCount });
      }

      const isBrowseState = BROWSE_STATES.includes(effectiveState);

      let updatedCart = [...session.cart];

      // Agregar ítems
      for (const item of toAdd) {
        const idx = updatedCart.findIndex((c) => c.menuItemId === item.menuItemId);
        if (idx >= 0) {
          updatedCart[idx] = { ...updatedCart[idx]!, quantity: updatedCart[idx]!.quantity + item.quantity };
        } else {
          updatedCart.push(item);
        }
      }

      // Eliminar ítems — rastrear cuáles existían realmente en el carrito
      const actuallyRemoved: string[] = [];
      const notInCart: string[] = [];
      for (const item of toRemove) {
        const idx = updatedCart.findIndex((c) => c.menuItemId === item.menuItemId);
        if (idx >= 0) {
          const newQty = updatedCart[idx]!.quantity - item.quantity;
          if (newQty <= 0) {
            actuallyRemoved.push(updatedCart[idx]!.name);
            updatedCart.splice(idx, 1);
          } else {
            updatedCart[idx] = { ...updatedCart[idx]!, quantity: newQty };
            actuallyRemoved.push(updatedCart[idx]!.name);
          }
        } else {
          notInCart.push(item.name);
        }
      }

      const cartChanged = toAdd.length > 0 || actuallyRemoved.length > 0;

      if (cartChanged) {
        const feedbackParts: string[] = [];
        if (toAdd.length > 0)           feedbackParts.push(`✅ Agregado: ${toAdd.map((i) => `*${i.name}* x${i.quantity}`).join(', ')}`);
        if (actuallyRemoved.length > 0) feedbackParts.push(`🗑️ Quitado: ${actuallyRemoved.map((n) => `*${n}*`).join(', ')}`);
        if (notInCart.length > 0)       feedbackParts.push(`⚠️ No estaba en tu carrito: ${notInCart.map((n) => `*${n}*`).join(', ')}`);
        if (notFound.length > 0)        feedbackParts.push(`❌ No encontrado en el menú: ${notFound.map((n) => `*${n}*`).join(', ')}`);

        await whatsappClient.sendMessage(textMessage(phone, feedbackParts.join('\n')));

        const ns = await updateSessionState(phone, 'BUILDING_ORDER', {
          customerId: session.customerId,
          customerName: session.customerName,
          cart: updatedCart,
        });
        await showCartSummary(phone, ns);

        void updateCustomerConversationState(customer.id, { state: 'BUILDING_ORDER' }).catch(() => undefined);
        msgLog.info(
          { stateFrom: effectiveState, stateTo: 'BUILDING_ORDER', added: toAdd.length, removed: actuallyRemoved.length },
          'Global LLM cart intercept',
        );
        return;
      }

      // Nada cambió en el carrito — informar si aplica y caer al handler
      if (notInCart.length > 0) {
        await whatsappClient.sendMessage(
          textMessage(phone, `⚠️ *${notInCart.join(', ')}* no estaba en tu carrito.`),
        );
      }
      if (isBrowseState && notFound.length > 0) {
        await whatsappClient.sendMessage(
          textMessage(phone, `❌ No encontré *${notFound.join(', ')}* en el menú.\n\nElige una categoría 👇`),
        );
      }
      // Cae al handler para keywords de navegación ("atrás", "menú", "carrito", etc.)
    }

    // 5g. Timeout de feedback — 20 minutos desde feedbackRequestedAt
    //
    //  Si el cliente no respondió el feedback en 20 min y ahora escribe algo,
    //  se resetea silenciosamente a MAIN_MENU sin mostrarle ningún mensaje del
    //  timeout. El mensaje actual se procesa como si estuviera en MAIN_MENU.
    if (
      (effectiveState === 'AWAITING_FEEDBACK_RATING' ||
        effectiveState === 'AWAITING_FEEDBACK_COMMENT') &&
      session.feedbackRequestedAt
    ) {
      const elapsed = Date.now() - new Date(session.feedbackRequestedAt).getTime();
      if (elapsed > 20 * 60 * 1000) {
        session = await updateSessionState(phone, 'MAIN_MENU', {
          customerId: session.customerId,
          customerName: session.customerName,
          cart: [],
          pendingFeedbackOrderId: undefined,
          pendingFeedbackRating: undefined,
          feedbackRequestedAt: undefined,
        });
        msgLog.info({ elapsed }, 'Feedback timeout — silently reset to MAIN_MENU');
        // No retornamos: el mensaje se procesa normalmente en MAIN_MENU
      }
    }

    // 5f. Respuesta LLM contextual en estados post-pago
    //
    //  Cuando el cliente escribe algo en PAYMENT_UNDER_REVIEW, ORDER_IN_KITCHEN
    //  o ORDER_READY, el LLM responde de forma natural usando el contexto del
    //  pedido activo (número, items, estado, tipo de entrega, ETA).
    //  Si el LLM falla → el mensaje cae al handler del estado correspondiente.
    //
    const POST_PAYMENT_STATES: ConversationState[] = [
      'PAYMENT_UNDER_REVIEW', 'ORDER_IN_KITCHEN', 'ORDER_READY',
    ];

    if (
      POST_PAYMENT_STATES.includes(effectiveState) &&
      msg.type === 'text' &&
      msg.text &&
      msg.text.trim().length > 1 &&
      session.activeOrderId
    ) {
      // Si el cliente pide ver el menú → mostrar directamente sin LLM
      const lowerText5f = msg.text.toLowerCase().trim();
      if (['menú', 'menu', 'carta'].some((kw) => lowerText5f.includes(kw))) {
        const orderForMenu = await getOrderWithItems(session.activeOrderId).catch(() => null);
        const orderRef = orderForMenu ? `#${orderForMenu.orderNumber}` : '';
        await whatsappClient.sendMessage(
          textMessage(phone, `Tu pedido ${orderRef} sigue activo 👍\n\nAquí tienes el menú por si quieres pedir algo más:`),
        );
        await whatsappClient.sendMessage(TEMPLATES.mainMenu(phone, session.customerName ?? 'cliente'));
        void updateCustomerConversationState(customer.id, { state: effectiveState }).catch(() => undefined);
        msgLog.info({ effectiveState }, 'Menu request in post-payment state — showed main menu');
        return;
      }

      try {
        const order = await getOrderWithItems(session.activeOrderId);
        if (order) {
          const cartSummary = buildCartSummary(order.items);
          const [restaurantName, hours, etaStr] = await Promise.all([
            getConfig('RESTAURANT_NAME'),
            getConfig('RESTAURANT_HOURS'),
            getConfig('DELIVERY_ETA_MINUTES'),
          ]);
          const etaMinutes = etaStr ? parseInt(etaStr, 10) : undefined;
          const activeOrderCtx: ActiveOrderContext = {
            orderNumber: order.orderNumber,
            status: order.status,
            cartSummary,
            deliveryType: order.deliveryType as 'DELIVERY' | 'PICKUP',
            ...(order.deliveryAddress != null && { deliveryAddress: order.deliveryAddress }),
            ...(etaMinutes !== undefined && !isNaN(etaMinutes) && { estimatedMinutes: etaMinutes }),
          };
          const restaurantCtx: RestaurantContext = {
            restaurantName: restaurantName ?? 'el restaurante',
            ...(hours != null && { hours }),
          };
          const reply = await generateOrderStatusResponse(
            session.customerName ?? 'cliente',
            msg.text,
            restaurantName ?? 'el restaurante',
            activeOrderCtx,
            restaurantCtx,
            { ...(session.customerId !== undefined && { customerId: session.customerId }) },
          );
          if (reply) {
            await whatsappClient.sendMessage(textMessage(phone, reply));
            void updateCustomerConversationState(customer.id, { state: effectiveState }).catch(() => undefined);
            msgLog.info({ effectiveState, status: order.status }, 'LLM order status response sent');
            return;
          }
        }
      } catch {
        // LLM failed or order not found → fall through to handler
        msgLog.warn({ effectiveState }, 'LLM order status response failed, falling through to handler');
      }
    }

    // 6. Dispatch
    const newSession = await dispatch(effectiveState, msg, session);

    // 7. Persistir estado en DB (async — no bloquea la respuesta)
    void updateCustomerConversationState(customer.id, { state: newSession.state }).catch(
      (err: unknown) => msgLog.error({ err }, 'Failed to persist conversation state to DB'),
    );

    msgLog.info(
      { stateFrom: effectiveState, stateTo: newSession.state },
      'State transition complete',
    );
  } catch (err) {
    msgLog.error({ err }, 'Unhandled error in conversation agent');

    // Fallback: enviar mensaje de error genérico al usuario
    await whatsappClient
      .sendMessage(TEMPLATES.error(phone))
      .catch(() => undefined);
  }
}
