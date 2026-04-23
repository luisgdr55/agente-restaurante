# Estado Actual del Sistema
Última actualización: 2026-04-23

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

## Pendientes próxima sesión

- [ ] Dashboard: botón "Ver comprobante" aparece solo después de F5
      — el socket orderUpdated no está actualizando hasPaymentImage
      en el estado local de React
- [ ] Menú: agregar categoría "Bebidas" con imagen del menú visual
      (el usuario la enviará en la próxima sesión)
- [ ] Feature 9 GPS pendiente de implementar
- [ ] Verificar en Railway que el backend deploya correctamente con
      el Dockerfile restaurado
- [ ] Pago móvil — Opción B+C en CheckoutPage:
      B) Botón "📋 Copiar datos de pago" que copia todo formateado:
         "Banco: X\nTeléfono: X\nRIF: X\nMonto: Bs X.XX"
         Compatible con Smart Paste de Banesco y otros bancos.
         Botón cambia a "✅ Copiado" por 2 segundos tras copiar.
      C) Botón "Pagar con BDV" que abre deep link:
         bdvmovil://pagomovil?telefono=X&rif=X&monto=X
         Solo visible si el monto ya está calculado.
         Si la app no está instalada, no hace nada (manejo silencioso).

## Notas de deploy (Railway)

- Migración `20260415000002_add_order_number` ya aplicada manualmente en Railway
- DATABASE_URL Railway: `postgresql://postgres:HwiyNRSVYSAFcKqxCTUENuErFrnEladk@metro.proxy.rlwy.net:37303/railway`
- Las migraciones siguientes se aplican automáticamente vía `prisma migrate deploy`

## Al iniciar próxima sesión leer en orden
1. CLAUDE.md
2. ESTADO_ACTUAL.md
