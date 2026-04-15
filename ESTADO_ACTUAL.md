# Estado Actual del Sistema
Última actualización: 2026-04-15

## Infraestructura
- ✅ Bot: https://yebrams.up.railway.app
- ✅ Dashboard: https://yebrams-dashboard.up.railway.app
- ✅ PWA Cliente: https://yebramspedidos.up.railway.app
- ✅ Login dashboard funcionando
- ✅ BD PostgreSQL con migraciones aplicadas
- ✅ Todos los workers activos
- ❌ Evolution API: descartada definitivamente

## Fase 1 — Backend Push Notifications
✅ COMPLETADA Y DEPLOYADA

## Fase 2 — PWA Cliente
✅ COMPLETADA Y DEPLOYADA en https://yebramspedidos.up.railway.app

### Infraestructura client/
- ✅ Proyecto client/ Vite React TS + Dockerfile + nginx
- ✅ Deploy Railway: Root Directory = client/, Builder = Dockerfile
- ✅ nginx.conf con `listen ${PORT}` via envsubst template (fix Railway port)
- ✅ railway.toml explícito en client/

### Páginas implementadas
- ✅ MenuPage.tsx: hero 100vh layebrams.jpg, tabs categorías, grid cards, modal detalle plato
- ✅ CheckoutPage.tsx: nombre, teléfono, toggle delivery/pickup, datos pago móvil, upload comprobante base64, POST /api/public/orders
- ✅ ConfirmPage.tsx: número pedido, link WhatsApp prellenado con datos del pedido
- ✅ NotificationModal: suscripción push post-pedido, vinculada al teléfono del cliente
- ✅ Pantalla cerrado: horario automático Venezuela UTC-4 + toggle BUSINESS_ACTIVE manual

### Backend endpoints públicos (sin auth)
- ✅ GET /api/public/menu — menú completo con imageUrl
- ✅ GET /api/public/config — 14 claves + vapidPublicKey
- ✅ POST /api/public/orders — crea pedido desde web, normaliza teléfono, guarda comprobante base64

### Diseño PWA
- ✅ Hero 100vh con imagen layebrams.jpg (raw.githubusercontent.com), overlay gradiente, CTA "Ver menú ↓"
- ✅ Cards con efecto neon dorado al hover/touch (border + box-shadow #F5C518)
- ✅ Bottom sheet modal de detalle de plato: imagen 16:9, descripción completa, precio, agregar/quitar
- ✅ Tabs de categorías con backdrop-blur, tab activo dorado
- ✅ CartDrawer premium: thumbnail por ítem, total con Bs en línea separada, glow en botón
- ✅ Floating cart bar: "N ítems / Ver pedido / $total"
- ✅ Logo header: avatar "Y" dorado #F5C518 sobre fondo negro, sin dependencias externas
- ✅ Ícono PWA: emoji 🍗 en SVG circular #111111, manifest.json con rutas locales

### Service Worker v4
- ✅ Network-first para HTML/navegación (siempre HTML fresco en cada deploy)
- ✅ Cache-first para /assets/*.js y /assets/*.css (hash único por build)
- ✅ skipWaiting controlado por usuario (no automático)
- ✅ Toast "Nueva versión disponible" en React con botón Actualizar
- ✅ clients.claim() en activate

### Imágenes
- ✅ URLs actualizadas de jsDelivr a raw.githubusercontent.com (hero + logo)
- ✅ BD actualizada: 3 productos con imageUrl migrados de jsDelivr a raw.githubusercontent.com
  (layebrams, lacesar, clubhousemixto)
- ✅ Repo GitHub público — raw.githubusercontent.com accesible sin auth

## Sesión 2026-04-14 — Completado
- Migración 20260413000001_add_missing_tables aplicada en Railway
- Seed ejecutado: 19 configs, 10 categorías, 62 ítems
- Campo imageUrl agregado en formulario create/edit de MenuPage dashboard
- Backend POST/PATCH /api/menu/items acepta imageUrl

## Sesión 2026-04-15 — Completado
- imageUrl funciona en dashboard ✅
- Fotos menu yebrams cargadas en BD ✅ (layebrams, lacesar, picongreen, triplesmash, clubhousemixto)
- GitHub + raw.githubusercontent.com como CDN ✅
- PWA Cliente completa y deployada ✅

## Fase 3 — PWA Motorizado
✅ COMPLETADA (implementada en sesión anterior)
- DriverPage.tsx completa: carga pedido, muestra datos cliente+dirección+referencia, botón Confirmar Entrega
- Backend: GET /api/public/orders/:id + POST /api/public/orders/:id/delivered (sin auth)
- Push al cliente al confirmar + notificación WhatsApp admin + sendDeliveryNotifications

## Fase 4 — Reseñas desde PWA
✅ COMPLETADA (2026-04-15)
- ReviewPage.tsx completa: 5 estrellas animadas con color por rating, textarea comentario opcional
- Backend: POST /api/public/reviews/:orderId (sin auth), maneja unique constraint graciosamente
- Push notification al cliente apunta a /review/:orderId tras entrega confirmada

## Fase 5 — Limpieza
✅ COMPLETADA (2026-04-15)
- Evolution API eliminada de docker-compose.yml (servicio + volumen evolution_instances)
- evolution_db eliminado de scripts/init-db.sql
- src/agent/ conservado: importado activamente por dashboard.routes.ts (order-delivered.helper) y
  whatsapp/client.ts + message-builder.ts (tipos). No se puede mover sin romper imports.
  El código del agente conversacional sigue compilado pero no recibe tráfico (sin webhook activo).

## Sesión 2026-04-15 — Completado (Fases 3-5)

### Fase 3 pendientes — todos implementados
1. ✅ completedAt en métricas al marcar READY: prisma schema + updateOrderStatus + emitTodayStats
2. ✅ QR en dashboard al tocar "Salió a domicilio": QRCodeSVG + qrcode.react + modal
3. ✅ Push notifications: PAYMENT_CONFIRMED, READY, OUT_FOR_DELIVERY, DELIVERED desde dashboard
   También en assign-driver (cuando motorizado es asignado → OUT_FOR_DELIVERY)
4. ✅ Botón "Salió a domicilio" para READY+DELIVERY, "Cliente retiró" para READY+PICKUP
5. ✅ DELIVERED desde dashboard: sendPushToPhone antes de sendDeliveryNotifications

### Fase 4 — Reseñas desde PWA
- ReviewPage.tsx: estrellas 5 animadas con color/glow por rating, textarea comentario, dark UI
- Backend: POST /api/public/reviews/:orderId sin auth

## Al iniciar próxima sesión leer en orden
1. CLAUDE.md
2. ESTADO_ACTUAL.md

Sistema listo para uso. Próximas mejoras según feedback de Yebram's.
