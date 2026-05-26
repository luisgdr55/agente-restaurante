# Features Roadmap

## ✅ IMPLEMENTADO — Comunicación PWA↔Backend completa (2026-04-15)
- Push en todos los cambios de status con url de tracking
- Página /order/:orderId con barra de progreso 5 fases + polling 10s
- Auto-redirect al abrir PWA si hay pedido activo en localStorage
- Re-upload comprobante desde tracking si pago rechazado
- Normalización 04xx→584xx en todas las push subscriptions

---

## 🔔 POLÍTICA GLOBAL — Soft Prompt de Notificaciones Push
> **Regla permanente — aplica a toda la PWA, presente y futura.**

### ❌ Prohibido
- Solicitar permiso de notificaciones automáticamente al cargar cualquier página
- Mostrar el diálogo nativo del browser sin que el usuario lo haya pedido conscientemente
- Pedir permiso en `MenuPage`, en `CheckoutPage` al cargar, o en cualquier pantalla de entrada

### ✅ Estrategia de soft prompt — solo en momentos de alta motivación

**Momento 1 — `ConfirmPage`** (justo después de confirmar el pedido):
```
Banner card:
🔔 Activa las notificaciones para seguir tu pedido en tiempo real y recibir promos exclusivas
[ Activar ] [ Ahora no ]
```
El botón "Activar" es el único que dispara `Notification.requestPermission()`.

**Momento 2 — `OrderTrackingPage`** (si notificaciones están `denied` o `default`):
```
Banner sutil al pie de la página — no intrusivo, sin modal
```

### Comportamiento según estado del permiso
| Estado (`Notification.permission`) | Acción |
|---|---|
| `granted` | No mostrar ningún banner — el usuario ya activó |
| `default` | Mostrar soft prompt en los momentos indicados |
| `denied` | NO mostrar el prompt nativo — mostrar alternativa: "📲 Te avisamos por WhatsApp" con link `wa.me` prellenado |

### Impacto en código actual
- `MenuPage.tsx`: **eliminar** el botón "🔔 Activar notificaciones" que aparece en desktop cuando `permission === 'default'` — viola esta política
- `NotificationModal.tsx`: componente existente puede reutilizarse en `ConfirmPage` con el nuevo copy
- Cualquier feature futura que use push (Feature 16, etc.) debe respetar estos puntos de activación

---

## FEATURE 1 — Validación automática pago móvil
Watchdog 90s que lee SMS/notificación bancaria.
Si coincide monto+referencia → confirma auto.
Si no llega → alerta admin validación manual.
Stack: app Android simple + webhook al backend.

---

## FEATURE 2 — Saludo personalizado LLM
> ⚠️ **Consolidado en Feature 16** — ver Motor de Retención e Inteligencia de Cliente.
> La lógica de saludo pasa a template strings sin LLM (CORE); el LLM queda en el tier PREMIUM.

---

## FEATURE 3 — PWA offline-first
Menú cacheado. Pedido en cola si sin internet.

---

## FEATURE 4 — Programa de fidelidad
> ⚠️ **Consolidado en Feature 16** — ver Motor de Retención e Inteligencia de Cliente.
> El club de puntos es parte del CORE de Feature 16.

---

## FEATURE 5 — ETA dinámico
Tiempo estimado según carga actual de cocina
+ zona de delivery + historial de tiempos reales.

---

## FEATURE 6 — Analytics por cliente
> ⚠️ **Consolidado en Feature 16** — ver Motor de Retención e Inteligencia de Cliente.
> Perfil RFM, historial, ticket promedio e ítem favorito son el núcleo de Feature 16 CORE.

---

## FEATURE 7 — Multi-pedido por motorizado
> ℹ️ Pendiente feedback del dueño.

Un motorizado puede llevar varios pedidos simultáneos.
El admin agrupa las órdenes OUT_FOR_DELIVERY en una "ruta"
y genera un QR maestro. El motorizado escanea ese QR único
y ve una lista secuencial de entregas ordenadas por cercanía:
cliente 1 → cliente 2 → cliente 3.
Cada entrega tiene su propio botón "Confirmar entrega" independiente.
Al confirmar cada una, push al cliente correspondiente.
El dashboard muestra el progreso de la ruta en tiempo real.

---

## FEATURE 8 — Saludo personalizado en hero PWA
> ⚠️ **Parcialmente consolidado en Feature 16 CORE** — la generación del saludo pasa a
> template strings sin LLM. El endpoint `/api/public/greeting/:phone` se mantiene pero
> devuelve texto generado localmente.

Debajo del eslogan "TU MENÚ SUPER CRUJIENTE", si el cliente es recurrente muestra
en cursiva dorada: "¿Otra vez por tu Yebram's+Papas, Pedro? 😏"
Basado en: nombre + ítem más pedido + día habitual + último pedido.
Cache Redis 1h.

---

## FEATURE 9 — Ubicación GPS del cliente
El cliente puede compartir su ubicación en Checkout.
Las coordenadas se guardan en la orden.
El dashboard muestra link a Google Maps.
El QR del motorizado incluye maps.google.com/?q={lat},{lng}
para navegación directa.

---

## FEATURE 10 — Stories de promos con foto
Carrusel de fotos entre Hero y tabs del menú en la PWA.
Cada story puede vincularse a un ítem del menú con precio especial opcional.
Publicación instantánea desde sección Promos del dashboard.
Expiración configurable por días.

---

## FEATURE 11 — Módulo de Caja

### Objetivo
Panel "Caja" en el dashboard para control de turnos de cajeras, cuadre de caja
y export automático a la plantilla Excel del restaurante.

### Flujo de dos turnos por día
```
Turno mañana:  [Apertura AM]  →  [Cierre AM / Mediodía]
Turno tarde:   [Apertura PM]  →  [Cierre PM / Noche]
```

### Apertura de turno
- Cajera selecciona su nombre (lista configurable en Settings)
- Ingresa el monto inicial de efectivo en caja (Bs)
- Hora de apertura se registra automáticamente (Venezuela UTC-4)
- Crea un registro `CashRegisterShift` en BD con estado `OPEN`

### Cierre de turno
El sistema calcula automáticamente del período de turno:
- Total en ventas Pago Móvil (confirmadas) en Bs y USD
- Total en ventas Efectivo (CASH_ON_DELIVERY entregadas) en Bs y USD
- Total en ventas POS (confirmadas) en Bs y USD
- Número de pedidos por método de pago
- Total general del período

La cajera ingresa manualmente:
- Efectivo real contado en caja al cierre (Bs)
- Total sistema de comandas del restaurante (Bs) — ingreso manual del sistema POS externo

El sistema calcula y muestra:
- Diferencia efectivo: `efectivo_contado − (efectivo_apertura + ventas_efectivo_calculadas)`
- Diferencia comandas: `comandas_ingresadas − ventas_pago_movil_calculadas`
- Badge: 🟢 Cuadre exacto / 🟡 Diferencia < 5% / 🔴 Diferencia > 5%

### Historial de turnos
Tabla con todos los turnos registrados:
- Cajera, fecha, turno (AM/PM), apertura, cierre
- Ventas calculadas vs ingresadas
- Diferencia y badge de cuadre

### Export a plantilla Excel
- Dashboard Settings permite subir una plantilla `.xlsx` del restaurante (vía SheetJS)
- El sistema detecta o permite mapear manualmente las celdas clave de la plantilla:
  `fecha`, `cajera`, `monto_apertura`, `ventas_efectivo`, `ventas_pago_movil`,
  `ventas_pos`, `total_calculado`, `efectivo_contado`, `diferencia`, etc.
- Al cerrar turno: botón "Descargar Excel" — carga la plantilla guardada, llena
  las celdas mapeadas con los datos del turno, descarga el archivo listo
- Librería: **SheetJS (xlsx)** — `npm install xlsx`
- Formato: `.xlsx` (preserva fórmulas y estilos de la plantilla original)

### Modelo de datos (Prisma)
```prisma
model CashRegisterShift {
  id              String    @id @default(cuid())
  cashierName     String
  shiftType       String    // 'AM' | 'PM'
  openedAt        DateTime
  closedAt        DateTime?
  openingCash     Decimal   // efectivo inicial en Bs
  closingCash     Decimal?  // efectivo contado al cierre
  comandasTotal   Decimal?  // comandas ingresadas manualmente
  calcCashSales   Decimal?  // calculado: ventas efectivo del período
  calcMovilSales  Decimal?  // calculado: ventas pago móvil del período
  calcPosSales    Decimal?  // calculado: ventas POS del período
  calcTotal       Decimal?  // calculado: total del período
  difference      Decimal?  // diferencia (contado - calculado)
  status          String    @default("OPEN") // 'OPEN' | 'CLOSED'
  createdAt       DateTime  @default(now())
}
```

### Endpoints nuevos
- `POST /api/cash/shifts/open` — abre turno
- `POST /api/cash/shifts/:id/close` — cierra turno (calcula del período automático)
- `GET /api/cash/shifts` — historial paginado
- `GET /api/cash/shifts/:id/export` — devuelve JSON con datos para rellenar la plantilla
- `PUT /api/cash/template` — guarda la plantilla base64 en BD o storage
- `GET /api/cash/template` — descarga la plantilla para mapeo

### Agrupación automática por método de pago
Al cerrar un turno, el sistema agrupa todos los pedidos del período por método:

| Método | Campo en Order | Incluye |
|---|---|---|
| Pago Móvil | `paymentMethod === 'PAGO_MOVIL'` | Pedidos `PAYMENT_CONFIRMED` o posteriores |
| Efectivo | `paymentMethod === 'CASH_ON_DELIVERY'` | Solo pedidos `DELIVERED` |
| POS / Biopago | `paymentMethod === 'POS'` | Pedidos `PAYMENT_CONFIRMED` o posteriores |

Por cada grupo: **cantidad de pedidos + suma total en Bs + suma total en USD**.

### Reporte de referencia al cierre
Generado automáticamente al cerrar turno — campos para comparar con el sistema externo del restaurante:

```
TURNO AM — Cajera: María — 28/05/2026
───────────────────────────────────────
Pago Móvil:    12 pedidos | Bs 1.240,00 | $34.25
Efectivo Bs:    4 pedidos | Bs   380,00 | $10.51
Efectivo USD:   2 pedidos |              $12.00
Tarjetas POS:   3 pedidos | Bs   620,00 | $17.13
───────────────────────────────────────
Total nuestro sistema:   Bs 2.640,00 | $73.89
Total Sinclair (cajera): _____________
Gran total consolidado:  _____________
```

"Total Sinclair" y "Gran total consolidado" se ingresan manualmente por la cajera al cierre.

### Envío automático al dueño al cerrar turno
Al presionar "Cerrar turno":
1. Genera link `wa.me/{ADMIN_PHONE}` con el resumen prellenado — la cajera solo toca "Enviar"
2. Envía push notification al dashboard del dueño: "Turno AM cerrado — ventas $73.89 | Bs 2.640,00"

El número del dueño se lee de `getConfig('ADMIN_PHONE')`.

### Turnos por día
Exactamente dos turnos por día (AM y PM). Ambas cajeras operan en el mismo sistema; el historial identifica cada turno por cajera + tipo (AM/PM) + fecha.

### Stack
- Frontend: nueva pestaña "Caja" en NavBar dashboard
- `CashRegisterPage.tsx` — vista principal con estado del turno activo + historial
- `ExcelTemplateMapper.tsx` — componente para mapear celdas de la plantilla
- Backend: `src/api/cash.routes.ts`
- BD: migración Prisma + tabla `CashRegisterShift`
- SheetJS: fill-and-download en el frontend (no requiere servidor)

---

## FEATURE 12 — (reservado)
> ⚠️ **Consolidado en Feature 16** — ver Motor de Retención e Inteligencia de Cliente.

---

## FEATURE 16 — Motor de Retención e Inteligencia de Cliente
> Engloba y reemplaza Features 2, 4, 6 y 12.

Motor de retención sin LLM en el tier base — lógica matemática pura en servidor.
Tier premium opcional con Claude para informes de alto valor.

### CORE — Sin tokens (incluido en precio base)

#### Perfil por cliente
Calculado en cron job nocturno con queries SQL puras, sin ML:
- Historial completo de pedidos
- Ítem favorito (más pedido por frecuencia)
- Día y hora habitual (moda del `createdAt`)
- Ticket promedio (AVG totalUsd)
- Días desde último pedido (recencia)

#### Segmentación RFM automática
Cron job nocturno clasifica a cada cliente en un segmento y actualiza `Customer.segment`:

| Segmento | Criterio | Acción automática |
|---|---|---|
| **Campeón** | Alta frecuencia + alto gasto | Push de reconocimiento + acceso primicias |
| **En riesgo (churn)** | Desviación de su patrón habitual | Push con oferta antes de perderlo |
| **Nuevo** | Primer pedido en los últimos 7 días | Push de bienvenida personalizado |
| **Nocturno/frecuencial** | Patrón horario detectado | Push predictivo en su horario habitual |

Ejemplo patrón nocturno: Pedro pide todos los viernes a las 8 PM → jueves 7:30 PM recibe push
"¿Esta noche hay antojo de Yebram's, Pedro? 🍗" — sin LLM, con data real.

#### Reglas configurables por el dueño
En dashboard Settings → sección "Retención":
- "Si cliente sin pedido X días → enviar mensaje Y"
- "Si cliente hace N pedidos → otorgar beneficio Z"
- Reglas activadas/desactivadas con toggle

#### Hero PWA — saludo con template strings inteligentes
`GET /api/public/greeting/:phone` (cache Redis 1h) devuelve texto generado localmente:
```
"¿Otra vez por tu Yebram's+Papas, Pedro? 😏"   ← ítem favorito + nombre
"¡Bienvenido de vuelta, Pedro! 🔥"               ← cliente en riesgo
"¡Hola Pedro, qué bueno verte de nuevo! 👋"      ← primera vez / sin datos
```
Sin LLM. Template strings con datos reales de `Customer.favoriteItem`, `Customer.segment`.

#### Club de puntos
- $1 USD = X puntos (configurable por dueño en Settings)
- Barra de progreso en PWA con puntos acumulados y próxima recompensa
- Canje por ítems de alto margen configurados por el dueño
- Puntos visibles en `ConfirmPage` y `OrderTrackingPage`

#### Push en retención — política obligatoria
> **Soft prompt SOLO en dos momentos:**
> 1. `ConfirmPage` — justo después de confirmar pedido (banner con copy motivacional)
> 2. `OrderTrackingPage` — banner sutil al pie si permiso no concedido
>
> **NUNCA** al entrar a la app, al cargar `MenuPage`, ni de forma automática en ningún otro momento.
> Si `Notification.permission === 'denied'` → no mostrar diálogo nativo; usar WhatsApp Bridge automáticamente.
> Si `Notification.permission === 'granted'` → no mostrar ningún banner; el permiso ya existe.
> Ver spec completo en **Política Global de Soft Prompt** al inicio de este documento.

#### WhatsApp Bridge
Si la suscripción push está inactiva (cliente no dio permiso o desinstalado), el dashboard
genera un link `wa.me` con mensaje personalizado por segmento para que el admin lo envíe
manualmente o vía Evolution API.

### PREMIUM — Con tokens (cobro adicional al restaurante)

#### Informe mensual con Claude
- Cron job mensual compila métricas anonimizadas → JSON estructurado → Claude API
- Claude genera análisis narrativo en español:
  - **Ingeniería de menú**: platos estrella (alto volumen + margen) vs platos muertos (bajo volumen + bajo margen) → recomendación de precio o baja
  - **Horas/días flojos** → sugerencia de promos con costo marginal estimado
  - **Upselling inteligente**: pares de ítems frecuentemente pedidos juntos → oportunidades de combos
- Salida: PDF descargable en dashboard → sección "Informes IA"
- Billing: el restaurante paga por token en este endpoint; el sistema puede limitarlo a 1/mes

### Modelo de datos (adiciones a Prisma)
```prisma
// Campos nuevos en Customer:
  segment         String?   // 'champion' | 'at_risk' | 'new' | 'nocturnal' | null
  favoriteItem    String?   // nombre del ítem más pedido
  avgTicketUsd    Decimal?
  lastOrderAt     DateTime?
  totalPoints     Int       @default(0)

model LoyaltyTransaction {
  id          String   @id @default(cuid())
  customerId  String
  orderId     String?
  points      Int      // positivo = acumula, negativo = canje
  reason      String   // 'order' | 'redemption' | 'bonus'
  createdAt   DateTime @default(now())
  customer    Customer @relation(fields: [customerId], references: [id])
}

model RetentionRule {
  id          String   @id @default(cuid())
  name        String
  condition   Json     // { type: 'days_inactive', value: 7 }
  action      Json     // { type: 'push', message: '...' }
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
}
```

### Stack
- Cron job: `src/workers/retention-worker.ts` (BullMQ, dispara 2 AM Venezuela)
- Segmentación: `src/retention/rfm-segmenter.ts` (queries SQL, sin ML)
- Reglas: `src/retention/rule-engine.ts`
- Endpoint greeting: `GET /api/public/greeting/:phone` (cache Redis 1h)
- Dashboard: pestaña "Clientes" enriquecida + sección "Retención" en Settings
- Informe IA: `src/retention/ai-report.ts` → Claude claude-sonnet-4-6 con prompt caching

---

## FEATURE 17 — PWA Mesonero

Tercera PWA (o modo especial de la PWA cliente) para tablet del mesonero en el local.
Interfaz optimizada para tomar pedidos de mesa rápidamente sin salir del restaurante.

### Principios de diseño
- **Sin delivery**: sin campos de dirección ni opciones de envío — pedidos locales únicamente
- **Sin comprobante digital**: el pago se gestiona en el momento en mesa (no se sube foto)
- **Mesa obligatoria**: campo de número de mesa siempre visible y requerido
- **Tablet-first**: botones grandes, scroll mínimo, flujo de 3 pasos máximo
- **Pedidos al mismo dashboard y cocina**: sin infraestructura paralela

### Flujo del mesonero
```
Tablet carga PWA mesonero → selecciona mesa → elige ítems → selecciona método de pago
  → confirma pedido → badge "🍽️ MESA X" en dashboard y cocina
  → cocina prepara y marca READY → mesonero lleva el pedido
  → mesonero registra cobro → pedido DELIVERED
```

### Diferenciación visual en dashboard y cocina
Los pedidos del mesonero llevan badge claro diferenciado:
- `🍽️ MESA 4` — pedido de mesa (esta feature)
- `🛵 DELIVERY` — pedido con entrega a domicilio
- `🏪 PICKUP` — pedido para retirar en local (sin mesa)

La `KitchenPage` ve todos los pedidos mezclados en el mismo flujo — sin cambios de infraestructura.

### Métodos de pago en mesa

#### Efectivo
- El mesonero selecciona "Efectivo"
- El pedido queda pendiente de cobro — pago al final en caja
- El módulo de Caja (Feature 11) acumula estos pedidos en la columna "Efectivo"

#### Pago Móvil en mesa
- El mesonero selecciona "Pago Móvil"
- La PWA muestra **QR grande y legible** generado a partir de la config del restaurante:
  banco, teléfono, RIF (leídos de `getConfig('PAGO_MOVIL_*')`)
- El cliente escanea el QR con su app bancaria directamente desde la tablet del mesonero
- El cliente realiza el pago; el mesonero confirma ingresando el número de referencia
  o capturando el comprobante con la cámara de la tablet
- El pedido queda como `PAYMENT_UPLOADED` — el admin/cajera verifica igual que los pedidos digitales

#### Punto de Venta / Biopago (POS)
- El mesonero selecciona "POS"
- El pedido se marca para cobro con datáfono
- El dashboard muestra "POS" como método de pago en la card de la orden

### Visibilidad del método en dashboard
La card de cada pedido muestra claramente el método elegido:
`💳 POS` / `📱 Pago Móvil` / `💵 Efectivo`
La cajera puede ver totales separados por método en el módulo de Caja (Feature 11),
incluyendo los pedidos de mesa.

### Implementación técnica
- **Opción A (recomendada)**: misma PWA cliente con parámetro `?mesonero=1&mesa=X` que activa modo mesonero
  - Oculta sección delivery, oculta upload de comprobante, fuerza campo mesa
  - URL estática por mesa: `https://yebramspedidos.up.railway.app/?mesonero=1&mesa=3`
- **Opción B**: sub-dominio o ruta separada `/mesonero` — mayor aislamiento, más build complexity

### Modelo de datos
- `tableNumber?: string` en `CreateOrderInput` y `Order` (campo nuevo Prisma)
- `deliveryType: 'TABLE'` nuevo valor en enum, o reutilizar `'PICKUP'` con `tableNumber` presente
- Badge en `OrderCard.tsx` y `KitchenPage.tsx`: condicional por `tableNumber`

### QR de mesa (implementación mínima inicial)
El link de la PWA en modo mesonero se imprime una vez como QR por mesa y no cambia:
`https://yebramspedidos.up.railway.app/?mesonero=1&mesa=3`

---

## FEATURE 18 — Módulo IA Premium
> Extraído del tier PREMIUM de Feature 16 como servicio independiente vendible.

Informe mensual descargable + ingeniería de menú + análisis de upselling.
Servicio de pago adicional por restaurante — el dueño activa/desactiva desde Settings.
Facturación por uso: el sistema registra tokens consumidos por restaurante y puede
limitar a N informes/mes o cobrar por llamada.

Candidato para cuando el sistema tenga más de 1 restaurante activo.

---

## FEATURE 19 — Módulo Control de Crisis

Panel en dashboard (pestaña o sección en Settings) con toggles de activación inmediata.
**Sin nueva infraestructura** — todos los estados viven en la tabla `SystemConfig` existente.

### Modos de crisis

| Toggle | Clave Config | Efecto en PWA | Efecto en backend |
|---|---|---|---|
| **ALTA_DEMANDA** | `CRISIS_HIGH_DEMAND` | Banner ámbar sticky: "Alta demanda — puede haber demora" | Suma `CRISIS_ETA_EXTRA_MIN` al ETA de nuevos pedidos |
| **SIN_LUZ / CONTINGENCIA** | `CRISIS_OUTAGE` | Banner rojo con mensaje personalizable `CRISIS_OUTAGE_MSG` | — |
| **PAUSA_PEDIDOS** | `CRISIS_PAUSE_ORDERS` | Checkout deshabilitado + contador visible: "Reabrimos en X min" | `POST /api/public/orders` rechaza con mensaje amigable |
| **ITEM_OCULTO** | Por ítem en `MenuItem.isAvailable` | Ítem desaparece del menú sin eliminarlo de BD | Validación en create order |

### Comportamiento de PAUSA_PEDIDOS
- `CRISIS_PAUSE_ORDERS` = `'true'` y `CRISIS_PAUSE_UNTIL` = ISO timestamp de reapertura
- `POST /api/public/orders` valida: si activo y `now < CRISIS_PAUSE_UNTIL` → responde `409` con `{ message: "Pedidos en pausa hasta las HH:MM. ¡Volvemos enseguida! 🙏" }`
- Contador en PWA hace countdown hasta `CRISIS_PAUSE_UNTIL`
- Al expirar: checkout se reactiva solo (la PWA recarga config cada vez que llega a CheckoutPage)

### Claves en SystemConfig
```
CRISIS_HIGH_DEMAND     'true' | 'false'
CRISIS_ETA_EXTRA_MIN   '15'              (minutos extra al ETA)
CRISIS_OUTAGE          'true' | 'false'
CRISIS_OUTAGE_MSG      'Estamos sin luz, volvemos en 1 hora 🕯️'
CRISIS_PAUSE_ORDERS    'true' | 'false'
CRISIS_PAUSE_UNTIL     '2026-04-28T22:00:00Z'  (ISO — vacío si inactivo)
```

### Stack
- Backend: validación en `POST /api/public/orders` + nuevo endpoint `GET /api/public/config` ya expone estas claves
- Frontend PWA: `MenuPage`/`CheckoutPage` leen las claves de `PublicConfig`; banners condicionales
- Dashboard: panel "Control de Crisis" — 4 toggles con labels claros, input para mensaje y duración

---

## FEATURE 20 — El Plato de Siempre

Banner en hero de la PWA debajo del saludo de bienvenida.

### Lógica
- Query SQL: ítem más pedido por teléfono del cliente (ordenado por frecuencia)
- Solo aparece si el cliente tiene **2+ pedidos previos**
- Cache Redis 1h por teléfono (`usual:phone:584XXXXXXXXX`) — sin costo de BD en cada carga

### UX
```
┌────────────────────────────────────────────┐
│  ¿La misma de siempre, Pedro?              │
│  2× Hamburguesa Yebram's + Papas           │
│  [ ➕ Agregar al carrito ]                  │
└────────────────────────────────────────────┘
```
- Botón "Agregar al carrito" → agrega directamente con la cantidad habitual (moda del historial), sin abrir modal
- Si el cliente modifica la cantidad habitual → el sistema lo aprende en el siguiente ciclo de cache

### Endpoint
`GET /api/public/usual/:phone` → `{ itemId, name, imageUrl, priceUsd, usualQty }` o `null`

### Stack
- Backend: `src/api/public.routes.ts` + cache Redis
- PWA `MenuPage.tsx`: fetch al cargar si hay `yebrams_customer_phone` en localStorage

---

## FEATURE 21 — Cross-selling en carrito

Modal de sugerencias estilo grandes cadenas (McDonald's, KFC) que se activa justo antes de navegar al Checkout — no durante la navegación por el menú.

### Activación
- El cliente toca **"Ir a pagar"** en el `CartDrawer`
- Antes de navegar a `/checkout`, se abre un **modal / bottom sheet** desde abajo
- Solo se muestra si existe al menos un ítem disponible en las categorías de sugerencia configuradas
- Si no hay ítems disponibles, navega directo al Checkout sin modal

### UX del modal
```
┌─────────────────────────────────┐
│  ¿Le agregas algo más? 😋    ×  │
│                                 │
│  ←  [ foto | Nombre  $1.50 ➕ ] [ foto | Nombre  $2.00 ➕ ] →  │
│        (carrusel horizontal, 4-6 ítems)                         │
│                                 │
│  [ Continuar con mi pedido → ]  │
└─────────────────────────────────┘
```
- Carrusel horizontal con foto, nombre y precio de cada ítem
- Botón **"➕ Agregar"** por ítem — lo añade al carrito **sin cerrar el modal**
- El botón cambia a **"✓ Agregado"** (estado visual) tras tocarlo
- Botón **"Continuar con mi pedido →"** — cierra el modal y navega al Checkout
- Botón **"×"** (esquina superior derecha) — cierra el modal y navega al Checkout sin agregar nada
- Ítems ya presentes en el carrito no aparecen como sugerencias

### Lógica de sugerencias
- Sin tabla adicional ni ML: usa el **menú existente filtrado por categorías marcadas**
- Las categorías configuradas como "de sugerencia" se obtienen de `SystemConfig` clave `SUGGESTION_CATEGORY_IDS` (JSON array de IDs de categoría)
- Se toman hasta 6 ítems activos de esas categorías, excluyendo los ya en el carrito
- Orden: categorías en el orden del JSON, ítems por `sortOrder` dentro de cada categoría

### Dashboard — configuración
En `SettingsPage`, sección **"Cross-selling"**:
- Lista de todas las categorías del menú con un toggle activo/inactivo
- Las categorías activadas se guardan en `SystemConfig` como `SUGGESTION_CATEGORY_IDS`
- Valor por defecto sugerido: Complementos, Bebidas, Postres
- Sin drag & drop necesario — el orden de las categorías en el menú define el orden de sugerencias

### Config keys
| Clave | Ejemplo |
|---|---|
| `SUGGESTION_CATEGORY_IDS` | `["cat_abc123","cat_def456","cat_ghi789"]` |

### Endpoints
- `GET /api/public/menu/suggestions` — devuelve hasta 6 ítems activos de las categorías configuradas; requiere query param `?exclude=id1,id2` con los IDs ya en el carrito
- `GET/PATCH /api/config/suggestion-categories` (auth dashboard) — leer/guardar los IDs de categorías de sugerencia

### Implementación cliente (sin backend nuevo si se prefiere)
Alternativa sin endpoint dedicado: el cliente ya tiene el menú completo en memoria (cacheado en `menuApi.getMenu()`); filtrar categorías por IDs de `SystemConfig` en el frontend sin request adicional al abrir el modal.

---

## FEATURE 22 — Badge VIP en cocina y dashboard

Si el cliente de un pedido tiene `Customer.segment === 'champion'` (Feature 16 RFM):
- `KitchenPage`: estrella ⭐ dorada junto al nombre del cliente en la card de cocina
- `OrderCard` dashboard: badge ⭐ VIP junto al nombre
- Sin costo adicional — dato ya calculado por el cron de Feature 16

### Implementación mínima
- `Order` debe exponer `customer.segment` en los endpoints de dashboard y cocina (ya incluido en `include: { customer: true }`)
- Condicional `{order.customer.segment === 'champion' && <span>⭐</span>}` en ambos componentes

---

## FEATURE 23 — Validación cruzada cliente

Botón en `OrderTrackingPage` cuando el pedido está en `OUT_FOR_DELIVERY`:
```
[ ✅ Ya recibí mi pedido ]
```

### Comportamiento
- Al confirmar (modal de confirmación primero): llama `POST /api/public/orders/:id/delivered`
- Endpoint existente — ya cierra el pedido y envía notificaciones
- Libera puntos de fidelidad (Feature 16) al cliente al cerrar
- Si el motorizado ya confirmó antes → endpoint responde con el estado actual (idempotente)
- Si el cliente confirma antes → el botón del motorizado en `DriverPage` queda inactivo con mensaje "El cliente ya confirmó la entrega ✅"

### Regla: el primero que confirme cierra el pedido
Ambos botones (cliente y motorizado) llaman al mismo endpoint. La lógica de idempotencia ya existe — si la orden ya está `DELIVERED`, el endpoint lo ignora sin error.

---

## FEATURE 24 — Cron seguridad pedidos zombies

Previene pedidos atascados indefinidamente en `OUT_FOR_DELIVERY`.

### Comportamiento
- `node-cron` cada 30 minutos (o BullMQ repeat job)
- Busca pedidos en `OUT_FOR_DELIVERY` con `updatedAt < now - 3 horas`
- Los fuerza a `DELIVERED` con `cancelReason: '⚠️ Auto-cerrado por timeout'`
- Registra incidencia en log estructurado (`logger.warn`) con `orderId`, `driverPhone`, tiempo transcurrido
- El dashboard muestra el `cancelReason` en la card de pedidos históricos

### Infraestructura
- Sin nueva tabla — usa campos existentes `status`, `cancelReason`, `deliveredAt`
- Worker: agregar al `session-cleanup.ts` existente o crear `src/workers/zombie-cleanup.ts`
- Endpoint opcional: `GET /api/orders/incidents` para que el admin vea el log de auto-cierres

---

## FEATURE 25 — Optimización carga PWA

Target: **carga inicial < 3 segundos en 4G venezolano** (~5 Mbps).

### WebP automático al subir imágenes
- Al subir imagen desde dashboard (ítems del menú, stories): conversión automática a WebP en el backend
- Stack: `sharp` en Node.js (`npm install sharp`) — sin dependencias del OS
- Calidad: 80% WebP ≈ 60% del tamaño JPEG/PNG sin pérdida visual perceptible
- Dimensiones: resize a max 800×600px (suficiente para cards del menú en móvil)
- Almacenamiento: URL resultante reemplaza la original en `MenuItem.imageUrl`

### Lazy loading en grid de ítems
- `<img loading="lazy">` en todas las cards del menú — ya soportado nativamente en Chrome/Safari/Firefox
- Intersection Observer como fallback para browsers viejos (opcional)
- Solo carga imágenes visibles en el viewport inicial — las demás esperan al hacer scroll

### Otras mejoras
- `rel="preload"` para la imagen hero del restaurante (primera imagen visible)
- Skeleton loaders en el grid mientras cargan las imágenes (ya implementado parcialmente)
- Audit Lighthouse en cada deploy para detectar regresiones

---

## FEATURE 26 — Animación barra de progreso en OrderTrackingPage

Mejora visual de la barra de progreso de 5 fases para hacerla más legible y llamativa.

### Comportamiento
- El paso activo pulsa/brilla con animación CSS continua (`@keyframes`)
- El punto (círculo) del paso activo emite glow del color del estado:
  - Dorado `#F5C518` — estado PAYMENT_CONFIRMED (pago verificado)
  - Naranja `#f97316` — estado IN_KITCHEN (en cocina)
  - Verde `#22c55e` — estados READY, OUT_FOR_DELIVERY, DELIVERED
- Iconos y texto de todos los pasos aumentados para mayor legibilidad en móvil

### Implementación
- `OrderTrackingPage.tsx`: añadir `@keyframes progressGlow` en los estilos inline del componente
- El glow se aplica solo al paso cuyo índice coincide con `currentPhase`
- Color del glow se calcula a partir del `status` actual de la orden
- El resto de pasos completos mantienen su color sólido sin animación (no distraen)
- Los pasos futuros (grises) sin cambio

### Referencia de colores por estado
| Status | Color glow |
|---|---|
| PAYMENT_CONFIRMED | `rgba(245,197,24,0.6)` dorado |
| IN_KITCHEN | `rgba(249,115,22,0.6)` naranja |
| READY / OUT_FOR_DELIVERY / DELIVERED | `rgba(34,197,94,0.6)` verde |

---

## FEATURE 27 — Ticket impresión cocina

> ⚠️ **Pendiente confirmar modelo de impresora** con el dueño del restaurante antes de implementar.

Impresión automática de ticket en cocina al confirmar pago. Formato térmico 80mm.
Contenido: número de pedido, ítems con cantidad, notas especiales, tipo (DELIVERY/PICKUP/MESA X), hora.
Stack candidato: `node-thermal-printer` o ESC/POS directo según modelo de impresora.

---

## FEATURE 28 — Modo Offline / Red Local

Dos escenarios de funcionamiento sin internet externo.

### Escenario A — Mesonero sin internet en tablet
**Service Worker + IndexedDB** para pedidos locales:
- El mesonero toma pedidos en la tablet aunque no haya señal
- Los pedidos se guardan en `IndexedDB` localmente
- Al recuperar conexión WiFi → Background Sync API envía los pedidos al backend
- El menú se sirve desde Service Worker cache (actualizado al abrir la app con conexión)

### Escenario B — Restaurante sin internet externo
**Backend local en PC del restaurante**:
- El mismo código de Railway corre en Node.js local (ningún cambio de código — solo `.env` diferente)
- Tablet del mesonero → WiFi interna → backend local → dashboard cocina en la misma red
- PostgreSQL y Redis corren en Docker en la PC del restaurante
- **Sin acceso a Railway ni internet externo**: todo funciona en intranet

### Canal externo como fallback (clientes con datos móviles)
- El cliente con internet puede seguir pidiendo a Railway normalmente
- Si el dashboard del restaurante no tiene internet: push notification al teléfono del admin
  como fallback (push web funciona siempre que el admin tenga datos en su celular)
- El admin ve el pedido en la PWA de tracking desde su celular con datos

### Mismo código deployable en ambos entornos
- `docker-compose.yml` ya existente cubre el entorno local completo (postgres + redis + app)
- Solo requiere cambiar variables de entorno: `DATABASE_URL`, `REDIS_URL`, URLs públicas → `localhost`
- Sin bifurcaciones de código — un solo codebase para Railway y local

### Stack
- Service Worker: `workbox` o vanilla SW con `BackgroundSyncPlugin`
- IndexedDB: `idb` (wrapper liviano) para almacenar pedidos pendientes
- Backend local: instrucciones de setup en README para instalar en PC Windows/Linux del restaurante

---
