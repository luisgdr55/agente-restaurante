/**
 * Handler del menú visual (fotos).
 *
 * Flujo:
 *   1. Cliente escribe algo como "quiero ver el menú de fotos" en cualquier estado de navegación
 *   2. isVisualMenuRequest() detecta la intención (regex + LLM como fallback)
 *   3. handleVisualMenuRequest() envía las imágenes configuradas y pone al cliente en BUILDING_ORDER
 *
 * Las imágenes se cargan desde Redis (media IDs guardados por el admin con /menuimg).
 * Si no hay imágenes configuradas, responde indicando que el menú visual no está disponible.
 */
import type { IncomingMessage } from '../types';
import type { SessionData } from '../../redis/session-manager';
import { updateSessionState } from '../../redis/session-manager';
import { whatsappClient } from '../../whatsapp/client';
import { textMessage, imageMessage } from '../../whatsapp/message-builder';
import { getMenuImages } from '../../menu/menu-images-service';
import { logger } from '../../utils/logger';

// ─── Detección de intención ───────────────────────────────────────────────────

// Patrones que indican que el cliente quiere ver el menú visual/fotos
const VISUAL_MENU_PATTERNS: RegExp[] = [
  // "menú visual / de fotos / en fotos / en imagen(es) / con fotos / con imagen(es) / completo"
  /men[uú]\s*(visual|de\s*fotos?|en\s*fotos?|en\s*im[aá]genes?|con\s*fotos?|con\s*im[aá]genes?|gr[aá]fico|completo)/i,
  // "fotos / imágenes del menú / de los platos"
  /fotos?\s*(del?\s*men[uú]|de\s*(los?\s*)?platos?|del?\s*cat[aá]logo)/i,
  /im[aá]genes?\s*(del?\s*men[uú]|de\s*(los?\s*)?platos?)/i,
  // "ver foto del menú" / "ver el menú en foto / con imagen"
  /ver\s+(fotos?|im[aá]genes?)\s*(del?\s*men[uú])?/i,
  /ver\s+(el\s*)?men[uú]\s*(en|con)\s*(fotos?|im[aá]genes?)/i,
  /ver\s+(el\s*)?men[uú]\s*(visual|completo)/i,
  // "mándame / envíame el menú en fotos / con imágenes / completo"
  /m[aá]ndame\s*(el\s*)?men[uú]\s*(en|con|de)?\s*(fotos?|im[aá]genes?|completo)?/i,
  /env[ií]ame\s*(el\s*)?men[uú]\s*(en|con)?\s*(fotos?|im[aá]genes?)/i,
  // "muéstrame el menú" (cualquier variante)
  /mu[eé]strame\s+(el\s*)?men[uú]/i,
  // "quiero ver fotos / imágenes / el menú en fotos"
  /quiero\s+ver\s+(fotos?|im[aá]genes?)/i,
  /quiero\s+ver\s+el\s*men[uú]\s*(en|con)\s*(fotos?|im[aá]genes?)/i,
  // "catálogo" / "carta visual / con fotos"
  /cat[aá]logo(\s+de\s+platos?)?/i,
  /carta\s*(digital|visual|completa|con\s*fotos?|de\s*fotos?|con\s*im[aá]genes?)/i,
  // "tienen fotos / imágenes del menú?"
  /tienen\s+(fotos?|im[aá]genes?)\s*(del?\s*men[uú])?/i,
  /hay\s+(fotos?|im[aá]genes?)\s*(del?\s*men[uú])?/i,
];

export function isVisualMenuRequest(text: string): boolean {
  return VISUAL_MENU_PATTERNS.some((p) => p.test(text));
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleVisualMenuRequest(
  msg: IncomingMessage,
  session: SessionData,
): Promise<SessionData> {
  const { phone } = msg;

  const images = await getMenuImages();

  if (images.length === 0) {
    // No hay imágenes configuradas — informar al cliente y continuar con menú normal
    await whatsappClient.sendMessage(
      textMessage(
        phone,
        '📋 El menú visual no está disponible en este momento.\n\n' +
          'Puedes ver nuestros productos usando el menú interactivo. ' +
          'Escribe lo que deseas pedir y te ayudo 😊',
      ),
    );
    return session;
  }

  // Aviso antes de enviar las fotos
  await whatsappClient.sendMessage(
    textMessage(phone, '📸 Aquí está nuestro menú completo:'),
  );

  // Enviar cada imagen en orden
  for (const mediaId of images) {
    try {
      await whatsappClient.sendMessage(imageMessage(phone, mediaId, undefined, true));
    } catch (err) {
      logger.warn({ err, mediaId }, 'Failed to send menu image');
    }
  }

  // Mensaje final invitando al pedido
  await whatsappClient.sendMessage(
    textMessage(
      phone,
      '¡Listo! Cuando decidas qué quieres, escríbeme tu pedido y te lo preparo. 😊\n\n' +
        '_Ejemplo: "quiero una hamburguesa y una coca-cola"_',
    ),
  );

  logger.info({ phone, imageCount: images.length }, 'Visual menu sent');

  // Transicionar a BUILDING_ORDER para que el cliente pueda escribir su pedido libremente
  return updateSessionState(phone, 'BUILDING_ORDER', {
    customerId: session.customerId,
    customerName: session.customerName,
    cart: session.cart ?? [],
    deliveryType: session.deliveryType,
    deliveryAddress: session.deliveryAddress,
  });
}
