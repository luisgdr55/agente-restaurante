import { useState } from 'react'
import axios from 'axios'

const ASKED_KEY = 'yebrams_push_asked'

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const arr = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i)
  return arr.buffer
}

interface NotificationModalProps {
  phone: string
  vapidPublicKey: string
  onClose: () => void
}

export function hasBeenAsked(): boolean {
  return localStorage.getItem(ASKED_KEY) === '1'
}

export default function NotificationModal({ phone, vapidPublicKey, onClose }: NotificationModalProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'denied'>('idle')

  const handleAllow = async () => {
    setStatus('loading')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus('denied')
        localStorage.setItem(ASKED_KEY, '1')
        return
      }

      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })

      const sub = subscription.toJSON() as {
        endpoint: string
        keys: { p256dh: string; auth: string }
      }

      await axios.post(`${import.meta.env.VITE_BACKEND_URL ?? 'https://yebrams.up.railway.app'}/api/push/subscribe`, {
        endpoint: sub.endpoint,
        keys: sub.keys,
        phone,
      })

      localStorage.setItem(ASKED_KEY, '1')
      setStatus('success')
      setTimeout(onClose, 1800)
    } catch {
      setStatus('error')
      localStorage.setItem(ASKED_KEY, '1')
    }
  }

  const handleDismiss = () => {
    localStorage.setItem(ASKED_KEY, '1')
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 300,
      }} />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        background: 'var(--surface)',
        borderRadius: '20px 20px 0 0',
        zIndex: 301,
        padding: '2rem 1.5rem',
        textAlign: 'center',
      }}>
        {status === 'success' ? (
          <>
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🔔</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              ¡Notificaciones activadas!
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Te avisaremos cuando tu pedido esté confirmado y en camino.
            </p>
          </>
        ) : status === 'denied' ? (
          <>
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>😔</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Notificaciones bloqueadas
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Puedes activarlas desde la configuración del navegador cuando quieras.
            </p>
            <button onClick={onClose} style={{
              width: '100%', padding: '0.8rem',
              background: 'var(--surface2)', color: 'var(--text-muted)',
              borderRadius: 12, fontWeight: 600,
            }}>Entendido</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🔔</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              ¿Activar notificaciones?
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              Te avisaremos cuando:
            </p>
            <ul style={{
              listStyle: 'none', color: 'var(--text-muted)',
              fontSize: '0.88rem', lineHeight: 2, marginBottom: '1.75rem',
            }}>
              <li>✅ Tu pago sea confirmado</li>
              <li>🍳 Tu pedido esté en cocina</li>
              <li>🛵 El motorizado salga hacia ti</li>
              <li>🙌 Tu pedido sea entregado</li>
            </ul>

            {status === 'error' && (
              <p style={{ color: 'var(--error)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                Ocurrió un error. Intenta de nuevo.
              </p>
            )}

            <button
              onClick={() => void handleAllow()}
              disabled={status === 'loading'}
              style={{
                width: '100%', padding: '0.9rem',
                background: 'var(--accent)', color: '#000',
                borderRadius: 12, fontWeight: 700, fontSize: '1rem',
                marginBottom: '0.75rem',
                opacity: status === 'loading' ? 0.7 : 1,
              }}
            >
              {status === 'loading' ? 'Activando...' : '🔔 Sí, activar notificaciones'}
            </button>

            <button
              onClick={handleDismiss}
              disabled={status === 'loading'}
              style={{
                width: '100%', padding: '0.75rem',
                background: 'transparent', color: 'var(--text-muted)',
                borderRadius: 12, fontWeight: 500, fontSize: '0.9rem',
              }}
            >
              Ahora no
            </button>
          </>
        )}
      </div>
    </>
  )
}
