# Estado Actual del Sistema
Última actualización: 2026-04-25

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
  → Cliente ve tracking: barra de progreso 5 fases + socket.io tiempo real + polling 10s
  → Cocina marca READY → push al cliente
  → Admin toca "Salió a domicilio" → QR modal con link /driver/:id
  → Motorizado escanea QR, ve datos del cliente, toca "Confirmar Entrega"
  → Cliente recibe push "Entregado" con link /review/:id
  → Cliente califica 1-5 estrellas + comentario opcional → redirige a / después de 2s
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
- `CheckoutPage` — nombre/teléfono/dirección pre-rellenados desde localStorage, toggle delivery/pickup, dirección guardada desde BD, datos pago móvil, upload comprobante base64 (galería+cámara)
- `ConfirmPage` — número de pedido, guarda activeOrder en localStorage, botón primario "📍 Seguir mi pedido", link WhatsApp prellenado completo
- `OrderTrackingPage` — barra de progreso 5 fases, **socket.io tiempo real** + polling 10s fallback, card PAYMENT_REJECTED con re-upload, auto-redirect desde /
- `ReviewPage` — 5 estrellas animadas, label descriptivo, textarea opcional, **redirect a / después de 2s** + limpia localStorage
- Pantalla de cerrado — horario automático Venezuela UTC-4 + toggle BUSINESS_ACTIVE

**localStorage del cliente:**
| Clave | Contenido |
|---|---|
| `yebrams_active_order` | `{ orderId, orderNumber, status, phone }` |
| `yebrams_cart` | items del carrito |
| `yebrams_last_phone` | teléfono para push subscription |
| `yebrams_customer_name` | nombre pre-rellena Checkout |
| `yebrams_customer_phone` | teléfono pre-rellena Checkout |
| `yebrams_customer_address` | dirección pre-rellena Checkout (DELIVERY) |

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
- Al enviar: limpia `yebrams_active_order` + `yebrams_cart`, muestra agradecimiento 2s, redirige a `/`

### Fase 5 — Limpieza ✅
- Evolution API eliminada de `docker-compose.yml`
- `src/agent/` conservado pero sin tráfico activo

### Fase 6 — Fixes y mejoras UX ✅
- Upload comprobante: eliminado `capture="environment"` — OS muestra selector nativo
- Dirección guardada en Checkout: fetch debounce 600ms, card dorada "📍 Dirección anterior"
- Botón "Vaciar carrito" en CartDrawer: 🗑️ con confirm() nativo
- Migración `orderNumber`: columna añadida vía `20260415000002_add_order_number`, aplicada en Railway
- Mensaje WhatsApp prellenado: nombre, #pedido, ítems con precios, total USD+Bs, delivery/pickup, datos pago móvil
- Comprobante + OCR en dashboard: `GET /api/orders/:id/proof` + `POST /api/orders/:id/ocr-payment` (Claude vision)
- Push notifications en desktop/MenuPage: botón "🔔 Activar notificaciones" si permission=default

### Fase 7 — Comunicación PWA↔Backend ✅

#### Cambio 1 — Normalización teléfono en push subscriptions
- `push-service.ts`: `normalizePhone()` convierte 04xx→584xx antes de buscar suscripción
- `POST /api/push/subscribe`: guarda siempre en formato 584xx
- **Migración manual en Railway** (2026-04-16): UPDATE push_subscriptions SET phone = '58' || SUBSTRING(phone, 2) WHERE phone LIKE '04%' AND LENGTH(phone) = 11 — 2 registros actualizados

#### Cambio 2 — Push en TODOS los cambios de status
- `PAYMENT_CONFIRMED` → "✅ Pago confirmado, tu pedido está en cocina 👨‍🍳"
- `PAYMENT_REJECTED` → "❌ Tu pago no fue verificado"
- `IN_KITCHEN` → "👨‍🍳 Tu pedido está en cocina" con ETA
- `READY` → "🍗 Tu pedido está listo"
- `OUT_FOR_DELIVERY` → "🛵 Tu pedido va en camino"
- `DELIVERED` → "✅ Entregado" → url /review/:id
- `CANCELLED` → "❌ Pedido cancelado"

#### Cambio 3 — Página de tracking /order/:orderId
- Barra de progreso 5 fases: 📋 Recibido → ✅ Pago → 👨‍🍳 Cocina → 🛵 En camino → 🎉 Entregado
- **Socket.io tiempo real**: conecta directo al backend con `transports: ['websocket']`; escucha `order:updated` — actualización instantánea cuando admin cambia status
- Polling 10s como fallback
- `PAYMENT_REJECTED`: card roja con upload nuevo comprobante + botón cancelar
- `DELIVERED`: botón "⭐ Dejar reseña" + "Hacer otro pedido"
- Al terminal: limpia localStorage + carrito

#### Cambio 4 — Endpoints backend para tracking
- `GET /api/public/orders/:id/tracking` — todos los status permitidos
- `PATCH /api/public/orders/:id/payment-proof` — nuevo comprobante → PAYMENT_UPLOADED
- `DELETE /api/public/orders/:id` — cancela si PAYMENT_REJECTED/PENDING/UPLOADED

### Fase 8 — Fixes sesión 2026-04-16 ✅

#### Fix crítico: comprobante no llegaba a la BD
- **Root cause**: `CreateOrderInput` no declaraba `paymentImageUrl` — el spread en el caller era silenciosamente ignorado por `createOrder()`
- **Fix**: añadido `paymentImageUrl?: string` a `CreateOrderInput` + `...(input.paymentImageUrl !== undefined && { paymentImageUrl: input.paymentImageUrl })` en `prisma.order.create`
- Los 3 pedidos previos con comprobante quedaron con NULL en BD (irrecuperable); los nuevos quedan correctos

#### Fix: suscripciones push en formato incorrecto
- Las 2 suscripciones en Railway estaban guardadas como `04xx` (pre-deploy)
- `sendPushToPhone` buscaba en `584xx` → no encontraba → push no llegaba
- **Fix data**: UPDATE manual en Railway, ambas normalizadas a `584xx`

#### UX: autocompletado en Checkout
- `name` lee/escribe `yebrams_customer_name`
- `phone` lee/escribe `yebrams_customer_phone`
- `address` lee/escribe `yebrams_customer_address` (DELIVERY únicamente)

#### UX: redirect post-reseña
- Después de enviar reseña exitosa → limpia `yebrams_active_order` + `yebrams_cart` → muestra agradecimiento 2s → redirige a `/`

## Sesión 2026-04-23 — Limpieza código muerto + fixes Dockerfile

### Limpieza dashboard.routes.ts ✅
- Eliminado todo el código muerto de WhatsApp API: `whatsappClient`, `TEMPLATES`,
  `textMessage`, `buttonMessage`, `sendDeliveryNotifications`, `buildCartSummary`
- Push notifications quedan como único canal de notificación desde el dashboard
- `prisma` movido de `devDependencies` a `dependencies` en package.json

### Dockerfile — estado final ✅
- Restaurado al Dockerfile original del initial commit (el que funcionaba)
- `COPY . .` en builder + `npx prisma generate`
- `COPY prisma ./prisma` en production (del build context)
- `.dockerignore` agregado (node_modules, dist, .env, etc. — no excluye prisma/)

## Sesión 2026-04-24 — Fixes Railway deploy + PWA menú visible ✅

### Fix backend Dockerfile — COPY prisma desde builder ✅
- Root cause: `COPY prisma ./prisma` en etapa `production` fallaba porque el build
  context no está disponible en esa etapa, solo en `builder`
- Fix: cambiado a `COPY --from=builder /app/prisma ./prisma`

### Fix client/railway.toml — Dockerfile incorrecto ✅
- Root cause: `dockerfilePath = "Dockerfile"` se resolvía al `Dockerfile` raíz
  (backend), no al `client/Dockerfile` — Railway ejecutaba el Dockerfile del
  backend con build context de `client/` (sin `prisma/`) → `npx prisma generate` fallaba
- Fix: eliminado `dockerfilePath` de `client/railway.toml` para que Railway
  auto-detecte `Dockerfile` dentro del `root_dir=client`
- También: `client/nginx.conf` eliminado, Dockerfile simplificado a single-stage con `serve`

### Fix CORS producción ✅
- Root cause: `origin: false` en producción bloqueaba todas las peticiones
  cross-origin desde `yebramspedidos.up.railway.app`
- Fix: `origin: [/\.up\.railway\.app$/, /localhost/]` en `src/index.ts`

### Fix URLs relativas en cliente ✅
- Root cause: `serve` no tiene proxy, las peticiones a `/api/public` iban
  a la PWA en lugar del backend
- Fix: `baseURL` en `api.ts` y llamadas en `NotificationModal.tsx` y `MenuPage.tsx`
  usan URL absoluta con fallback `https://yebrams.up.railway.app`

## Sesión 2026-04-25 — Fixes post-deploy PWA + CORS + SW hash automático ✅

### Fix: hasPaymentImage faltaba en eventos socket ✅
- **Root cause**: `emitOrderUpdated` y `emitOrderNew` pasaban el objeto Prisma crudo
  (con `paymentImageUrl` como string o null) en lugar del objeto serializado
  que el dashboard espera (`hasPaymentImage: boolean`)
- **Fix dashboard.routes.ts**: nueva función `serializeOrder()` (singular) que
  elimina `paymentImageUrl` y añade `hasPaymentImage: Boolean(paymentImageUrl)`;
  aplicada en los 6 `emitOrderUpdated()` del archivo
- **Fix order-service.ts**: helper `stripPaymentImage()` aplicado a `emitOrderNew`
  y `emitOrderUpdated` en `createOrder()` y `updateOrderStatus()`
- Resultado: botón "Ver comprobante" aparece en tiempo real sin necesidad de F5

### Fix: 413 Payload Too Large al subir comprobante ✅
- **Root cause**: Fastify tiene bodyLimit de 1 MB por defecto; imágenes de móvil
  superan ese límite fácilmente en base64
- **Fix backend** (`src/index.ts`): `bodyLimit: 10 * 1024 * 1024` (10 MB)
- **Fix cliente** (`CheckoutPage.tsx`): compresión canvas antes de base64 —
  resize a max 1200px, calidad JPEG 0.7; función `compressAndEncode()`

### Fix: tracking page no actualizaba en tiempo real ✅
- **Root cause**: `OrderTrackingPage.tsx` usaba `axios` con URLs relativas (`/api/...`)
  — `serve` no tiene proxy, las peticiones iban a la PWA en lugar del backend
- **Fix**: migrado a `publicApi` (misma instancia de api.ts con baseURL absoluta)

### Fix: SW cache no se invalidaba en móvil ✅
- **Root cause**: `CACHE_VERSION` era la misma entre deploys; el browser veía el
  mismo SW y no activaba el ciclo de actualización
- **Fixes iterativos**: bumps manuales 4→5→6→7, luego solución permanente:

### Mejora: hash de build automático en Service Worker ✅
- **Problema**: había que incrementar `CACHE_VERSION` manualmente en cada deploy
- **Solución** (`client/vite.config.ts`): plugin Vite `inject-sw-hash` que en
  `closeBundle` lee `dist/sw.js` y reemplaza el placeholder `__VITE_BUILD_HASH__`
  con `Date.now()` generado al inicio del build
- **`client/public/sw.js`**: eliminadas las líneas `CACHE_VERSION`/`CACHE_NAME`;
  ahora tiene `const CACHE_NAME = 'yebrams-__VITE_BUILD_HASH__';`
- Cada deploy Railway genera un cache key único sin intervención manual
- Verificado: `sw.js` en producción muestra `yebrams-1777077668461`

### Fix: botón cancelar silencioso en PWA standalone ✅
- **Root cause**: `window.confirm()` está bloqueado en PWA standalone mode en
  móviles (retorna false sin mostrar nada)
- **Fix**: reemplazado por modal inline React con estado `cancelConfirmOpen`;
  botones "Sí, cancelar" y "No, volver" dentro del propio componente

### Fix: URLs relativas en DriverPage y ReviewPage ✅
- `DriverPage.tsx` y `ReviewPage.tsx` usaban `fetch('/api/public/...')` relativo
- Migrados a `publicApi` (axios con baseURL absoluta) igual que `OrderTrackingPage`
- Eliminada interfaz `OrderInfo` local en DriverPage (usa `OrderPublic` de api.ts)

### Fix: CORS métodos explícitos ✅
- `src/index.ts`: añadidos `methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS']`
  y `preflightContinue: false` al plugin `@fastify/cors`
- Garantiza que preflight OPTIONS del DELETE no caiga en 404

## Pendientes próxima sesión

- [ ] Menú: agregar categoría "Bebidas" con imagen del menú visual
      (el usuario la enviará en la próxima sesión)
- [ ] Verificar que el botón "Cancelar pedido" funciona en móvil tras
      el fix de CORS explícito (era el único pendiente de confirmar)

## Notas de deploy (Railway)

- Migración `20260415000002_add_order_number` ya aplicada manualmente en Railway
- DATABASE_URL Railway: `postgresql://postgres:HwiyNRSVYSAFcKqxCTUENuErFrnEladk@metro.proxy.rlwy.net:37303/railway`
- Las migraciones siguientes se aplican automáticamente vía `prisma migrate deploy`

## Al iniciar próxima sesión leer en orden
1. CLAUDE.md
2. ESTADO_ACTUAL.md
