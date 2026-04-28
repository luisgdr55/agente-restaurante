# Features Roadmap

## ✅ IMPLEMENTADO — Comunicación PWA↔Backend completa (2026-04-15)
- Push en todos los cambios de status con url de tracking
- Página /order/:orderId con barra de progreso 5 fases + polling 10s
- Auto-redirect al abrir PWA si hay pedido activo en localStorage
- Re-upload comprobante desde tracking si pago rechazado
- Normalización 04xx→584xx en todas las push subscriptions

## FEATURE 1 — Validación automática pago móvil
Watchdog 90s que lee SMS/notificación bancaria.
Si coincide monto+referencia → confirma auto.
Si no llega → alerta admin validación manual.
Stack: app Android simple + webhook al backend.

## FEATURE 2 — Saludo personalizado LLM
Cliente recurrente ve saludo con su historial:
"¡Hola Pedro! ¿Vienes por otra Yebram's?"
LLM recibe: nombre, últimos 5 pedidos, ítem favorito.

## FEATURE 3 — PWA offline-first
Menú cacheado. Pedido en cola si sin internet.

## FEATURE 4 — Programa de fidelidad
Puntos por pedido → descuento automático.

## FEATURE 5 — ETA dinámico
Tiempo estimado según carga actual de cocina
+ zona de delivery + historial de tiempos reales.

## FEATURE 6 — Analytics por cliente
Frecuencia, ticket promedio, ítems favoritos.

## FEATURE 8 — Saludo personalizado en hero PWA
Debajo del eslogan "TU MENÚ SUPER CRUJIENTE", si el cliente
es recurrente (tiene pedidos previos en BD), mostrar en cursiva
dorada un saludo generado por LLM con su nombre e ítem favorito.
Ejemplo: "¿Otra vez por tu Yebram's+Papas, Pedro? 😏"
LLM recibe: nombre, últimos 3 pedidos, ítem más pedido.
Se carga via GET /api/public/greeting/:phone (con cache Redis 1h).

## FEATURE 9 — Ubicación GPS del cliente
El cliente puede compartir su ubicación en Checkout.
Las coordenadas se guardan en la orden.
El dashboard muestra link a Google Maps.
El QR del motorizado incluye maps.google.com/?q={lat},{lng}
para navegación directa.

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

## FEATURE 7 — Multi-pedido por motorizado
Un motorizado puede llevar varios pedidos simultáneos.
El admin agrupa las órdenes OUT_FOR_DELIVERY en una "ruta"
y genera un QR maestro. El motorizado escanea ese QR único
y ve una lista secuencial de entregas ordenadas por cercanía:
cliente 1 → cliente 2 → cliente 3.
Cada entrega tiene su propio botón "Confirmar entrega" independiente.
Al confirmar cada una, push al cliente correspondiente.
El dashboard muestra el progreso de la ruta en tiempo real.
