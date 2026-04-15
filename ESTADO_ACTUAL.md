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
- `ConfirmPage` — número de pedido, link WhatsApp prellenado, modal suscripción push
- Pantalla de cerrado — horario automático Venezuela UTC-4 + toggle BUSINESS_ACTIVE

**Backend público (sin auth):**
- `GET /api/public/menu` — menú con imageUrl
- `GET /api/public/config` — 14 claves + vapidPublicKey
- `POST /api/public/orders` — crea pedido, normaliza teléfono, guarda comprobante

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

## Próximo paso: prueba end-to-end en producción

Checklist completo a verificar:
1. [ ] Abrir PWA cliente, hacer pedido completo (delivery + pago móvil + foto comprobante)
2. [ ] Admin recibe push con datos del pedido y comprobante
3. [ ] Admin confirma pago → cliente recibe push "Pago confirmado"
4. [ ] Cocina marca READY → cliente recibe push "Pedido listo"
5. [ ] Admin toca "Salió a domicilio" → modal QR aparece
6. [ ] Motorizado escanea QR → ve DriverPage con datos correctos
7. [ ] Motorizado toca "Confirmar Entrega" → cliente recibe push "Entregado" con link /review
8. [ ] Cliente abre /review/:id → califica → aparece en dashboard > Reseñas
9. [ ] Verificar métricas dashboard: pedidos entregados usan completedAt
10. [ ] Probar PICKUP: pedido sin delivery → botón "Cliente retiró" directo

## Notas de deploy (Railway)

- La migración `20260415000001_add_completed_at` se aplica automáticamente en el próximo deploy
- No requiere seed manual — solo `prisma migrate deploy` que corre en el start command
- `qrcode.react` se instala en el build del dashboard automáticamente

## Al iniciar próxima sesión leer en orden
1. CLAUDE.md
2. ESTADO_ACTUAL.md
