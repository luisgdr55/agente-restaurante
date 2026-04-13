# Estado Actual del Sistema
Última actualización: 2026-04-13

## Infraestructura
- Bot: https://yebrams.up.railway.app ✅
- Dashboard: https://yebrams-dashboard.up.railway.app ✅
- BD: PostgreSQL en Railway ✅
- Redis: Railway ✅
- Evolution API: NO desplegada aún

## Login dashboard
- PIN login falla (nginx no proxea /api al bot)
- PENDIENTE: fix nginx antes de continuar

## Migración PWA — Estado: NO INICIADA
Fases pendientes:
- Fase 0: Preparación ✅ (este paso)
- Fase 1: Backend Push Notifications
- Fase 2: PWA cliente
- Fase 3: PWA motorizado
- Fase 4: Reseñas desde PWA
- Fase 5: Limpieza Evolution API

## Decisiones arquitectónicas tomadas
- Sin WhatsApp API (ni Meta ni Evolution)
- Notificaciones via Web Push API
- WhatsApp solo como ticket prellenado
  (cliente lo envía manualmente al confirmar)
- Push notifications requieren aceptación
  del cliente — modal explicativo en primera visita
- Cliente identificado via localStorage + BD
- LLM genera saludo personalizado para recurrentes

## Archivos clave
- src/whatsapp/client.ts → META_LEGACY (no usar)
- src/whatsapp/webhook-handler.ts → META_LEGACY
- src/agent/conversation-agent.ts → DEPRECAR en Fase 5
- dashboard/nginx.conf → PENDIENTE fix proxy /api

## Próximo paso inmediato
Fix nginx.conf para que /api y /ws
hagan proxy a https://yebrams.up.railway.app
