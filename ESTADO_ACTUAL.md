# Estado Actual del Sistema
Última actualización: 2026-04-14

## Infraestructura
- ✅ Bot: https://yebrams.up.railway.app
- ✅ Dashboard: https://yebrams-dashboard.up.railway.app
- ✅ Login dashboard funcionando
- ✅ BD PostgreSQL con migraciones aplicadas
- ✅ Todos los workers activos
- ❌ Evolution API: descartada definitivamente

## Fase 1 — Backend Push Notifications
✅ COMPLETADA Y DEPLOYADA

Cambios aplicados:
- web-push instalado
- VAPID keys generadas
- PushSubscription model en Prisma + migración
- push-service.ts: sendPushToPhone()
- order-service.ts: push en PAYMENT_CONFIRMED,
  OUT_FOR_DELIVERY, DELIVERED
- POST /api/push/subscribe en dashboard.routes.ts
- Variables VAPID en .env y Railway
- VAPID_EMAIL fix: z.string().min(1) (acepta formato mailto:)
- Bot corriendo en Railway sin errores
- Push notifications backend funcional

## Sesión 2026-04-14 — Completado
- Migración 20260413000001_add_missing_tables aplicada en Railway
- Seed ejecutado exitosamente: 19 configs, 10 categorías, 62 ítems
- Dashboard muestra menú correctamente
- Campo imageUrl agregado en formulario create/edit de MenuPage.tsx
- Backend POST /api/menu/items acepta imageUrl
- Columna imageUrl ya existía en menu_items (schema.prisma)

## Decisión pendiente — Almacenamiento de imágenes
Confirmar al inicio de próxima sesión:
- **Opción A**: Railway Volume (requiere endpoint upload en backend)
- **Opción B**: Cloudinary gratuito (más simple, 25GB, sin backend extra)

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

Requiere antes de empezar:
- Decisión sobre almacenamiento de imágenes (Opción A o B)
- Fotos de productos de Yebram's
- Zonas delivery con precios
- Número WhatsApp del restaurante

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

## Al iniciar próxima sesión leer en orden
1. CLAUDE.md
2. ESTADO_ACTUAL.md
3. FEATURES.md
