# Estado Actual del Sistema
Última actualización: 2026-04-13

## Infraestructura
- ✅ Bot en Railway: https://yebrams.up.railway.app
- ✅ Dashboard en Railway: https://yebrams-dashboard.up.railway.app
- ✅ Login dashboard funcionando (PIN 123456)
- ✅ BD PostgreSQL con migraciones aplicadas
- ✅ Todos los workers activos
- Evolution API: NO desplegada aún

## Login dashboard
- ✅ RESUELTO: nginx proxea /api y /ws al bot
- Fecha: 2026-04-13

## Migración PWA — Estado: EN PROGRESO
Fases:
- Fase 0: Preparación ✅ (2026-04-13)
- Fase 1: Backend Push Notifications ✅ (2026-04-13)
- Fase 2: PWA cliente ⏳ pendiente
- Fase 3: PWA motorizado ⏳ pendiente
- Fase 4: Reseñas desde PWA ⏳ pendiente
- Fase 5: Limpieza Evolution API ⏳ pendiente

## Fase 1 — Backend Push Notifications (completada 2026-04-13)
Archivos creados/modificados:
- src/notifications/push-service.ts — sendPushToPhone()
- src/orders/order-service.ts — push en PAYMENT_CONFIRMED, OUT_FOR_DELIVERY, DELIVERED
- src/api/dashboard.routes.ts — POST /api/push/subscribe (sin JWT)
- prisma/schema.prisma — modelo PushSubscription
- prisma/migrations/20260413000000_add_push_subscriptions/

Variables VAPID agregadas en .env y env.ts:
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY
- VAPID_EMAIL=mailto:luisgdr55@gmail.com

Pendiente en Railway: agregar las 3 variables VAPID en el panel de variables de entorno.

## Decisiones arquitectónicas tomadas
- Sin WhatsApp API (ni Meta ni Evolution)
- Notificaciones via Web Push API
- WhatsApp solo como ticket prellenado
  (cliente lo envía manualmente al confirmar)
- Push notifications requieren aceptación
  del cliente — modal explicativo en primera visita
- Cliente identificado via localStorage + BD
- LLM genera saludo personalizado para recurrentes

## Archivos clave
- src/whatsapp/client.ts → META_LEGACY (no usar)
- src/whatsapp/webhook-handler.ts → META_LEGACY
- src/agent/conversation-agent.ts → DEPRECAR en Fase 5
- dashboard/nginx.conf → ✅ proxy /api y /ws configurado
- src/notifications/push-service.ts → ✅ push notifications

## Próximo paso
Fase 2 — PWA cliente:
- Agregar variables VAPID en Railway (panel de env vars)
- Service Worker en dashboard/public/sw.js
- Hook usePushNotifications en dashboard/src/
- Modal de permiso en primera visita
- Endpoint VAPID public key: GET /api/push/vapid-key
