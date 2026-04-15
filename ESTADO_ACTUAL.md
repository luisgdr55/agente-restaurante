# Estado Actual del Sistema
Última actualización: 2026-04-15

## Infraestructura deployada
| Servicio | URL | Estado |
|---|---|---|
| Bot / API | https://yebrams.up.railway.app | ✅ |
| Dashboard admin | https://yebrams-dashboard.up.railway.app | ✅ |
| PWA cliente | https://yebramspedidos.up.railway.app | ✅ |
| PostgreSQL | Railway plugin | ✅ |
| Redis | Railway plugin | ✅ |
| Evolution API | — | ❌ Descartada definitivamente |

## Flujo completo del sistema

```
Cliente abre PWA → elige ítems → checkout (nombre/tel/dirección/pago móvil/comprobante)
  → POST /api/public/orders
  → ConfirmPage guarda pedido en localStorage → muestra botón "📍 Seguir mi pedido"
  → Admin recibe push "Nuevo pedido" + comprobante
  → Admin confirma pago en dashboard → push al cliente con url /order/:id
  → Cliente ve tracking: barra de progreso 5 fases con polling 10s
  → Cocina marca READY → push al cliente
  → Admin toca "Salió a domicilio" → QR modal con link /driver/:id
  → Motorizado escanea QR, ve datos del cliente, toca "Confirmar Entrega"
  → Cliente recibe push "Entregado" con link /review/:id
  → Cliente califica 1-5 estrellas + comentario opcional
```

## Fases implementadas

### Fase 1 — Backend Push Notifications ✅
- Tabla `push_subscriptions` en BD
- `POST /api/public/push/subscribe` — guarda suscripción vinculada al teléfono (siempre 584xx)
- `sendPushToPhone(phone, title, body, url?)` — normaliza 04xx→584xx antes de buscar en BD
- VAPID keys configuradas en Railway

### Fase 2 — PWA Cliente ✅
**Páginas:**
- `MenuPage` — hero 100vh, tabs categorías, grid cards neon, modal detalle, CartDrawer, floating bar, botón push desktop
- `CheckoutPage` — nombre/teléfono, toggle delivery/pickup, dirección guardada, datos pago móvil, upload comprobante base64 (galería+cámara)
- `ConfirmPage` — número de pedido, guarda activeOrder en localStorage, botón primario "📍 Seguir mi pedido", link WhatsApp prellenado completo
- `OrderTrackingPage` — barra de progreso 5 fases, polling 10s, card PAYMENT_REJECTED con re-upload, auto-redirect desde /
- Pantalla de cerrado — horario automático Venezuela UTC-4 + toggle BUSINESS_ACTIVE

**Backend público (sin auth):**
- `GET /api/public/menu` — menú con imageUrl
- `GET /api/public/config` — 14 claves + vapidPublicKey
- `POST /api/public/orders` — crea pedido, normaliza teléfono, guarda comprobante, actualiza savedAddress
- `GET /api/public/customers/:phone` — devuelve savedAddress para checkout
- `GET /api/public/orders/:id/tracking` — status/items/totales/dirección para tracking page
- `PATCH /api/public/orders/:id/payment-proof` — sube nuevo comprobante → PAYMENT_UPLOADED
- `DELETE /api/public/orders/:id` — cancela pedido (solo PAYMENT_REJECTED/PENDING/UPLOADED)

**Infraestructura:**
- Vite React TS + Dockerfile + nginx con `listen ${PORT}` envsubst
- Service Worker v4: network-first HTML, cache-first assets, toast "Nueva versión"
- Imágenes en GitHub (raw.githubusercontent.com) como CDN gratuito

### Fase 3 — PWA Motorizado ✅
- `DriverPage` (`/driver/:orderId`) — carga datos pedido, cliente/dirección/referencia, teléfono clickeable, botón "Confirmar Entrega"
- `GET /api/public/orders/:id` — datos mínimos, solo expone OUT_FOR_DELIVERY y DELIVERED
- `POST /api/public/orders/:id/delivered` — cierra pedido, push al cliente, WhatsApp admin
- QR modal en dashboard (`qrcode.react`) al tocar "🛵 Salió a domicilio" y en OUT_FOR_DELIVERY

### Fase 4 — Reseñas desde PWA ✅
- `ReviewPage` (`/review/:orderId`) — 5 estrellas animadas, label descriptivo, textarea opcional
- `POST /api/public/reviews/:orderId` — sin auth, valida DELIVERED

### Fase 5 — Limpieza ✅
- Evolution API eliminada de `docker-compose.yml`
- `src/agent/` conservado pero sin tráfico activo

### Fase 6 — Fixes y mejoras UX ✅

#### Fix: Upload comprobante — galería + cámara
- Eliminado `capture="environment"` — el OS muestra selector nativo

#### Fix: Dirección guardada en Checkout
- Fetch con debounce 600ms al ingresar teléfono
- Card dorada "📍 Dirección anterior" con botones Usar esta / Ingresar otra
- Backend actualiza `savedAddress` al confirmar delivery

#### Fix: Botón "Vaciar carrito" en CartDrawer
- Botón 🗑️ con confirm() nativo, cierra drawer al confirmar

#### Fix: Migración orderNumber
- Columna `orderNumber` añadida vía migración `20260415000002_add_order_number`
- Aplicada manualmente en Railway con `prisma migrate deploy`

#### Fix: Mensaje WhatsApp prellenado completo
- Incluye: nombre, #pedido, ítems con precios, total USD+Bs, delivery/pickup, datos pago móvil

#### Feature: Comprobante + OCR en dashboard
- `GET /api/orders/:id/proof` — imagen on-demand
- `POST /api/orders/:id/ocr-payment` — Claude vision extrae datos del comprobante
- `serializeOrders()` reemplaza paymentImageUrl por `hasPaymentImage: boolean` en listings

#### Feature: Push notifications en desktop/MenuPage
- Botón "🔔 Activar notificaciones" solo si permission=default y hay pedido previo

### Fase 7 — Comunicación PWA↔Backend (sesión 2026-04-15) ✅

#### Cambio 1 — Normalización teléfono en push subscriptions
- `push-service.ts`: `normalizePhone()` convierte 04xx→584xx antes de buscar suscripción
- `POST /api/push/subscribe`: guarda siempre en formato 584xx con `normalizeDriverPhone`
- Cobertura doble: normalización en origen + en búsqueda

#### Cambio 2 — Push en TODOS los cambios de status
Todos los status ahora envían push con `url: /order/:id` para llevar al tracking:
- `PAYMENT_CONFIRMED` → "✅ Pago confirmado, tu pedido está en cocina 👨‍🍳"
- `PAYMENT_REJECTED` → "❌ Tu pago no fue verificado" (nuevo)
- `IN_KITCHEN` → "👨‍🍳 Tu pedido está en cocina" con ETA (nuevo)
- `READY` → "🍗 Tu pedido está listo"
- `OUT_FOR_DELIVERY` → "🛵 Tu pedido va en camino"
- `DELIVERED` → "✅ Entregado" → url /review/:id
- `CANCELLED` → "❌ Pedido cancelado" (nuevo)

#### Cambio 3 — Página de tracking /order/:orderId
- Barra de progreso 5 fases: 📋 Recibido → ✅ Pago → 👨‍🍳 Cocina → 🛵 En camino → 🎉 Entregado
- Fase activa: glow dorado. Fases completadas: verde. Pendientes: gris. Transición animada
- Polling cada 10s a `GET /api/public/orders/:id/tracking`
- `PAYMENT_REJECTED`: card roja con upload nuevo comprobante + botón cancelar pedido
- `DELIVERED`: botón "⭐ Dejar reseña" + "Hacer otro pedido"
- Al llegar a DELIVERED/CANCELLED: limpia localStorage + carrito
- `ConfirmPage`: guarda `{ orderId, orderNumber, status, phone }` en localStorage
- `ConfirmPage`: botón primario "📍 Seguir mi pedido" (CTA principal)
- `App.tsx`: `ActiveOrderGuard` — al abrir `/`, si hay pedido activo no terminal, redirige a `/order/:id`
- `App.tsx`: ruta `/order/:orderId` → `OrderTrackingPage`

#### Cambio 4 — Endpoints backend para tracking
- `GET /api/public/orders/:id/tracking` — todos los status permitidos, devuelve items/totales/dirección
- `PATCH /api/public/orders/:id/payment-proof` — nuevo comprobante → PAYMENT_UPLOADED + socket + push admin
- `DELETE /api/public/orders/:id` — cancela si PAYMENT_REJECTED/PENDING_PAYMENT/PAYMENT_UPLOADED + socket + push admin

## Próximos pasos recomendados

1. [ ] Prueba end-to-end completa en producción (ver checklist)
2. [ ] Verificar que push llega al tocar notificación → abre /order/:id correctamente
3. [ ] Verificar auto-redirect al abrir PWA con pedido activo en localStorage
4. [ ] Probar PAYMENT_REJECTED: re-upload comprobante desde tracking page

## Checklist end-to-end

1. [ ] Abrir PWA, hacer pedido completo con comprobante
2. [ ] ConfirmPage muestra botón "📍 Seguir mi pedido" → abre tracking con fase 0
3. [ ] Cerrar PWA, volver a abrir → redirige automáticamente a /order/:id
4. [ ] Admin confirma pago → push llega → al tocar abre /order/:id en fase Pago/Cocina
5. [ ] Dashboard muestra "Ver comprobante 🧾" → OCR extrae datos
6. [ ] Cocina marca READY → push llega con url tracking
7. [ ] Admin toca "Salió a domicilio" → QR modal → motorizado confirma
8. [ ] Cliente recibe push "Entregado" → toca → abre /review/:id
9. [ ] Tracking page detecta DELIVERED → limpia localStorage → carrito vacío
10. [ ] Segundo pedido: dirección guardada aparece en checkout
11. [ ] Simular PAYMENT_REJECTED → cliente ve card roja en tracking → sube nuevo comprobante

## Notas de deploy (Railway)

- Migración `20260415000002_add_order_number` ya aplicada manualmente en Railway
- DATABASE_URL Railway: `postgresql://postgres:HwiyNRSVYSAFcKqxCTUENuErFrnEladk@metro.proxy.rlwy.net:37303/railway`
- Las migraciones siguientes se aplican automáticamente vía `prisma migrate deploy`

## Al iniciar próxima sesión leer en orden
1. CLAUDE.md
2. ESTADO_ACTUAL.md
