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
> Todos los push de retención (segmento, reglas, predictivos) deben respetar la
> **Política Global de Soft Prompt** definida al inicio de este documento.
> El permiso ya fue solicitado en `ConfirmPage`/`OrderTrackingPage`; nunca volver a pedirlo.
> Si `Notification.permission === 'denied'` → usar WhatsApp Bridge automáticamente.

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

## FEATURE 17 — QR de Mesa

Parámetro `?mesa=X` en la URL de la PWA activa modo local:
- Oculta campo de dirección en Checkout (no aplica delivery)
- Muestra número de mesa en la `ConfirmPage` y en la card del dashboard
- El pedido se crea con `deliveryType: 'PICKUP'` y `tableNumber: X` en metadata
- Puntos del club de fidelidad se acumulan automáticamente
- El dashboard muestra la mesa en la card de la orden para que el mesero sepa a quién llevar
- El menú QR se imprime una vez y el link nunca cambia: `https://yebramspedidos.up.railway.app/?mesa=3`

**Implementación mínima**: agregar `tableNumber?: string` a `CreateOrderInput` y `Order`,
leer `?mesa` en `MenuPage`, pasarlo en el body del pedido, mostrarlo en dashboard.

---

## FEATURE 18 — Módulo IA Premium
> Extraído del tier PREMIUM de Feature 16 como servicio independiente vendible.

Informe mensual descargable + ingeniería de menú + análisis de upselling.
Servicio de pago adicional por restaurante — el dueño activa/desactiva desde Settings.
Facturación por uso: el sistema registra tokens consumidos por restaurante y puede
limitar a N informes/mes o cobrar por llamada.

Candidato para cuando el sistema tenga más de 1 restaurante activo.

---
