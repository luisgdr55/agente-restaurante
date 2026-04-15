# Features Roadmap

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

## FEATURE 7 — Multi-pedido por motorizado
Un motorizado puede llevar varios pedidos simultáneos.
El admin agrupa las órdenes OUT_FOR_DELIVERY en una "ruta"
y genera un QR maestro. El motorizado escanea ese QR único
y ve una lista secuencial de entregas ordenadas por cercanía:
cliente 1 → cliente 2 → cliente 3.
Cada entrega tiene su propio botón "Confirmar entrega" independiente.
Al confirmar cada una, push al cliente correspondiente.
El dashboard muestra el progreso de la ruta en tiempo real.
