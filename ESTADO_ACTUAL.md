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
  → Admin recibe push "Nuevo pedido" + comprobante
  → Admin confirma pago en dashboard
  → Cliente recibe push "Pago confirmado" + pedido en cocina
  → Cocina marca READY en kitchen dashboard
  → Cliente recibe push "Pedido listo"
  → Admin toca "Salió a domicilio" → QR modal con link /driver/:id
  → Motorizado escanea QR, ve datos del cliente, toca "Confirmar Entrega"
  → Cliente recibe push "Entregado" + link /review/:id
  → Cliente califica 1-5 estrellas + comentario opcional
```

## Fases implementadas

### Fase 1 — Backend Push Notifications ✅
- Tabla `push_subscriptions` en BD
- `POST /api/public/push/subscribe` — guarda suscripción vinculada al teléfono
- `sendPushToPhone(phone, title, body, url?)` — helper reutilizable
- VAPID keys configuradas en Railway

### Fase 2 — PWA Cliente ✅
**Páginas:**
- `MenuPage` — hero 100vh, tabs categorías, grid cards neon, modal detalle, CartDrawer, floating bar
- `CheckoutPage` — nombre/teléfono, toggle delivery/pickup, datos pago móvil, upload comprobante base64
- `ConfirmPage` — número de pedido, link WhatsApp prellenado completo, modal suscripción push
- Pantalla de cerrado — horario automático Venezuela UTC-4 + toggle BUSINESS_ACTIVE

**Backend público (sin auth):**
- `GET /api/public/menu` — menú con imageUrl
- `GET /api/public/config` — 14 claves + vapidPublicKey
- `POST /api/public/orders` — crea pedido, normaliza teléfono, guarda comprobante, actualiza savedAddress
- `GET /api/public/customers/:phone` — devuelve savedAddress para checkout

**Infraestructura:**
- Vite React TS + Dockerfile + nginx con `listen ${PORT}` envsubst
- Service Worker v4: network-first HTML, cache-first assets, toast "Nueva versión"
- Imágenes en GitHub (raw.githubusercontent.com) como CDN gratuito

### Fase 3 — PWA Motorizado ✅
- `DriverPage` (`/driver/:orderId`) — carga datos pedido, cliente/dirección/referencia, teléfono clickeable, botón "Confirmar Entrega"
- `GET /api/public/orders/:id` — datos mínimos, solo expone OUT_FOR_DELIVERY y DELIVERED
- `POST /api/public/orders/:id/delivered` — cierra pedido, push al cliente, WhatsApp admin
- `completedAt` registrado al marcar READY (cierre de métricas en cocina, no al DELIVERED)
- QR modal en dashboard (`qrcode.react`) al tocar "🛵 Salió a domicilio" y en OUT_FOR_DELIVERY
- Push notifications desde dashboard PATCH status: PAYMENT_CONFIRMED, READY, OUT_FOR_DELIVERY, DELIVERED
- Push también al asignar motorizado (assign-driver → OUT_FOR_DELIVERY)
- Botón "🛵 Salió a domicilio" para READY+DELIVERY; "✅ Cliente retiró" para READY+PICKUP

### Fase 4 — Reseñas desde PWA ✅
- `ReviewPage` (`/review/:orderId`) — 5 estrellas animadas (color + glow por rating), label descriptivo, textarea opcional
- `POST /api/public/reviews/:orderId` — sin auth, valida DELIVERED, maneja unique constraint (doble envío → ok)
- Push al confirmar entrega apunta a `/review/:orderId`

### Fase 5 — Limpieza ✅
- Evolution API eliminada de `docker-compose.yml` (servicio + volumen)
- `evolution_db` eliminado de `scripts/init-db.sql`
- `src/agent/` conservado en su lugar (importado por dashboard.routes.ts y whatsapp/); el agente conversacional compila pero no recibe tráfico sin webhook activo

### Fase 6 — Fixes y mejoras UX (sesión 2026-04-15) ✅

#### Fix: Upload comprobante — galería + cámara
- Eliminado `capture="environment"` del `<input>` en CheckoutPage
- El OS ahora muestra selector nativo (galería + cámara) en lugar de abrir cámara directamente

#### Fix: Dirección guardada en Checkout
- `GET /api/public/customers/:phone` — sin auth, devuelve `{ savedAddress }` normalizado
- `POST /api/public/orders` actualiza `customer.savedAddress` al confirmar un delivery
- CheckoutPage: fetch con debounce 600ms al ingresar teléfono
- Card dorada "📍 Dirección anterior" con botones **Usar esta** / **Ingresar otra**
- Auto-selecciona "Usar esta" si el campo estaba vacío al encontrar la dirección

#### Fix: Botón "Vaciar carrito"
- Botón 🗑️ **Vaciar** en rojo sutil en header del CartDrawer
- Solo visible cuando hay ítems; pide `window.confirm()` antes de limpiar
- Cierra el drawer automáticamente al confirmar

#### Fix: Migración `orderNumber`
- La columna `orderNumber` existía en el schema pero no en ninguna migración
- Creada migración `20260415000002_add_order_number` con sequence + unique constraint
- Aplicada manualmente vía `prisma migrate deploy` apuntando a Railway DATABASE_URL
- Verificado: columna existe y pedidos crean correctamente

#### Fix: Mensaje WhatsApp prellenado completo (ConfirmPage)
- El link `wa.me` ahora incluye: nombre, #pedido, lista ítems con cantidades y precios, total USD+Bs, tipo delivery con dirección o pickup, banco/teléfono/titular/RIF del pago móvil
- CheckoutPage pasa todos los datos en el state de navegación
- CheckoutPage guarda `yebrams_last_phone` en localStorage al confirmar pedido exitoso

#### Feature: Comprobante + OCR en dashboard (OrderCard)
- `GET /api/orders/:id/proof` — devuelve `paymentImageUrl` solo cuando se solicita (evita base64 en listings)
- `POST /api/orders/:id/ocr-payment` — Claude claude-sonnet-4-5 via OpenRouter con visión, extrae: referencia, fecha, hora, monto, banco origen, banco destino, titular. Devuelve JSON
- `serializeOrders()` en backend reemplaza `paymentImageUrl` por `hasPaymentImage: boolean` en todos los listings (payload más liviano)
- OrderCard: botón "Ver comprobante 🧾" → modal con imagen on-demand + botón "🔍 Extraer datos OCR" → tabla con datos extraídos

#### Feature: Push notifications en desktop/MenuPage
- Botón "🔔 Activar notificaciones de pedidos" en MenuPage
- Solo aparece si: `Notification.permission === 'default'` + `yebrams_last_phone` en localStorage + browser soporta service workers
- Solicita permiso, registra suscripción push con el último teléfono usado

## Próximos pasos recomendados

1. [ ] Prueba end-to-end completa en producción (ver checklist abajo)
2. [ ] Verificar OCR: subir comprobante real y probar extracción de datos
3. [ ] Confirmar que `savedAddress` se rellena correctamente en segundo pedido
4. [ ] Probar push notifications en desktop Chrome y Safari

## Checklist end-to-end

1. [ ] Abrir PWA cliente, hacer pedido completo (delivery + pago móvil + foto comprobante)
2. [ ] Admin recibe push con datos del pedido y comprobante
3. [ ] Dashboard muestra botón "Ver comprobante 🧾" → imagen se abre → OCR extrae datos
4. [ ] Admin confirma pago → cliente recibe push "Pago confirmado"
5. [ ] Cocina marca READY → cliente recibe push "Pedido listo"
6. [ ] Admin toca "Salió a domicilio" → modal QR aparece
7. [ ] Motorizado escanea QR → ve DriverPage con datos correctos
8. [ ] Motorizado toca "Confirmar Entrega" → cliente recibe push "Entregado" con link /review
9. [ ] Cliente abre /review/:id → califica → aparece en dashboard > Reseñas
10. [ ] Segundo pedido del mismo cliente: dirección guardada aparece en checkout
11. [ ] Mensaje WhatsApp prellenado incluye todos los datos del pedido
12. [ ] Botón 🔔 push aparece en MenuPage para usuarios que ya pidieron (desktop)

## Notas de deploy (Railway)

- Migración `20260415000002_add_order_number` ya aplicada manualmente en Railway
- Las migraciones siguientes se aplican automáticamente en el próximo deploy vía `prisma migrate deploy`
- No requiere seed manual

## Al iniciar próxima sesión leer en orden
1. CLAUDE.md
2. ESTADO_ACTUAL.md
