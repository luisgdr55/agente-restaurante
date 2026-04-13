# Estado Actual del Sistema
Última actualización: 2026-04-13

## Infraestructura
- ✅ Bot: https://yebrams.up.railway.app
- ✅ Dashboard: https://yebrams-dashboard.up.railway.app
- ✅ Login dashboard funcionando
- ✅ BD PostgreSQL con migraciones aplicadas
- ✅ Todos los workers activos
- ❌ Evolution API: descartada definitivamente

## Fase 1 — Backend Push Notifications
✅ COMPLETADA

Cambios aplicados:
- web-push instalado
- VAPID keys generadas
- PushSubscription model en Prisma + migración
- push-service.ts: sendPushToPhone()
- order-service.ts: push en PAYMENT_CONFIRMED,
  OUT_FOR_DELIVERY, DELIVERED
- POST /api/push/subscribe en dashboard.routes.ts
- Variables VAPID en .env y Railway

## Fase 2 — PWA Cliente
⏳ PENDIENTE — próxima sesión

Incluye:
- manifest.json (instalable en homescreen)
- Service Worker con cache offline
- Menú visual con fotos y categorías
- Carrito con +/-
- Selector zona delivery con precios
- Formulario checkout (nombre, teléfono, dirección)
- Modal primera visita: explicar notificaciones
- Suscripción push al aceptar notificaciones
- Upload comprobante de pago
- Link WhatsApp prellenado al confirmar pedido
- Saludo personalizado LLM para clientes recurrentes

## Fase 3 — PWA Motorizado
⏳ PENDIENTE
- Página /driver/:orderId
- Datos del pedido
- Botón Entregado

## Fase 4 — Reseñas desde PWA
⏳ PENDIENTE
- Página /review/:orderId
- Estrellas + comentario

## Fase 5 — Limpieza
⏳ PENDIENTE
- Archivar archivos WhatsApp legacy
- Eliminar Evolution API del docker-compose

## Próximo paso
Iniciar Fase 2 — PWA cliente.
Requiere material de Yebram's:
- Logo PNG
- Fotos de productos
- Colores/estilo del restaurante
- Datos pago móvil
- Zonas de delivery con precios
