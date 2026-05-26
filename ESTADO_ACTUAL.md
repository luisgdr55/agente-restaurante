# Estado Actual del Sistema
Última actualización: 2026-05-05

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

## Sesión 2026-04-25 (continuación 2) — Diagnóstico y fixes de rendimiento dashboard ✅

### Diagnóstico rendimiento backend ✅
- Latencia base Railway: ~600-900ms (red, inevitable)
- Root cause queries lentas: `GET /api/orders` y `/api/orders/today` cargaban
  `paymentImageUrl` (base64 ~200-500KB/pedido) desde PostgreSQL y lo descartaban
  en `serializeOrder` — potencialmente MBs de transferencia inútil por carga
- Índices DB: ya presentes (`status`, `createdAt`, `status+createdAt`) — no requería acción

### Fix: excluir blob paymentImageUrl de queries de lista ✅
- `src/api/dashboard.routes.ts`: nueva función `listOrders(where, orderBy)` que
  ejecuta **dos queries en paralelo**: (1) `findMany` con `select` explícito que
  excluye `paymentImageUrl`, (2) query ligera `SELECT id WHERE paymentImageUrl IS NOT NULL`
- Resultado: `hasPaymentImage` se calcula sin cargar el blob desde PostgreSQL
- `serializeOrder` se conserva solo para mutaciones de registro único (PATCH status, upload)
- Constante `ORDER_SCALAR_SELECT` con todos los campos escalares de `Order` (sin blob)

### Fix CRÍTICO: dashboard hacía requests a sí mismo ✅
- Root cause: `dashboard/src/api/api.ts` tenía `baseURL: '/api'` — con `serve` sin
  proxy, las requests iban a `yebrams-dashboard.up.railway.app/api/...` → 502
- `dashboard/src/socket/socket.ts`: fallback `VITE_API_URL ?? ''` conectaba WebSocket
  al host del dashboard en vez del backend → conexión fallida
- Fix `api.ts`: `baseURL: \`${VITE_API_URL ?? 'https://yebrams.up.railway.app'}/api\``
- Fix `socket.ts`: fallback cambiado a `'https://yebrams.up.railway.app'`
- **Nota**: fix deployado pero pendiente verificación — el bug puede persistir

## Sesión 2026-04-25 (continuación) — Fixes dashboard estabilidad ✅

### Fix: modal comprobante detrás de cards (z-index) ✅
- **Root cause**: modal renderizado dentro del DOM de la card — si algún ancestro
  crea un stacking context, `z-index: 9999` queda atrapado
- **Fix**: ambos modales (QR y comprobante) migrados a `createPortal(modal, document.body)`
  — se renderizan directamente en `<body>`, fuera de cualquier stacking context

### Fix: sección "Pedidos" atascada en "Cargando pedidos..." ✅
- **Root cause**: `Promise.all([getActive(), getToday()])` — si cualquiera de las
  dos requests se cuelga sin resolver ni rechazar (timeout silencioso del proxy nginx),
  el `await` espera indefinidamente y `finally` nunca corre
- **Fix**: cambiado a `Promise.allSettled` + timeout explícito de 10s por request
  vía `Promise.race`. Si una falla, la otra sigue. `setLoading(false)` garantizado.

### Feat: alerta sonora en pedido nuevo ✅
- `DashboardPage.tsx`: función `playNewOrderAlert()` con Web Audio API pura
  (3 beeps ascendentes A5→C6→E6, 120ms c/u, sin archivos externos ni librerías)
  disparada en el handler `order:new` del socket

### Fix: transports WebSocket en dashboard y cocina ✅
- `socket.ts` y `KitchenPage.tsx`: añadido `transports: ['websocket']`
  para forzar WS directo y eliminar HTTP polling inicial

## Sesión 2026-04-25 (continuación 2) — Resumen completo de fixes ✅

### ✅ Fix: "Ver comprobante" sin F5 — serializeOrder en todos los emitOrderUpdated
- Aplicado `serializeOrder()` (elimina blob, añade `hasPaymentImage`) en los 6
  `emitOrderUpdated()` de `dashboard.routes.ts` y en `order-service.ts`
- Resultado: botón aparece en tiempo real, sin recargar página

### ✅ Fix: 413 Payload Too Large al subir comprobante
- Backend: `bodyLimit: 10 * 1024 * 1024` en `src/index.ts`
- Cliente: compresión canvas en `CheckoutPage.tsx` — resize máx 1200px, calidad JPEG 0.7

### ✅ Fix: URLs relativas en DriverPage y ReviewPage
- Migrados de `fetch('/api/public/...')` a instancia `publicApi` con baseURL absoluta

### ✅ Fix: window.confirm bloqueado en PWA standalone (botón cancelar)
- Reemplazado por modal inline React con estado `cancelConfirmOpen`
- Botones "Sí, cancelar" y "No, volver" dentro del componente

### ✅ Fix: CORS para DELETE — methods explícito
- `src/index.ts`: añadidos `methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS']`
  y `preflightContinue: false` al plugin `@fastify/cors`

### ✅ Fix CRÍTICO: dashboard hacía requests a sí mismo (URLs relativas)
- `dashboard/src/api/api.ts`: `baseURL: '/api'` → `baseURL: \`${BACKEND}/api\``
  con `BACKEND = import.meta.env.VITE_API_URL ?? 'https://yebrams.up.railway.app'`
- `kitchenAxios` (línea 201): mismo fix — también usaba `'/api'`
- `dashboard/src/socket/socket.ts`: fallback `''` → `'https://yebrams.up.railway.app'`
- `KitchenPage.tsx` socket: fallback `''` → `'https://yebrams.up.railway.app'`
- Resultado: todas las pestañas del dashboard (Config, Finanzas, Menú, Cocina) cargan

### ✅ Mejora: CACHE_VERSION automático con hash de build (Service Worker)
- Plugin Vite `inject-sw-hash` en `client/vite.config.ts` — reemplaza
  `__VITE_BUILD_HASH__` en `sw.js` con `Date.now()` al final de cada build
- `client/public/sw.js`: `const CACHE_NAME = 'yebrams-__VITE_BUILD_HASH__'`
- Cada deploy genera cache key único sin intervención manual

### ✅ Mejora: transports: ['websocket'] en dashboard y cocina
- Fuerza WS directo, elimina polling HTTP inicial

### ✅ Mejora: modal comprobante con createPortal — fix z-index definitivo
- Ambos modales (QR y comprobante) renderizados en `document.body` fuera de
  cualquier stacking context

### ✅ Mejora: alerta sonora en pedido nuevo (Web Audio API)
- 3 beeps ascendentes A5→C6→E6 sin archivos externos

### ✅ Fix: queries de lista excluyen paymentImageUrl (performance BD)
- `listOrders()` con `select` explícito + query paralela para `hasPaymentImage`
- Evita cargar blob base64 (~200-500KB/pedido) en cada carga de dashboard

### ✅ Fix: flujo PICKUP diferenciado
- `OrderTrackingPage.tsx`: barra progreso 4 fases para PICKUP, 5 para DELIVERY
- Mensaje "Pasa a retirarlo" en READY para PICKUP
- Backend: `POST /api/public/orders/:id/delivered` acepta `READY + PICKUP` además de `OUT_FOR_DELIVERY`

### ✅ Validación: comprobante obligatorio en Checkout
- `CheckoutPage.tsx`: estado `proofError`, borde rojo en upload, mensaje inline
  "Debes subir el comprobante de pago", bloquea submit si `!proofFile`

### ✅ UX: card PAYMENT_REJECTED — tono advertencia en vez de error
- `OrderTrackingPage.tsx`: fondo/borde cambiados de rojo a ámbar `rgba(245,158,11,…)`
- Icono ❌ 2.5rem → ⚠️ 1.5rem
- Título: "Tu pago no pudo verificarse" → "Necesitamos verificar tu pago" en `#f59e0b`
- Subtítulo: "Por favor sube un nuevo comprobante o cancela si lo prefieres"
- Botón cancelar: borde rojo → neutro `#3A3A3A`, color `var(--text-muted)`
- Modal de confirmación cancelar: también pasado a tono ámbar

## Sesión 2026-04-25 (continuación 3) — Pago efectivo, referencia texto, animaciones ✅

### ✅ Checkout: clipboard copiar datos pago móvil
- Botones 📋 individuales por campo (banco, teléfono, cédula, monto) + "📋 Copiar todos los datos"
- `copyToClipboard(text, field)`: `navigator.clipboard.writeText()` + feedback ✓ verde 1.5s por campo
- "Copiar todos" NO incluye el titular (solo banco, RIF, teléfono, monto)

### ✅ Checkout: efectivo/divisas para PICKUP
- Selector toggle "📱 Pago Móvil" | "💵 Efectivo / Divisas" visible solo cuando `deliveryType === 'PICKUP'`
- CASH: oculta sección pago móvil y upload; muestra card verde "💵 Pagas al retirar en el local"
- Al cambiar a DELIVERY: resetea a `'PAGO_MOVIL'` automáticamente
- Backend: `isCash = paymentMethod === 'CASH' && deliveryType === 'PICKUP'`; persiste `CASH_ON_DELIVERY` en Prisma

### ✅ Checkout: referencia de texto sin imagen como alternativa
- Input "Número de referencia (opcional)" bajo el botón de upload
- Validación: `paymentMethod === 'PAGO_MOVIL' && !proofFile && !paymentRef.trim()` → error
- Backend: guarda referencia con `prisma.order.update({ data: { paymentReference } })` post-create

### ✅ Dashboard OrderCard: botones confirmar/rechazar para pedidos con referencia de texto
- Condición extendida: `order.status === 'PAYMENT_UPLOADED' || (order.status === 'PENDING_PAYMENT' && order.paymentMethod === 'PAGO_MOVIL' && order.paymentReference)`
- Antes solo aparecía para `PAYMENT_UPLOADED`; las órdenes con referencia de texto quedaban en `PENDING_PAYMENT` sin botón

### ✅ Dashboard OrderCard: badge "📋 Ref: XXXXX"
- Muestra referencia de texto inline cuando `!order.hasPaymentImage && order.paymentReference`
- Estilo: `var(--surface2)`, `var(--text2)`, borderRadius 6, padding compacto

### ✅ PWA barra PICKUP: 5 fases con READY como paso separado
- `PICKUP_PHASES`: 📋 Recibido → ✅ Pago → 👨‍🍳 Cocina → 🏪 Listo → 🎉 Entregado
- `statusToPhase` PICKUP: `IN_KITCHEN→2`, `READY→3` (antes ambos eran 2), `DELIVERED→4`
- `statusLabel` PICKUP `READY`: "🏪 ¡Tu pedido está listo! Pasa a retirarlo"

### ✅ UX: animaciones y transiciones PWA
- `MenuPage`: hero `fadeInDown` 0.6s, subtítulo `fadeIn` 0.6s delay 0.3s, CTA `heroPulse` pulsante, cards `translateY(-4px)` en hover, botón "Agregar" `scale(0.92)` en click, grid `gridFadeIn` al cambiar categoría, badge carrito `cartBounce` 0.42s
- `CartDrawer`: `slideUp` 0.3s al abrir, `slideDown` 0.2s al cerrar (estado `cartClosing` en parent con timeout 200ms), backdrop `fadeIn/fadeOut`
- `CheckoutPage`: 5 secciones con `fadeInUp` escalonado (0ms/80ms/120ms/160ms/240ms/320ms), inputs con glow dorado en `:focus`, botón confirmar con `heroPulse` mientras no envía

### ✅ UX: PAYMENT_REJECTED tono ámbar (ya en continuación 2, confirmado)
- Fondo/borde ámbar `rgba(245,158,11,…)`, icono ⚠️ 1.5rem, texto menos agresivo, botón cancelar neutro

### ✅ SW auto-update silencioso
- `client/public/sw.js`: `install` llama `self.skipWaiting()` directamente — SW nunca queda en "waiting"
- `client/public/sw.js`: eliminado listener de `message` con `SKIP_WAITING`
- `client/src/App.tsx`: `UpdateToast` eliminado completamente (estado, lógica `updatefound`, JSX, botones, animación)
- `client/src/App.tsx`: nuevo componente `AutoUpdate` — solo escucha `controllerchange` y ejecuta `location.reload()` silencioso
- Flujo: deploy → SW nuevo instala → `skipWaiting()` inmediato → `controllerchange` → `reload()` automático sin intervención del usuario

### ✅ Features planning (FEATURES.md)
- Feature 10 agregado: Stories de promos con foto, vinculación a ítems del menú, precio especial opcional, publicación instantánea desde sección Promos del dashboard existente
- Nota arquitectura multi-tenant agregada como feature futuro planificado

## Sesión 2026-04-27 — UX refinements + POS payment + redesign dashboard ✅

### ✅ ConfirmPage: nombre prominente + lista de ítems
- Nombre del cliente en acento dorado 1.15rem bold (antes muted small)
- Nueva card "Tu pedido" con items `cantidad × nombre → $subtotal` y total al pie
- Card separada "Total pagado" eliminada (fusionada en la card de ítems)
- Estado persistido en `localStorage` clave `yebrams_confirm_data`:
  - `ConfirmPage` guarda en `useEffect` al montar
  - Carga desde localStorage como fallback si `location.state` es null
  - `clearConfirmData()` exportada y llamada desde `OrderTrackingPage` al alcanzar estado terminal

### ✅ OrderTrackingPage: botón "← Confirmación"
- Botón de cabecera cambiado de `← Menú` (iba a `/`) a `← Confirmación` (va a `/confirm`)
- `ConfirmPage` reconstruye desde localStorage si el usuario navega directo sin router state

### ✅ POS como método de pago para PICKUP
- `prisma/schema.prisma`: `enum PaymentMethod` extendido con `POS`
- `prisma/migrations/20260427000001_add_pos_payment/migration.sql`: `ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'POS'`
- `client/src/pages/CheckoutPage.tsx`: selector 3 botones (Pago Móvil / Efectivo / 🏧 Punto de Venta); card neutral POS sin upload de comprobante
- `client/src/api/api.ts`: `WebOrderBody.paymentMethod` incluye `'POS'`
- `src/api/dashboard.routes.ts`: `isPos = paymentMethod === 'POS' && deliveryType === 'PICKUP'`; persiste `POS` en Prisma; no requiere comprobante
- `src/orders/order-service.ts` (fix crítico build): `paymentMethod: PaymentMethod` importado de `@prisma/client` en lugar de literal union `'PAGO_MOVIL' | 'CASH_ON_DELIVERY'` — causaba TS2322 en Railway
- `dashboard/src/components/OrderCard.tsx`: `PAYMENT_LABELS['POS'] = '🏧 Punto de venta'`; condición "Enviar a cocina" incluye `|| order.paymentMethod === 'POS'`

### ✅ Push notifications PICKUP diferenciadas
- `PAYMENT_CONFIRMED` PICKUP: "👨‍🍳 Tu pedido se está preparando" (vs delivery: "Tu pedido está en cocina")
- `READY` PICKUP: "🏪 Tu pedido está listo, puedes pasar a retirarlo" (vs delivery: "sale en camino pronto 🛵")

### ✅ OrderCard: rediseño completo (visual only)
- Padding 1.5rem; border full 4px colored (vs solo borderTop)
- `#XXXX` → 1.4rem / weight 900
- Status badge → pill con padding generoso
- Customer: name 1.1rem bold, phone muted line below
- Delivery + payment + address → visual chips row (rounded surface background)
- Items: quantity en círculo dorado 30px, name 0.95rem
- Total: USD 1.3rem accent bold, Bs muted below; tiempo en esquina derecha
- Action buttons: `minHeight: 48px`, `fontSize: 1rem`
- READY: `STATUS_COLOR` corrected purple→green `#22c55e`; border 3px green; `readyPulse` glow; green banner; green action buttons

### ✅ KitchenPage cards: rediseño completo (visual only, lógica intacta)
- Padding 1.5rem; left border 5px
- `#XXXX` → 1.4rem / weight 900 + status pill + badge URGENTE
- Timer → 1.6rem bold, color dinámico verde/naranja/rojo por urgencia
- Ítems: cantidad en círculo dorado 36px bold, nombre 1.15rem / weight 700 (elemento más visible)
- Customer + delivery type + address → chip row
- LISTO button → `minHeight: 56px`, 1.2rem bold, `#22c55e` green, border-radius 12

### ✅ Micro-interacciones en todos los botones del dashboard
CSS inyectado una sola vez con guard `getElementById('btn-micro-styles')`:
- `.btn-micro`: `position:relative`, `overflow:hidden` (contención ripple), `transition 150ms`
- `:hover:not(:disabled)`: `brightness(1.15)` + `translateY(-1px)` en 150ms
- `:active:not(:disabled)`: `scale(0.95)` + `brightness(0.95)` en 60ms (snap rápido)
- `:disabled`: pulse opacity 1→0.45 ciclo 1.8s (señal de "procesando")
- Ripple JS: `onMouseDown` crea `<span class="ripple">` centrado en coordenada del click, diámetro = diagonal del botón (`√(w²+h²)×2`), anima scale(0→1) con opacity→0 en 420ms, se auto-elimina
- `.btn-glow-confirm`: green `box-shadow` en hover (confirmar pago, marcar listo, cliente retiró)
- `.btn-glow-reject`: red `box-shadow` en hover (rechazar, confirmar rechazo)
- `.btn-glow-delivery`: indigo `box-shadow` en hover (salió a domicilio)
- `.btn-glow-listo`: green intenso `box-shadow` en hover (LISTO cocina)
- KitchenPage: `KITCHEN_STYLES` extendido con las mismas reglas; `addRipple` en LISTO, refresh y logout

### ✅ FEATURES.md: Feature 11 — Módulo de Caja
- Apertura de turno: cajera, monto inicial, hora automática
- Cierre: cálculo automático del período + ingreso manual comandas + diferencia sobrante/faltante
- Historial de turnos con badges de cuadre
- Export inteligente: carga plantilla `.xlsx` existente del restaurante, mapea y rellena celdas específicas con SheetJS, descarga listo
- Dos cajeras/turnos por día (AM/PM)
- Modelo de datos `CashRegisterShift` + endpoints `/api/cash/shifts/...`

## Sesión 2026-05-04 — Feature 19 (Control de Crisis) + Menú en tiempo real ✅

### ✅ Feature 19 — Módulo Control de Crisis

- **Dashboard SettingsPage**: 2 controles en panel "Control de Crisis":
  - Toggle ⏳ Alta demanda (IS_HIGH_DEMAND) — banner ámbar en PWA
  - Toggle ⚡ Sin luz (IS_POWER_OUTAGE) + campo OUTAGE_MESSAGE personalizable — banner rojo
  - ~~Toggle Pausar pedidos~~ — eliminado; la estrategia de lista de espera lo cubre
- **6 claves en `SystemConfigMap`**: `IS_HIGH_DEMAND`, `IS_POWER_OUTAGE`, `OUTAGE_MESSAGE`, `IS_ORDERS_PAUSED`, `ORDERS_PAUSE_MINUTES`, `ORDERS_PAUSE_UNTIL`
- **Banners sticky en PWA** (`MenuPage.tsx`):
  - Ámbar (IS_HIGH_DEMAND o IS_ORDERS_PAUSED fusionados): "Alta demanda — tu pedido entrará en cola" con animación `pulseAmbar 1.5s`
  - Rojo (IS_POWER_OUTAGE): mensaje configurable con animación `pulseRed 1.5s`
  - Banners actualizan en tiempo real vía socket `config:updated` sin F5
- **Modo lista de espera** (Cambio 3 — estrategia final):
  - `POST /api/public/orders` **nunca devuelve 503** — acepta el pedido siempre
  - Si IS_ORDERS_PAUSED o IS_HIGH_DEMAND activos: devuelve `queued: true` en la respuesta
  - `ConfirmPage`: card ámbar "⏳ Alta demanda — tu pedido está en cola" visible cuando `queued === true`
  - `CartDrawer`: siempre muestra "Ir a pagar →" (sin bloqueo de checkout)
- **Dashboard OrderCard**: badge "EN COLA" ámbar junto al número de pedido cuando `isQueueMode` activo
- **DashboardPage**: carga `isQueueMode` al montar vía `configApi.getAll()` + escucha `config:updated` en tiempo real; propaga prop a los 3 grupos de OrderCard

### ✅ Menú en tiempo real

- **Cache-Control `no-store`** en `GET /api/public/menu`: elimina cache HTTP de 60s que impedía ver ítems habilitados/deshabilitados sin F5
- **Socket `menu:updated`**: `PATCH /api/menu/items/:id` emite `emitMenuUpdated(itemId)` cuando cambia `isAvailable`
- **`MenuPage.tsx`** escucha `menu:updated` → re-fetcha menú completo → recalcula `activeMenuIds` sin recargar página
- **Banner naranja sticky** en `MenuPage`: aparece si un ítem del carrito se agota mientras el cliente navega; descartable con ×
- **`CartDrawer` validación de carrito**:
  - Recibe `activeMenuIds: Set<string>` → calcula `unavailableItems` en cada render
  - Si algún ítem agotado: botón "Eliminar" inline por ítem con banner naranja por ítem
  - Si todos los ítems agotados: bloqueo rojo "Tu pedido no puede procesarse"
  - Si ninguno agotado: botón normal "Ir a pagar →"

### ✅ Limpieza Settings + Checkout + horario PWA

- **SettingsPage eliminaciones**: `MIN_ORDER_USD`, `PAGO_MOVIL_HOLDER`, toggle "Pausar pedidos" (UI + handlers)
- **Horario en Settings**: `BUSINESS_OPEN_TIME` y `BUSINESS_CLOSE_TIME` con `type="time"` nativo, labels "Abre a las" / "Cierra a las". Añadidas a `SystemConfigMap` y a `GET /api/public/config`
- **CheckoutPage**: fila "Titular" eliminada de tabla pago móvil y de "Copiar todos"
- **Horario configurado en Railway**: `BUSINESS_OPEN_TIME = 11:30`, `BUSINESS_CLOSE_TIME = 19:30`

### ✅ Pantalla de cerrado PWA — diseño final

- **Lógica**: `isOutsideBusinessHours(config)` + `!isRestaurantOpen(config)` combinados; evalúa VEN UTC-4 en cliente
- **Fondo**: `#000000` puro; contenedor `position: relative` para footer anclado
- **Logo**: `client/public/logo.png` (logo circular Yebram's), `width/height: 140px`, animación `@keyframes logoGlow` — alterna `drop-shadow(0 0 0px #f5c518)` → `drop-shadow(0 0 25px #f5c518)` cada 1.8s
- **Banner horario**: estático sin animación (solo el logo parpadea)
- **Jerarquía tipográfica**:
  - "Estamos Cerrados": `#f5c518`, `2rem`, `weight 900`
  - "Vuelve pronto,": blanco `#ffffff`, `1.3rem`, `weight 700`, `marginTop: 2rem`
  - "te esperamos con un Menú Super Crujiente 🍗": `#f5c518`, `1rem`, `weight 700`, `marginTop: 0.5rem`
  - "Volvemos a las X a.m.": hora formateada por `formatHour()`, `marginTop: 2rem`
- **Footer anclado** (`position: absolute, bottom: 1.5rem`): "Desarrollado por [Luis](https://wa.me/584165434760?text=Hola!%20Estoy%20interesado%20en%20un%20sistema%20como%20este%20para%20mi%20Negocio.)" — dorado sin subrayado, solo el nombre clickeable
- **MenuPage footer (menú abierto)**: eliminada línea "⚡ Potenciado por tecnología"

### ✅ FEATURES.md

- **Feature 26** agregada: animación barra de progreso `OrderTrackingPage` — glow pulsante por color de estado (dorado/naranja/verde)
- **Feature 27** referenciada en pendientes: impresión ticket cocina (pendiente modelo impresora del dueño)

## Pendientes próxima sesión

### 🔴 Alta prioridad

- [ ] **Costo delivery por zonas**: selector zona en Checkout (cerca/medio/lejos), clave `DELIVERY_ZONES` = JSON `[{nombre, costo}]`. Costo suma al total, no al subtotal. Dashboard muestra zona en OrderCard.
- [ ] **Avisar motorizado al entrar a IN_KITCHEN**: si orden ya tiene `driverPhone`, enviar push/WA "📦 Pedido #XXXX en cocina, prepárate".
- [ ] **Ticket WhatsApp con link /driver/:id**: al asignar motorizado, mensaje prellenado al admin con #pedido, cliente, ítems, dirección, referencia y link `/driver/:id`.
- [ ] **ConfirmPage — énfasis nombre + ítems + botón volver desde tracking**: mejora UX post-pedido.

### 🟡 Media prioridad

- [ ] **Feature 26 — Animación barra de progreso `OrderTrackingPage`**: paso activo pulsa con glow por color de estado. Ver spec en FEATURES.md.
- [ ] **Feature 9 — GPS en Checkout**: botón "📍 Usar mi ubicación", coordenadas en orden, link maps en dashboard y QR motorizado.
- [ ] **Feature 10 — Stories de promos**: carrusel entre Hero y tabs. Publicación desde dashboard.
- [ ] **Feature 11 — Módulo de Caja**: `CashRegisterShift`, endpoints `/api/cash/shifts/...`, SheetJS export.

### 🟢 Baja prioridad

- [ ] **Feature 16 — Motor de Retención RFM**: segmentación clientes por frecuencia/valor.
- [ ] **Feature 17 — QR de Mesa**: pedido desde mesa con QR.
- [ ] **Feature 27 — Impresión ticket cocina**: pendiente modelo de impresora del dueño.
- [ ] **Menú — categoría Bebidas**: pendiente foto del dueño.
- [ ] **Deuda técnica — KitchenPage socket**: migrar a singleton compartido.

### 🔍 Investigar

- [ ] **Bug #0018**: PICKUP+referencia saltó IN_KITCHEN en barra de progreso.
  ```sql
  SELECT id, "orderNumber", status, "deliveryType", "paymentMethod", "paymentReference"
  FROM orders WHERE "orderNumber" = 18
  ```
- [ ] **Consultar dueño**: modelo de impresora para Feature 27.

## Sesión 2026-05-05 — UX post-pago + notificaciones

### Push y notificaciones
- `push-service.ts`: body del push `PAYMENT_REJECTED` incluye motivo de rechazo (`reason`) cuando el admin lo ingresa
- `client/public/sw.js`: icon y badge de notificaciones push cambiados a `https://yebramspedidos.up.railway.app/logo.png`

### Backend tracking
- `GET /api/public/orders/:id/tracking`: campo `cancelReason` agregado al `select` de Prisma y expuesto en el response
- `TrackingOrder` (client api.ts): campo `cancelReason: string | null` agregado a la interfaz

### OrderTrackingPage
- Card `PAYMENT_REJECTED`: muestra `order.cancelReason` en pill ámbar si existe

### Dashboard OrderCard
- Input motivo de rechazo reemplazado por `<textarea rows={3}` ancho completo con placeholder descriptivo

### MenuPage — banner pedido activo
- Al montar: lee `yebrams_active_order` del localStorage → fetch a `/api/public/orders/:id/tracking`
- Banner rojo fijo (no closeable) si `PAYMENT_REJECTED`: muestra motivo + botón "Ver mi pedido →"
- Banner dorado closeable si `PAYMENT_CONFIRMED / IN_KITCHEN / READY / OUT_FOR_DELIVERY`
- Socket `order:updated` actualiza los banners en tiempo real

### ConfirmPage — polling en tiempo real
- `setInterval` cada 10s a `/api/public/orders/:id/tracking` con guards de integridad (`order.orderNumber`)
- `PAYMENT_REJECTED` → overlay ámbar `position: fixed` con fondo `#1a0a00`, título/botón en `#f59e0b`, motivo si existe, botón "Resolver ahora →" navega a `/order/:id`
- `PAYMENT_CONFIRMED` → banner verde sticky con countdown 3s → auto-navega a tracking
- `IN_KITCHEN / READY / OUT_FOR_DELIVERY` → `navigate('/order/:id', { replace: true })` directo
- `CANCELLED` → card gris + botón dorado "🍗 Hacer un nuevo pedido" que limpia localStorage y navega a `/init`

### Documentación y UX menor
- **Feature 21 cross-selling modal**: spec completa documentada en FEATURES.md
- **`MenuPage` pantalla cerrado**: link Luis actualizado con mensaje "Hola! Me gusta lo que hiciste en Yebram's, quisiera esto para mi negocio."

## Próxima sesión — pendientes en orden de prioridad

### 🔴 Alta prioridad
- [ ] **Costo delivery por zonas** — DELIVERY_ZONES JSON config, selector en Checkout
- [ ] **Avisar motorizado cuando pedido entra a IN_KITCHEN** — si `driverPhone` asignado, enviar notificación
- [ ] **Ticket WhatsApp al restaurante** con link `/driver/:id` cuando se asigna motorizado
- [ ] **ConfirmPage: botón volver desde tracking** — link de regreso al ConfirmPage

### 🟡 Media prioridad
- [ ] **Optimizar diseño Checkout** — textos más grandes y legibles para clientes con dificultad visual
- [ ] **Feature 26** — animación barra de progreso OrderTrackingPage (glow pulsante por color de estado)
- [ ] **Feature 9** — GPS en Checkout (coordenadas guardadas, link Google Maps en dashboard)
- [ ] **Feature 10** — Stories de promos (carrusel entre Hero y tabs)
- [ ] **Feature 11** — Módulo de Caja
- [ ] **Feature 17** — PWA Mesonero

### 🟢 Baja prioridad
- [ ] Features 16, 18, 20–28 según roadmap FEATURES.md

## Notas de deploy (Railway)

- Migración `20260415000002_add_order_number` ya aplicada manualmente en Railway
- DATABASE_URL Railway: `postgresql://postgres:HwiyNRSVYSAFcKqxCTUENuErFrnEladk@metro.proxy.rlwy.net:37303/railway`
- Las migraciones siguientes se aplican automáticamente vía `prisma migrate deploy`

## Al iniciar próxima sesión leer en orden
1. CLAUDE.md
2. ESTADO_ACTUAL.md
