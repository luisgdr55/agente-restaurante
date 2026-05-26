# CLAUDE.md — Agente WhatsApp Yebram's Restaurant

Instrucciones para Claude Code al trabajar en este proyecto.
Actualizar este archivo al final de cada sesión con cambios relevantes.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 + TypeScript strict (`exactOptionalPropertyTypes: true`) |
| Framework | Fastify 5 |
| ORM | Prisma + PostgreSQL 16 |
| Cache / Sesiones | Redis 7 (ioredis) |
| Colas | BullMQ |
| LLM | OpenRouter → Gemini Flash (`google/gemini-2.0-flash-001`) |
| WhatsApp | WhatsApp Cloud API (Meta) |
| Dashboard | React + Vite PWA (carpeta `dashboard/`) |
| Infra dev | Docker Compose (solo `postgres` y `redis` en desarrollo) |
| Exposición webhook | ngrok |

---

## Comandos esenciales

```bash
# Infraestructura (solo postgres y redis, NO app/nginx en dev)
docker compose up -d postgres redis

# Backend
npm run dev          # tsx watch — hot reload
npm run typecheck    # tsc --noEmit (sin compilar)
npm run test         # jest --runInBand

# Base de datos
npm run db:seed      # Carga el menú completo de Yebram's
npm run db:studio    # Prisma Studio en localhost:5555
npm run db:migrate:dev  # Crear y aplicar migración nueva

# Dashboard
cd dashboard && npm run dev   # Vite en localhost:5173
```

---

## Arquitectura del agente conversacional

### Máquina de estados

```
IDLE → AWAITING_NAME → MAIN_MENU
  ↓
BROWSE_CATEGORIES → BROWSE_ITEMS → BUILDING_ORDER
  ↓
ORDER_CONFIRMATION → AWAITING_DELIVERY_TYPE → AWAITING_DELIVERY_ADDRESS
  ↓
AWAITING_PAYMENT_METHOD → AWAITING_PAYMENT_PROOF → PAYMENT_UNDER_REVIEW
  ↓
ORDER_IN_KITCHEN → ORDER_READY → ORDER_DELIVERED

Estados especiales: AWAITING_HUMAN, ADMIN_MODE
```

### Flujo de un mensaje (`conversation-agent.ts`)

1. Cargar sesión Redis
2. findOrCreate customer en DB
3. Resolver estado efectivo (admin override, sesión expirada)
4. Recuperar sesiones abandonadas (mid-order sin carrito)
5. Interceptores globales en orden:
   - **5a** Cancelación (frases hardcodeadas)
   - **5b** Despedida (frases hardcodeadas)
   - **5c** Menú visual (regex)
   - **5d** Frustración — frases fast-path + botones `escalate_to_human`/`continue_ordering`
   - **5e** Interceptor LLM de carrito (BROWSE + PREPAYMENT states) con detección de frustración LLM
6. Dispatch al handler del estado actual
7. Persistir nuevo estado en DB (async)

### Clasificación de intenciones (en capas)

| Capa | Mecanismo | Costo |
|---|---|---|
| Admin check | `startsWith('/')` | 0 |
| Cancelación | Lista de frases `includes` | 0 |
| Despedida | Lista de frases `includes` | 0 |
| Menú visual | Regex patterns | 0 |
| Frustración | Lista de frases `includes` | 0 |
| Preguntas de menú | Fuzzy match tokens | 0 |
| Extracción pedido | LLM (Gemini Flash) | tokens |

### Sistema de frustración y escalado

Tres vías de activación:
1. **Frases hardcodeadas** en `frustration.helper.ts` → `detectFrustrationFromText()`
2. **LLM** devuelve `frustration_level >= 2` en el JSON de extracción
3. **2 intents OTHER consecutivos** (`session.consecutiveOtherCount`)

Comportamiento:
- `frustration_level < 3` → `offerEscalation()`: botones Sí/No al cliente
- `frustration_level === 3` → `activateHumanEscalation()`: escala directamente sin preguntar
- Al escalar: LLM genera resumen de 3 líneas → notificación al admin con contexto completo

### Intent OTHER — respuesta inteligente (Mejora 1)

Cuando el LLM devuelve `intent: 'OTHER'` en `BUILDING_ORDER` sin ítems:
1. `trySmartFallback()` carga config (horario, delivery, pedido mínimo)
2. Llama `generateFreeResponse()` con contexto completo del restaurante
3. Si responde → texto + 2 botones sutiles (🍽️ Ver menú / 🛒 Ver carrito)
4. Si falla → botones genéricos existentes

---

## Estructura de archivos clave

```
src/
├── agent/
│   ├── conversation-agent.ts       ← Orquestador principal (máquina de estados)
│   ├── customer-service.ts
│   └── handlers/
│       ├── admin.handler.ts        ← Comandos /help /precio /listo /menuimg etc.
│       ├── building-order.handler.ts  ← LLM extracción + carrito
│       ├── frustration.helper.ts   ← Detección frustración + escalado
│       ├── menu-question.helper.ts ← Preguntas de precio/ingredientes sin LLM
│       ├── order-extraction.helper.ts ← extractCartFromText() con LLM + fallback
│       ├── visual-menu.handler.ts  ← Envío de fotos del menú
│       └── [estado].handler.ts     ← Un handler por estado
├── llm/
│   └── gemini-client.ts            ← extractOrderFromText, generateFreeResponse,
│                                      generateConversationSummary
├── menu/
│   ├── config-service.ts           ← getConfig/getConfigs, tasa USD→Bs, horarios
│   ├── menu-service.ts             ← Cache Redis 5min, precios USD+Bs
│   ├── menu-images-service.ts      ← Media IDs de fotos del menú en Redis
│   └── promo-day-service.ts
├── redis/
│   └── session-manager.ts          ← SessionData, updateSessionState
├── whatsapp/
│   ├── client.ts                   ← HTTP a Meta API
│   └── message-builder.ts          ← textMessage, buttonMessage, listMessage,
│                                      imageMessage, TEMPLATES
└── orders/
    └── order-service.ts

dashboard/
├── src/
│   ├── index.css                   ← Tema Yebram's (vars CSS, no Tailwind)
│   ├── pages/                      ← Dashboard, Kitchen, Menu, Orders, etc.
│   └── components/                 ← NavBar, OrderCard, StatsCard
└── vite.config.ts                  ← PWA config (name, theme_color #F5C518)

prisma/
└── seed.ts                         ← Menú completo Yebram's (10 categorías, 62 ítems)
```

---

## Convenciones importantes

### TypeScript
- `strictNullChecks: true` + `exactOptionalPropertyTypes: true`
- Objetos opcionales se construyen con spread condicional: `...(val && { key: val })`
- NO asignar `string | undefined` a campos optativos directamente

### WhatsApp API
- Títulos de botones: **máx 20 caracteres**
- Títulos de filas en `listMessage`: **máx 24 caracteres**
- Descripciones en listMessage: máx 72 caracteres

### Precios y divisas
- Almacenados en USD (`Decimal` en Prisma)
- Mostrados siempre como `$X.XX | Bs X.XX`
- Conversión en runtime: `usdToBs(usd, rate)` — nunca almacenar Bs en DB
- Tasa en config: clave `USD_TO_BS_RATE`

### Cache Redis
- Menú completo: `menu:full` — TTL 5 min
- Categorías: `menu:cat:{id}` — TTL 5 min
- Config: `cfg:{KEY}` — TTL variable
- Sesiones: `session:{phone}` — TTL = `SESSION_TTL_SECONDS`
- Fotos del menú: `menu:visual_images` — sin TTL (manual)
- Anti-spam motorizado: `driver:contacted:{phone}:{YYYY-MM-DD}` — TTL hasta medianoche Venezuela

### LLM (Gemini Flash via OpenRouter)
- **Solo se invoca** para: extracción de pedido, respuesta libre, resumen de conversación
- `max_tokens` estricto: 200 extracción, 300 respuesta libre, 120 resumen
- JSON schema en system prompt — parser tolera markdown code fences de Gemini
- Campos del JSON de extracción: `items`, `notFound`, `ambiguous`, `intent`, `frustration_level`, `escalation_reason`

---

## Configuración en DB (tabla `Config`)

| Clave | Descripción |
|---|---|
| `RESTAURANT_NAME` | Nombre mostrado en mensajes |
| `RESTAURANT_HOURS` | Horario en texto libre |
| `ADMIN_PHONE` | Número admin (sin +) |
| `USD_TO_BS_RATE` | Tasa de cambio |
| `DELIVERY_FEE_USD` | Costo delivery en USD |
| `MIN_ORDER_USD` | Pedido mínimo en USD |
| `PAGO_MOVIL_BANK` | Banco para pago móvil |
| `PAGO_MOVIL_PHONE` | Teléfono para pago móvil |
| `PAGO_MOVIL_HOLDER` | Titular cuenta |
| `PAGO_MOVIL_RIF` | RIF del restaurante |

---

## Comandos admin por WhatsApp

| Comando | Acción |
|---|---|
| `/help` | Lista todos los comandos |
| `/precio <nombre> <$>` | Cambiar precio de ítem |
| `/menu` | Ver ítems y precios actuales |
| `/listo <#>` | Marcar pedido listo |
| `/entregado <#>` | Marcar pedido entregado |
| `/confirmar <#>` | Confirmar pago |
| `/rechazar <#>` | Rechazar pago |
| `/pedidos` | Ver pedidos activos |
| `/stats` | Estadísticas del día |
| `/liberar <tel>` | Devolver cliente al bot desde AWAITING_HUMAN |
| `/bot on\|off` | Activar/desactivar el bot |
| `/horario <HH:MM HH:MM>` | Cambiar horario |
| `/delivery on\|off` | Activar/desactivar delivery |
| `/tasa <valor>` | Cambiar tasa USD→Bs |
| `/menuimg` | Ver fotos del menú visual |
| `/menuimg clear` | Borrar fotos del menú |
| `/menuimg test` | Probar envío de fotos |
| Foto + caption `/menuimg` | Registrar foto del menú |
| `/estado <Nombre \| Bs>` | Agregar promo del día |
| `/diaspromo <días>` | Configurar días de promo |

---

## Errores conocidos pre-existentes (no tocar)

Los siguientes archivos tienen errores de TypeScript que existían antes de este proyecto y no son nuestros:

- `src/__tests__/menu-flow.test.ts`
- `src/__tests__/state-machine.test.ts`
- `src/api/dashboard.routes.ts` (campo `savedAddress`)
- `src/menu/promo-day-service.ts`
- `src/reports/report-service.ts`

Comando para ver solo errores propios:
```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__\|menu-flow\|state-machine\|dashboard.routes\|promo-day\|report-service\|savedAddress"
```

---

## Decisiones de diseño

**Multi-tenancy deliberadamente postponed.**
Toda la configuración del restaurante (nombre, horarios, tasa, pagos, teléfono admin) ya pasa por `getConfig()` / `getConfigs()` sin excepción. Los valores hardcodeados que existen son únicamente fallbacks de último recurso para cuando la DB no responde — no se usan en operación normal. Cuando llegue el momento de soportar múltiples restaurantes, la migración será quirúrgica: agregar `tenantId` a la tabla `Config` y pasar el contexto del tenant por la cadena de llamadas. No habrá que rastrear strings dispersos.

**Fallbacks de config estandarizados:**
Todos usan `'el restaurante'` para `RESTAURANT_NAME` y `'36.50'` para `USD_TO_BS_RATE`. Los de pago móvil usan `'N/A'` (señal explícita de "no configurado"). Los de horarios usan `'Próximamente'`.

---

## Historial de cambios relevantes

### 2026-03-27 — Mejoras al agente conversacional + limpieza de config

**Mejora 1: Intent OTHER con respuesta inteligente**
- `gemini-client.ts`: nueva interfaz `RestaurantContext`, `buildFreeResponseSystemPrompt` enriquecido con horario/delivery/pedido mínimo y cierre con micro-invitación
- `building-order.handler.ts`: `trySmartFallback()` — antes de mostrar botones genéricos, intenta `generateFreeResponse` con contexto completo del restaurante; si el LLM responde → texto + 2 botones sutiles; si falla → botones genéricos actuales

**Mejora 2: Detección de frustración y escalado proactivo**
- `session-manager.ts`: campo `consecutiveOtherCount?: number` en `SessionData`
- `gemini-client.ts`: campos `frustration_level` (0-3) y `escalation_reason` en schema JSON del LLM; función `generateConversationSummary()` para resúmenes de escalado
- `order-extraction.helper.ts`: propaga `frustrationLevel` y `escalationReason` en `CartExtraction`
- `frustration.helper.ts` (nuevo): `detectFrustrationFromText`, `offerEscalation`, `activateHumanEscalation`
- `conversation-agent.ts`: paso 5d — fast-path por frases, handler de botones `escalate_to_human`/`continue_ordering`; interceptor LLM actualizado con lógica de escalado automático (nivel 2 → oferta, nivel 3 → directo, 2× OTHER → oferta)

**Mejora 3: Notificación al admin con contexto (integrada en Mejora 2)**
- `activateHumanEscalation()` en `frustration.helper.ts` notifica al admin con formato enriquecido: nombre, teléfono, motivo, resumen LLM de 3 líneas, último mensaje

**Limpieza de fallback strings**
- Auditoria completa: confirmado que no hay valores hardcodeados que bypaseen `getConfig()`
- Estandarizados fallbacks inconsistentes: `idle.handler.ts` (×2) y `dashboard.routes.ts` → `'el restaurante'`
- Corregido mismatch de tasa en `admin.handler.ts`: `'36'` → `'36.50'` (alineado con seed)

### 2026-03-28 (sesión 2) — Mejora A + Mejora B UX post-pago

**Mejora A: Notificaciones proactivas por estado**
- `message-builder.ts`: `paymentReceived` rediseñado. `paymentConfirmed(to, cartSummary)` incluye resumen del carrito. `orderInKitchen(to, _orderId, etaMinutes)` incluye ETA. `orderAwaitingDriver(to)` nuevo. `orderDelivered` actualizado
- `config-service.ts`: nueva clave `DELIVERY_ETA_MINUTES` en `SystemConfigMap`
- `prisma/seed.ts`: semilla `DELIVERY_ETA_MINUTES = '20'`
- `admin.handler.ts`: `handleConfirmPayment` → `getOrderWithItems` + `buildCartSummary` + ETA; `doMarkOrderReady` DELIVERY → `AWAITING_DRIVER_ASSIGNMENT` + `orderAwaitingDriver` al cliente
- `dashboard.routes.ts`: PAYMENT_CONFIRMED usa cartSummary+ETA; IN_KITCHEN usa etaMinutes; READY/DELIVERY envía orderAwaitingDriver; case AWAITING_DRIVER_ASSIGNMENT agregado
- `awaiting-payment-proof.handler.ts`: texto inline reemplazado por `TEMPLATES.paymentReceived`

**Mejora B: Respuesta LLM natural en estados post-pago**
- `gemini-client.ts`: nueva interfaz `ActiveOrderContext` (orderNumber, status, cartSummary, deliveryType, deliveryAddress?, estimatedMinutes?). `buildFreeResponseSystemPrompt` acepta `activeOrder?` — inyecta sección "PEDIDO ACTIVO" al prompt. Nueva función `generateOrderStatusResponse(customerName, userMessage, restaurantName, activeOrder, restaurantCtx?, context?)`
- `conversation-agent.ts`: interceptor 5f — para `PAYMENT_UNDER_REVIEW`, `ORDER_IN_KITCHEN`, `ORDER_READY` con texto libre: carga orden con ítems, construye contexto, llama `generateOrderStatusResponse`; si LLM falla → cae al handler del estado

### 2026-03-28 (sesión 3) — Cierre de pedido + Feedback + Mejoras de flujo delivery

**Feature 1 — Confirmación de entrega por motorizado**
- `gemini-client.ts`: `detectDeliveryConfirmation(text)` — LLM max_tokens=30, temp=0, JSON `{confirmed}`. Incluye venezolano coloquial: "ya ta", "ta listo", "llegó", "aquí toy", "se lo dejé", "recibido". Fallback: false (nunca cierra orden por error)
- `order-service.ts`: `findActiveDeliveryByDriverPhone(driverPhone)` — busca orden OUT_FOR_DELIVERY por teléfono del motorizado
- `message-builder.ts`: templates `driverDeliveryConfirmed`, `driverDeliveryPrompt`, `driverNotRegistered`
- `notifications/admin-notifier.ts`: `notifyDeliveryConfirmed`, `notifyUnregisteredDriverAttempt`
- `agent/handlers/driver-delivery.handler.ts` (nuevo): `handleRegisteredDriver`, `handleUnregisteredDriverAttempt`
- `conversation-agent.ts`: Step 0 antes de cargar sesión — Check 1 (motorizado registrado con orden activa), Check 2 (número desconocido SIN sesión existente → evita falsos positivos con clientes en AWAITING_HUMAN)

**Feature 2 — Agradecimiento personalizado con LLM**
- `gemini-client.ts`: `generateThankYouMessage(customerName, cartSummary, restaurantName)` — temp=0.85, regla: NUNCA empezar con el nombre, fallback hardcodeado si LLM falla
- `agent/handlers/order-delivered.helper.ts` (nuevo):
  - `triggerOrderDelivered(customerPhone, orderId)` — actualiza DB + envía agradecimiento + pide feedback (usado por admin y motorizado)
  - `sendDeliveryNotifications(customerPhone, orderId)` — solo notificaciones, sin actualizar DB (usado por dashboard que ya hizo el update)
- `admin.handler.ts`: `doMarkOrderDelivered` usa `triggerOrderDelivered`
- `dashboard.routes.ts`: case DELIVERED usa `sendDeliveryNotifications`

**Feature 3 — Sistema de feedback post-entrega**
- `prisma/schema.prisma`: modelo `Review` (id, orderId único, customerId, rating Int, comment?, createdAt). Relaciones en Customer y Order. `npx prisma db push` aplicado.
- `session-manager.ts`: nuevos estados `AWAITING_FEEDBACK_RATING`, `AWAITING_FEEDBACK_COMMENT`. Nuevos campos `pendingFeedbackOrderId`, `pendingFeedbackRating`, `feedbackRequestedAt` en `SessionData`
- `message-builder.ts`: templates `feedbackRating(to)` (listMessage 5 estrellas), `feedbackCommentPositive`, `feedbackCommentNegative`, `feedbackThanks(to, hasComment)`
- `agent/handlers/awaiting-feedback-rating.handler.ts` (nuevo): valida rango 1-5, guarda rating en sesión, transiciona a AWAITING_FEEDBACK_COMMENT
- `agent/handlers/awaiting-feedback-comment.handler.ts` (nuevo): crea Review en DB (try/catch unique constraint), limpia campos feedback, vuelve a MAIN_MENU
- `conversation-agent.ts`: interceptor 5g — timeout 20 min desde `feedbackRequestedAt`, reset silencioso a MAIN_MENU sin mensaje
- `dashboard.routes.ts`: endpoints `GET /api/reviews`, `GET /api/reviews/stats`, `GET /api/customers/:id/reviews`

**Mejoras de flujo delivery**

**Mejora 1 — Validación de zona con costo**
- `config-service.ts` (`SystemConfigMap`): nuevas claves `DELIVERY_ZONES` (JSON `[{nombre,costo}]`) y `RESTAURANT_ADDRESS`
- `session-manager.ts` (`SessionData`): nuevos campos `deliveryZone?: string`, `deliveryFeeUsd?: number`
- `message-builder.ts`: `TEMPLATES.askDeliveryZone(to, zones)` — buttonMessage con zonas (slice 13 chars) + "🏪 Retirar en local"
- `awaiting-delivery-address.handler.ts`: reescrito con 2 fases:
  - Fase 1 (sin zona): muestra zone picker; `zone_N` guarda zona+fee; `zone_pickup` → AWAITING_PAYMENT_METHOD PICKUP; texto libre → mensaje "no llegamos a esa zona" con RESTAURANT_ADDRESS + re-muestra picker; si sin zonas configuradas → fallback a texto libre (compatibilidad)
  - Fase 2 (zona seleccionada): lógica de dirección existente sin cambios
- `awaiting-payment-method.handler.ts`: `deliveryFeeUsd = session.deliveryFeeUsd ?? DELIVERY_FEE_USD`; propaga `deliveryZone` y `deliveryFeeUsd` a AWAITING_PAYMENT_PROOF

**Mejora 2 — ETA configurable** (ya estaba implementada desde sesión anterior; verificado en admin.handler.ts:1071 y dashboard.routes.ts:153,166 — ambos usan `getConfig('DELIVERY_ETA_MINUTES')` dinámicamente)

**Mejora 3 — Botón cambiar dirección/zona**
- `message-builder.ts`: `TEMPLATES.askPaymentMethodDelivery(to)` — 2 botones: `[📱 Pago Móvil | 📍 Cambiar dirección]`
- `awaiting-payment-method.handler.ts`: maneja `id === 'change_address'` → vuelve a AWAITING_DELIVERY_ADDRESS limpiando deliveryZone y deliveryAddress, carrito intacto. Fallback muestra `askPaymentMethodDelivery` para DELIVERY y `askPaymentMethod` para PICKUP. El botón desaparece automáticamente después de PAYMENT_UNDER_REVIEW (solo existe en AWAITING_PAYMENT_METHOD).

**Config keys para insertar en DB (Mejora 1):**
```sql
INSERT INTO "SystemConfig" (key, value) VALUES
  ('DELIVERY_ZONES', '[{"nombre":"Zona cercana","costo":1.50},{"nombre":"Zona lejana","costo":3.00}]'),
  ('RESTAURANT_ADDRESS', 'Calle Principal, local 5, frente al banco');
```

### 2026-03-31 — Mejoras UX admin/motorizado + Formulario pedido manual

**Mejora 1 — Botón "🤖 Liberar al bot" en notificación de escalado**
- `src/agent/handlers/frustration.helper.ts`: notificación al admin cambia de `textMessage` a `buttonMessage` con dos botones: `[💬 Ir al chat | 🤖 Liberar al bot]`
- `src/agent/handlers/admin.handler.ts`: nuevo handler para `release_customer:{phone}` — reutiliza la lógica del comando `/liberar` existente; `ir_al_chat:` se ignora intencionalmente (el admin abre el chat manualmente)

**Mejora 3 — Botón "✅ Entregado" en mensaje al motorizado**
- `src/api/dashboard.routes.ts`: mensaje al motorizado cambia de `textMessage` a `buttonMessage` con botón `driver_delivered:{orderId}`; incluye instrucción textual de fallback para WhatsApp Business que no muestre el botón
- `src/agent/handlers/driver-delivery.handler.ts`: nueva firma `handleRegisteredDriver(msg, order, log)` — detecta `msg.type === 'interactive'` con `driver_delivered:` antes del flujo LLM; extrae `orderId`, verifica coincidencia, llama `triggerOrderDelivered()` idéntico al flujo de texto
- `src/agent/conversation-agent.ts`: condición Check 1 ampliada a `type === 'text' || type === 'interactive'`; Check 1.5 y Check 2 conservan `msg.type === 'text'` para evitar falsos positivos

**Mejora 2 — Formulario de pedido manual en dashboard**
- `src/api/dashboard.routes.ts`: nuevo endpoint `GET /api/menu/items-flat` (lista plana de ítems activos con precio USD y Bs calculado en runtime); nuevo endpoint `POST /api/orders/manual` (crea orden completa con resolución de cliente, EFECTIVO → directo a cocina, PAGO_MOVIL → PAYMENT_UNDER_REVIEW, notificación WhatsApp opcional)
- `dashboard/src/api/api.ts`: tipos `MenuItemFlat`, `ManualOrderBody`, `ManualOrderItem`; `menuApi.getItemsFlat()`; `manualOrderApi.create()`
- `dashboard/src/pages/ManualOrderPage.tsx` (nuevo): formulario 5 pasos con stepper visual — (1) buscar/crear cliente, (2) buscador de ítems con subtotal en tiempo real, (3) toggle delivery/pickup, (4) toggle efectivo/pago móvil, (5) resumen + botón registrar
- `dashboard/src/components/NavBar.tsx`: link "➕ Pedido" en desktop nav + botón "➕ Pedido manual" en bottom sheet
- `dashboard/src/App.tsx`: ruta `/manual-order` → `ManualOrderPage`

Normalización de teléfono en Paso 1: `04XXXXXXXXX` → `584XXXXXXXXX` antes de crear cliente nuevo.

### 2026-03-31 — Fix crons de reportes a UTC + guard de staleness

**Bug corregido: crons en hora local en vez de UTC**
- `src/workers/report-worker.ts`: patrones cron corregidos a UTC (Venezuela = UTC-4):
  - daily:   `'0 23 * * *'` → `'0 3 * * *'`   (11 PM Venezuela)
  - weekly:  `'0 8 * * 1'`  → `'0 12 * * 1'`  (8 AM Venezuela, lunes)
  - monthly: `'0 8 1 * *'`  → `'0 12 1 * *'`  (8 AM Venezuela, día 1)

**Guard de staleness (jobs atrasados al reiniciar servidor)**
- `src/workers/report-worker.ts`: al inicio del worker, si `Date.now() - job.timestamp > 10 min` → descarta el job con `logger.warn` sin enviar mensajes
- Evita que reportes del backlog se disparen al reiniciar servidor en Railway

**Nota de deploy**
- En Railway (Redis limpio): los crons nuevos se registran solos al arrancar — no requiere acción
- En local (Redis existente): para probar los horarios nuevos ejecutar `DEL bull:reports:repeat:*` en Redis CLI

---

## Pivot estratégico — 2026-04-09

### Modelo híbrido: Web App + WhatsApp saliente

El sistema migra de bot conversacional completo a modelo híbrido. **El agente conversacional en WhatsApp queda deprecado como canal de pedidos.**

#### Canal cliente (nuevo) — Web App
- App web visual tipo casa-barril.vercel.app (referencia de calidad)
- Menú con fotos, carrito, checkout completo
- Upload de comprobante de pago en la web
- El cliente da su número en el formulario para recibir notificaciones
- Sin WhatsApp para hacer el pedido
- Material pendiente de Yebram's: logo, fotos de productos, datos pago móvil, zonas delivery con precios

#### Canal WhatsApp (simplificado) — Solo mensajes salientes
Evolution API en Railway. ~6 mensajes por pedido:
1. Admin ← nuevo pedido + comprobante
2. Cliente ← pago confirmado
3. Cliente ← pedido en cocina
4. Motorizado ← datos + botón Entregado
5. Cliente ← va en camino
6. Cliente ← gracias + estrellas

Si el cliente escribe al WhatsApp: respuesta automática con estado del pedido, sin LLM, sin estados de conversación.

#### Rol del LLM (reducido)
- Respuesta de estado cuando cliente escribe al WhatsApp
- Agradecimiento post-entrega personalizado
- Narrativa de reportes automáticos
- Ya NO interpreta pedidos en texto libre

#### Meta descartado definitivamente
- Sin Cloud API de Meta, sin número nuevo, sin campaña de difusión
- Evolution API permite usar el número actual del restaurante

#### Infraestructura
- Evolution API en Railway (riesgo calculado; fallback → Hetzner €3.29/mes)
- Bot + dashboard + PostgreSQL + Redis en Railway (sin cambios)
- Evolution API usa `evolution_db` — BD separada en la misma instancia PostgreSQL (Opción A)

---

## Próxima sesión

### Implementado 2026-04-09 — Migración a Evolution API

**Cambio 1 — Variables de entorno**
- `src/config/env.ts`: variables Meta comentadas con `// META_LEGACY`; nuevas: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`
- `.env`: variables Meta comentadas con `# META_LEGACY`; nuevas variables con placeholders

**Cambio 2+3 — `src/whatsapp/client.ts` reescrito**
- Endpoints Evolution API: `sendText`, `sendButtons`, `sendList`, `sendMedia`, `markAsRead`, `downloadMedia`
- Anti-ban obligatorio: `sendTyping()` + delay proporcional al texto (3s–15s ±25% ruido) antes de cada mensaje
- Firma del método `markAsRead` actualizada a `(phone, messageId)` — caller `message-processor.ts` actualizado

**Cambio 4 — `src/whatsapp/webhook-handler.ts` reescrito**
- Parser de formato Evolution API: `event: 'messages.upsert'`, `data.key.remoteJid`, `data.message`
- Filtros: `fromMe === true`, grupos `@g.us`, eventos distintos a `messages.upsert`
- Tipos soportados: texto, imagen, botón, lista, ubicación
- Parser Meta comentado con `// META_LEGACY` al final del archivo

**Cambio 5 — Infraestructura**
- `docker-compose.yml`: nuevo servicio `evolution-api` (imagen `evoapicloud/evolution-api:latest`, puerto 8080, volumen `evolution_instances`)
- `scripts/init-db.sql`: crea `evolution_db` idempotente con `\gexec` al arrancar PostgreSQL

**Cambio 6 — `src/whatsapp/routes.ts`**
- `GET /webhook` eliminado (comentado `META_LEGACY`) — Evolution API no requiere verificación de URL
- Verificación HMAC-SHA256 eliminada (comentada `META_LEGACY`)
- Import `crypto` eliminado; `VerifyQuery` eliminado

### Pendiente técnico — en orden de prioridad
1. **Deploy a Railway:**
   1. Crear proyecto en Railway + conectar repo GitHub
   2. Agregar PostgreSQL + Redis como plugins
   3. Configurar variables de entorno (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, etc.)
   4. Crear `evolution_db` en Railway PostgreSQL (`CREATE DATABASE evolution_db OWNER railway;`)
   5. Deploy y escanear QR para conectar número en Evolution API
2. **Endpoints públicos para web app:**
   - `GET /api/menu/public` (sin auth, menú con fotos)
   - `POST /api/orders/web` (pedido desde web)
   - `POST /api/orders/upload-proof` (comprobante)
3. **Simplificación del agente WhatsApp** — eliminar máquina de estados, solo respuestas de estado
4. **Deploy completo a Railway**
5. **Web app del cliente** — cuando Yebram's entregue fotos y datos del menú

### Pendiente diferido (ya no prioritario)
- Suite de tests de simulación (`simulate-conversation.ts`)
- Dashboard React — Settings: campo `RESTAURANT_ADDRESS` editable
- Seed: agregar `RESTAURANT_ADDRESS` a `prisma/seed.ts`

### Implementado 2026-03-30 (sesión 3) — Dashboard gestión clientes + fixes flujo delivery

**Feature: Panel de gestión de clientes (emergencia)**
- `dashboard.routes.ts`: `GET /api/customers/search?phone=xxx` — búsqueda liviana por teléfono con estado de sesión Redis enriquecido (`sessionState`, `activeOrderId/Number/Status`)
- `dashboard.routes.ts`: `POST /api/customers/:id/reset-session` — cancela orden activa, resetea sesión Redis a MAIN_MENU, envía WhatsApp: "¡Hola! Tuvimos un pequeño inconveniente técnico pero ya está resuelto 😊 Puedes hacer tu pedido normalmente."
- `dashboard/src/pages/CustomersPage.tsx`: sección colapsable "🔧 Gestión de emergencia" al tope de la página. Búsqueda por teléfono → badge de estado de sesión con color → botón "🔄 Resetear sesión" con feedback inline
- `NavBar.tsx` y `App.tsx`: ya tenían `/customers` integrado — sin cambios necesarios

**Feature: Asignación ad-hoc de motorizado desde OrderCard**
- `dashboard/src/components/OrderCard.tsx`: si no hay motorizados registrados → formulario nombre+teléfono directo; si hay registrados → dropdown + botón "➕ Motorizado nuevo" para modo ad-hoc
- Flujo ad-hoc: `driversApi.create()` → `ordersApi.assignDriver()` en una sola acción

**Feature: Editar y eliminar motorizados en Settings**
- `dashboard/src/pages/SettingsPage.tsx`: botón [Editar] expande formulario inline por fila; botón [Eliminar] detecta soft-delete (órdenes asociadas) y muestra mensaje explicativo vs hard-delete

**Fix: Normalización de teléfonos de motorizados (04... → 584...)**
- `src/orders/order-service.ts`: `normalizePhone()` aplicada en `assignDriver()` — `driverPhone` guardado en DB siempre en formato internacional
- `src/api/dashboard.routes.ts`: `normalizeDriverPhone()` aplicada en POST/PATCH `/api/drivers` — normalización al guardar
- SQL aplicado: `UPDATE drivers SET phone = '58' || SUBSTRING(phone, 2) WHERE phone LIKE '04%' AND LENGTH(phone) = 11` — 2 registros actualizados

**Fix: Check 1.5 — motorizado post-entrega no crea Customer basura**
- `src/orders/order-service.ts`: nueva función `wasRecentDriverPhone(phone, hoursAgo=24)` — query COUNT sobre `driverPhone + DELIVERED + deliveredAt >= now-24h`
- `src/agent/conversation-agent.ts`: Check 1.5 entre Check 1 y Check 2 — si no hay sesión y número fue driverPhone en entrega reciente → responde "¡Gracias! Tu entrega fue registrada exitosamente 👊" y retorna sin crear Customer

**Fix: Upgrade a combo — baseName sin "(Sola)"**
- `src/agent/handlers/building-order.handler.ts`: `baseName = hamburguesa.name.replace(/\s*\(Sola\)\s*$/i, '').trim()` antes de construir `targetName` — evitaba mismatch con el nombre real del combo en el menú

**Fix: Bebida pedida cuando combo ya está en carrito**
- `src/agent/handlers/building-order.handler.ts`: bloque post-upgrade — si `notFound` contiene bebida Y carrito ya tiene combo → responde "🥤 Tu combo ya incluye refresco y papas 😊" sin alucinaciones

**Fix BUG A prompt LLM — regla general de upgrade**
- `src/llm/gemini-client.ts`: reemplazados ejemplos específicos de "Picón Green" por regla explícita `REGLA UPGRADE A COMBO` — si hamburguesa SOLA en carrito y cliente pide bebida/papas/combo → MODIFY: quitar sola, agregar combo. Negativo: bebida SIN hamburguesa → notFound

### Implementado 2026-03-30 (sesión 1) — Corrección de 6 bugs

**BUG 2 — Pago por WhatsApp no activaba cocina en dashboard (CRÍTICO)**
- `admin.handler.ts`: agregado `import { emitOrderUpdated }` desde `socket-server`
- `handleConfirmPayment`: movió `getOrderWithItems` antes del `if (customerPhone)`, agrega `emitOrderUpdated` tras confirmar
- `doMarkOrderReady` (DELIVERY y PICKUP): agrega `getOrderWithItems` + `emitOrderUpdated` en ambos paths
- `handleRejectPayment`: agrega `getOrderWithItems` + `emitOrderUpdated` tras rechazar

**BUG 1 — Dashboard no mostraba panel de asignación de motorizado en delivery (CRÍTICO)**
- `dashboard.routes.ts` PATCH `/api/orders/:id/status`: si `status === 'READY'` y `deliveryType === 'DELIVERY'` → sobreescribe `extraData.status = 'AWAITING_DRIVER_ASSIGNMENT'`
- `dashboard/src/pages/DashboardPage.tsx`: `AWAITING_DRIVER_ASSIGNMENT` agregado al filtro `urgent` (línea 72) — pedido existía en `orders` pero no se renderizaba en ningún grupo
- El panel en `OrderCard.tsx` ya filtraba por `AWAITING_DRIVER_ASSIGNMENT` — ahora el status en DB y el render coinciden

**BUG 4 — Pedidos con múltiples ítems fallaban la primera vez (MODERADO)**
- `src/config/constants.ts`: `LLM_MAX_TOKENS_EXTRACTION` 200 → 500

**BUG 3 — Ubicación WhatsApp llegaba como coordenadas al motorizado (MODERADO)**
- `src/whatsapp/webhook-handler.ts` case `'location'`: si no hay `address` pero hay `name` → usar `name`; si no hay ninguno → `📍 https://maps.google.com/?q=LAT,LNG`

**BUG 5 — Sesiones corruptas por caída de token o deploy (MODERADO)**
- `src/agent/conversation-agent.ts`: nuevo bloque "4a-pre" tras calcular `effectiveState`
- Si `session.activeOrderId` existe y estado está en `POST_ORDER_STATES` → consulta DB; si orden es DELIVERED/CANCELLED → reset silencioso a MAIN_MENU
- `POST_ORDER_STATES` centralizado en `src/config/constants.ts` (ver Mejoras abajo)

**BUG 6 — Reviews no visibles en dashboard (BAJO)**
- `dashboard/src/api/api.ts`: tipos `Review`, `ReviewStats` + `reviewsApi` (getAll, getStats)
- `dashboard/src/pages/ReviewsPage.tsx`: nueva página — stats card (promedio + distribución por barras), filtros 1-5★, lista paginada 20/página, colores verde/amarillo/rojo según rating
- `dashboard/src/components/NavBar.tsx`: link "Reseñas" en desktop + botón "⭐ Reseñas" en bottom sheet mobile
- `dashboard/src/App.tsx`: ruta `/reviews` → `ReviewsPage`

### Implementado 2026-03-30 (sesión 2) — Mejoras adicionales

**Limpieza proactiva de sesiones huérfanas (GAP 2 del BUG 5)**
- `src/workers/session-cleanup.ts`: nueva función `cleanupOrphanedSessions()` — escanea todas las sesiones Redis cada 5 min, detecta sesiones con `activeOrderId` cuya orden en DB es DELIVERED/CANCELLED, las resetea a MAIN_MENU silenciosamente
- `scheduleSessionCleanup()`: agrega job `orphan-cleanup` con `repeat: { every: 5 * 60 * 1000 }` además del cleanup horario existente
- Worker bifurca por `job.name`: `'orphan-cleanup'` → `cleanupOrphanedSessions()`, resto → comportamiento existente

**POST_ORDER_STATES centralizado**
- `src/config/constants.ts`: `export const POST_ORDER_STATES: readonly string[]` — fuente única de verdad
- `conversation-agent.ts`: eliminada definición local, importa desde constants
- `session-cleanup.ts`: importa desde constants
- Evita desincronización futura entre ambos consumidores

**LLM diferencia DELIVERY vs PICKUP en estados post-pago**
- `src/llm/gemini-client.ts` → `buildFreeResponseSystemPrompt()`: agrega sección `REGLAS DE LENGUAJE` al prompt según `activeOrder.deliveryType`
- DELIVERY: "se está preparando, pronto saldrá a tu dirección" / NUNCA "puedes pasar a buscarlo"
- PICKUP: "pronto podrás pasar a buscarlo" / NUNCA "va en camino" ni mencionar dirección

### Implementado esta sesión (2026-03-28 sesión 4)
- `report-service.ts`: corregidos 2 bugs pre-existentes (`getExchangeRate` import muerto, `BUSINESS_NAME` → `RESTAURANT_NAME`). Resumen diario ahora incluye ⭐ rating promedio (omitido si 0 reseñas) y 📍 pedidos por zona (omitido si no hay delivery)
- `schema.prisma`: campo `deliveryZone String?` agregado al modelo `Order`. `db push` aplicado (131ms)
- `order-service.ts`: `CreateOrderInput` incluye `deliveryZone?: string`; se persiste en `prisma.order.create`
- `awaiting-payment-method.handler.ts`: pasa `session.deliveryZone` a `createOrder`
- `dashboard.routes.ts` (Mensaje B al motorizado): eliminada línea "El pago del delivery corre por cuenta del restaurante" — redundante

### Pendiente externo (no depende del código)
- Aprobación de Meta para verificación del negocio → cuando apruebe:
  1. Generar token permanente desde `business.facebook.com` → Usuarios del sistema → bot-restaurante → Generar identificador
  2. Actualizar `WHATSAPP_TOKEN` en `.env`
  3. Proceder con deploy a Railway

### Pendiente de decisión
- Definir nombres y costos reales de las zonas de delivery del restaurante demo
- Definir dirección real del restaurante demo para `RESTAURANT_ADDRESS`

### 2026-03-28 — Gestión de motorizados (delivery driver management)

**Cambio 1: Migración Prisma**
- Nueva tabla `Driver` (id, name, phone, isActive, createdAt)
- Campos nuevos en `Order`: `driverId` (FK nullable), `driverPhone` (denormalizado), `deliveryReference`
- Nuevo valor en `OrderStatus`: `AWAITING_DRIVER_ASSIGNMENT` (entre `IN_KITCHEN` y `OUT_FOR_DELIVERY`)

**Cambio 2: Punto de referencia en flujo del cliente**
- Nuevo `ConversationState`: `AWAITING_DELIVERY_REFERENCE`
- Nuevo campo `deliveryReference?` en `SessionData`
- Nuevo handler: `awaiting-delivery-reference.handler.ts`
- `awaiting-delivery-address.handler.ts`: tras capturar dirección → pregunta referencia con botón "Sin referencia"
- `conversation-agent.ts`: dispatch + arrays CANCELLABLE, FRUSTRATION, PREPAYMENT actualizados

**Cambio 3: Comando /listo split DELIVERY/PICKUP**
- `admin.handler.ts` → `doMarkOrderReady()`: DELIVERY → `AWAITING_DRIVER_ASSIGNMENT` (sin notificar cliente). PICKUP → `READY` (flujo original)
- `dashboard.routes.ts` case `READY`: mismo split

**Cambio 4: Backend drivers + assignDriver**
- `order-service.ts`: `buildCartSummary()`, `AssignDriverResult`, `assignDriver()` con anti-spam Redis
- `message-builder.ts`: template `orderOutForDelivery(to, driverName, driverPhone, address)` — Mensaje A
- `dashboard.routes.ts`: `GET/POST/PATCH/DELETE /api/drivers` + `POST /api/orders/:id/assign-driver`
- Mensaje B al motorizado: completo (primera vez del día) o solo datos (contacto repetido mismo día)

**Cambio 5: deliveryReference en creación de orden**
- `CreateOrderInput`: campo `deliveryReference?`
- `awaiting-payment-method.handler.ts`: pasa `deliveryReference` de sesión a `createOrder` y a `updateSessionState`

**Cambio 6: Dashboard**
- `api/api.ts`: tipo `Driver`, campos `deliveryReference/driverId/driverPhone` en `Order`, `driversApi`, `ordersApi.assignDriver`
- `OrderCard.tsx`: badge + color rosa para `AWAITING_DRIVER_ASSIGNMENT`, panel de asignación con dropdown de motorizados activos
- `OrdersPage.tsx`: filtro `AWAITING_DRIVER_ASSIGNMENT` + incluido en `ACTIVE_STATUSES`
- `SettingsPage.tsx`: sección "Motorizados" con lista, toggle activo/inactivo, eliminar (soft/hard), formulario agregar

### Sesiones anteriores (pre-CLAUDE.md)
- Menú completo de Yebram's cargado en `prisma/seed.ts` (10 categorías, 62 ítems)
- Dual currency display (USD + Bs) en todos los mensajes al cliente
- Tema visual del dashboard: fondo `#111111`, acento dorado `#F5C518`
- Sistema de menú visual con fotos WhatsApp (media IDs en Redis)
- Sesiones abandonadas: recuperación automática con mensaje amigable
- Nombres de ítems acortados a ≤24 chars para límite de WhatsApp list rows
- Descripciones de ítems incluidas en el prompt LLM para matching semántico
- Detección de ambigüedad en pedidos: muestra lista interactiva de opciones
- Mensaje de bienvenida personalizado para Yebram's (sin "sin llamadas")

### 2026-03-28 (sesión 5) — Fix preguntas de menú + Fix cap WhatsApp list rows

**Bug 1 — Preguntas de categoría sin respuesta ("qué hamburguesas tienes?")**

Causa raíz: `isMenuQuestion()` interceptaba el mensaje (match `^qué`), `handleMenuQuestion()` hacía fuzzy match contra nombres de ítems ("Pana", "Clásica") → 0 candidatos → devolvía `false`, pero los callers en `main-menu.handler.ts` y `browse-categories.handler.ts` no verificaban el retorno — siempre hacían `return session` sin llamar `trySmartFallback`.

Fixes aplicados:
- `menu-question.helper.ts`: `candidates.length === 0` → `return false` (no enviar error, dejar pasar al LLM)
- `main-menu.handler.ts`: `const handled = await handleMenuQuestion(...); if (handled) return session;` — cae al LLM si no hay candidatos
- `browse-categories.handler.ts`: mismo patrón
- `browse-items.handler.ts`: importa `trySmartFallback`, lo llama antes del fallback a `showItems`
- `building-order.handler.ts`: `trySmartFallback` exportada, inyecta menú completo (`getActiveMenuForLlm`) en `generateFreeResponse`
- `gemini-client.ts`: `buildFreeResponseSystemPrompt` acepta `menu?: CategoryWithItems[]`, `formatMenuText()` formatea por categoría con nombre e precios USD/Bs

**Bug 2 — `showItems` crash con categorías >10 ítems (Hamburguesas: 16 ítems)**

Causa: WhatsApp `listMessage` tiene límite de 10 rows totales entre todas las secciones. El código intentaba 2 secciones de 9+10 = 19 rows.

Fix: `menu-display.ts` — separar `productRows` de `cartRows`. Cap: `maxProductRows = 10 - cartRows.length`. Si hay ítems ocultos, body del mensaje incluye `"(mostrando X de Y)\n_+Z más — escribe el nombre del que quieras_ 😊"`. Los ítems ocultos son accesibles escribiendo el nombre (LLM con menú completo los detecta).

### 2026-03-28 (sesión 6) — Eliminación sistema de zonas + fixes de flujo delivery

**Cambio de diseño: eliminación completa del sistema de zonas de delivery**

Motivo: `DELIVERY_ZONES` nunca se configuró en DB, causando que toda la lógica de Fase 1/Fase 2 fuera inaccesible. El sistema simplificado usa `DELIVERY_FEE_USD` global (ya existente).

Archivos modificados:
- `awaiting-delivery-address.handler.ts`: reescritura completa. Flujo: si cliente tiene `savedAddress` en DB → `askDeliveryAddressWithSaved`; si no → pide dirección. Texto libre ≥5 chars (incluye location convertida) → `confirmAndProceed` → `AWAITING_DELIVERY_REFERENCE`
- `session-manager.ts`: eliminados campos `deliveryZone` y `deliveryFeeUsd` de `SessionData`
- `config-service.ts`: eliminada clave `DELIVERY_ZONES` de `SystemConfigMap`
- `message-builder.ts`: eliminado `TEMPLATES.askDeliveryZone`
- `awaiting-payment-method.handler.ts`: fee simplificado a `getConfig('DELIVERY_FEE_USD')` directo; eliminada propagación de `deliveryZone`/`deliveryFeeUsd`
- `order-service.ts`: eliminados `deliveryZone` y `deliveryFeeUsd` de `CreateOrderInput`; columna `deliveryZone` en DB permanece (nullable, sin datos futuros)
- `report-service.ts`: eliminado `groupBy deliveryZone` del reporte diario
- `conversation-agent.ts`: `AWAITING_DELIVERY_ADDRESS` y `AWAITING_DELIVERY_REFERENCE` removidos de `PREPAYMENT_STATES` — ya no se llama `ORDER_EXTRACTION` al escribir una dirección (ahorro ~$0.0005/mensaje)
- `customer-service.ts`: `updateCustomerSavedAddress` ahora loguea `INFO` al guardar y el caller loguea `ERROR` si falla — diagnóstico visible si "Usar esta" no aparece

**Fix flujo location en Fase 1 (ahora irrelevante pero aplicado antes del rediseño):**
El webhook convierte `location` a `type: 'text'` antes de llegar al handler — no hay `msg.type === 'location'` posible. El mensaje "no llegamos a esa zona" fue reemplazado por "Para continuar, primero selecciona tu zona de delivery 👆" (luego eliminado con el rediseño completo).

### 2026-03-29 (sesión 7) — Refinamiento ORDER_EXTRACTION: intent MODIFY + carrito en contexto

**Cambio 1 — Nuevo intent `MODIFY`**
- `gemini-client.ts`: `UserIntent` incluye `'MODIFY'` — el cliente quiere cambiar algo del carrito actual (reemplazar, corregir, ajustar). Distinto de ORDER (agrega sin quitar) y de CANCEL (pedido ya pagado).
- `VALID_INTENTS` en el parser actualizado para incluir `'MODIFY'`.

**Cambio 2 — Carrito inyectado en el prompt de ORDER_EXTRACTION**
- `buildMenuSystemPrompt()`: nueva firma `(menu, dayPromos?, cartSummary?)`. Sección `CARRITO ACTUAL DEL CLIENTE` inyectada en el prompt — el LLM ve qué tiene el cliente antes de clasificar.
- `extractOrderFromText()`: nuevo parámetro `cartSummary?: string`, pasado a `buildMenuSystemPrompt`.
- `extractCartFromText()`: nuevo parámetro `cart?: CartItem[]`. Construye `cartSummary` en formato `"Nx Nombre — $X.XX"` y lo pasa a `extractOrderFromText`.

**Cambio 3 — Prompt mejorado**
- `ORDER` aclarado: incluye agregar adicionales sin quitar nada.
- `MODIFY`: items con `action:"remove"` para lo que sale + `action:"add"` para lo que entra.
- `QUIT` vs `CANCEL` redefinidos claramente: CANCEL solo para pedidos confirmados/pagados.
- Regla 11 nueva: CANCEL vs MODIFY vs QUIT con definiciones explícitas.
- Ejemplos venezolanos con carrito como contexto: "no, con refresco" → MODIFY, "y una coca también" → ORDER, "eso no, cámbialo" → MODIFY.

**Cambio 4 — Handler MODIFY en `building-order.handler.ts`**
- MODIFY sin ítems → `trySmartFallback` + botones de ayuda.
- MODIFY con ítems → procesa removes primero, luego adds (misma lógica existente), pero mensaje de confirmación natural venezolano:
  - Removes + adds: `"¡Listo! Te cambié [X] por [Y] 😊"`
  - Solo removes: `"¡Listo! Quité [X] de tu pedido 👌"`
  - Solo adds (edge case): `"¡Agregado! [X] va en tu pedido 🎉"`
- QUIT y CANCEL separados: QUIT limpia carrito y va a MAIN_MENU sin cancelar orden en DB; CANCEL cancela la orden activa en DB.

**Cambio 5 — Consistencia en callers**
- `building-order.handler.ts`: pasa `session.cart` a `extractCartFromText`.
- `main-menu.handler.ts` (`tryQuickOrder`): pasa `session.cart` a `extractCartFromText`.

---

## Metodología de trabajo con el arquitecto

- Muestra diff antes de aplicar cualquier cambio — sin excepción
- Un archivo a la vez cuando hay múltiples cambios relacionados
- No apliques sin confirmación explícita del arquitecto
- No refactorices nada fuera del scope de la tarea indicada
- Al terminar cada fase: actualiza ESTADO_ACTUAL.md y FEATURES.md si aplica
- Push solo cuando el arquitecto lo indique explícitamente