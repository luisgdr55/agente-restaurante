import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import NotificationModal, { hasBeenAsked } from '../components/NotificationModal'
import { saveActiveOrder } from './OrderTrackingPage'
import { publicApi } from '../api/api'

interface ConfirmState {
  orderNumber: number
  orderId: string
  queued?: boolean
  adminPhone: string
  customerName: string
  phone: string
  total: number
  rate: number
  deliveryType: 'DELIVERY' | 'PICKUP'
  address?: string
  cart: { name: string; quantity: number; priceUsd: number }[]
  pagoMovilBank: string
  pagoMovilPhone: string
  pagoMovilHolder: string
  pagoMovilRif: string
  vapidPublicKey: string
}

const CONFIRM_DATA_KEY = 'yebrams_confirm_data'

function loadConfirmData(): ConfirmState | null {
  try {
    const raw = localStorage.getItem(CONFIRM_DATA_KEY)
    return raw ? (JSON.parse(raw) as ConfirmState) : null
  } catch { return null }
}

export function clearConfirmData() {
  localStorage.removeItem(CONFIRM_DATA_KEY)
}

export default function ConfirmPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [confirmState] = useState<ConfirmState | null>(
    () => (location.state as ConfirmState | null) ?? loadConfirmData()
  )
  const [showNotifModal, setShowNotifModal] = useState(false)
  const [pollStatus, setPollStatus] = useState<string | null>(null)
  const [pollCancelReason, setPollCancelReason] = useState<string | null>(null)
  const [confirmedCountdown, setConfirmedCountdown] = useState<number | null>(null)

  useEffect(() => {
    if (!confirmState?.orderNumber) return
    localStorage.setItem(CONFIRM_DATA_KEY, JSON.stringify(confirmState))
    const supportsNotifications = 'Notification' in window && 'serviceWorker' in navigator
    if (!supportsNotifications || hasBeenAsked()) return
    const t = setTimeout(() => setShowNotifModal(true), 1500)
    return () => clearTimeout(t)
  }, [confirmState])

  // Polling cada 10s — detiene cuando llega a estado terminal
  useEffect(() => {
    const id = confirmState?.orderId
    if (!id) return
    const AUTO_NAV = ['IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY']
    const TERMINAL = new Set(['PAYMENT_REJECTED', 'IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'])
    let active = true
    const poll = async () => {
      try {
        const order = await publicApi.getOrderTracking(id)
        if (!active) return
        setPollStatus(order.status)
        setPollCancelReason(order.cancelReason)
        if (AUTO_NAV.includes(order.status)) navigate(`/order/${id}`, { replace: true })
        if (TERMINAL.has(order.status)) clearInterval(interval)
      } catch { /* ignorar errores de red */ }
    }
    const interval = setInterval(() => { void poll() }, 10000)
    return () => { active = false; clearInterval(interval) }
  }, [confirmState?.orderId, navigate])

  // Countdown de 3s tras PAYMENT_CONFIRMED → auto-navega a tracking
  useEffect(() => {
    if (pollStatus !== 'PAYMENT_CONFIRMED' || !confirmState?.orderId) return
    const id = confirmState.orderId
    setConfirmedCountdown(3)
    const tick = setInterval(() => {
      setConfirmedCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(tick)
          navigate(`/order/${id}`, { replace: true })
          return null
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [pollStatus, confirmState?.orderId, navigate])

  // If navigated directly without state or stored data, redirect home
  if (!confirmState?.orderNumber) {
    navigate('/', { replace: true })
    return null
  }

  const { orderNumber, orderId, queued, adminPhone, customerName, phone, total, rate, deliveryType, address, cart, pagoMovilBank, pagoMovilPhone, pagoMovilHolder, pagoMovilRif, vapidPublicKey } = confirmState

  // Pantalla de rechazo — reemplaza el contenido completo
  if (pollStatus === 'PAYMENT_REJECTED') {
    return (
      <Layout>
        <div style={{
          maxWidth: 480, margin: '0 auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '80vh', padding: '2rem 1.25rem', textAlign: 'center',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'rgba(239,68,68,0.15)', border: '2px solid #ef4444',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '2rem', marginBottom: '1.25rem',
          }}>⚠️</div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ef4444', marginBottom: '0.5rem' }}>
            Necesitamos verificar tu pago
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Tu comprobante no pudo ser verificado. Puedes subir uno nuevo desde la pantalla de seguimiento.
          </p>
          {pollCancelReason && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1.25rem', width: '100%',
            }}>
              <p style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
                <strong>Motivo:</strong> {pollCancelReason}
              </p>
            </div>
          )}
          <button
            onClick={() => navigate(`/order/${orderId}`)}
            style={{
              width: '100%', padding: '1rem',
              background: '#ef4444', color: '#fff',
              borderRadius: 12, fontWeight: 800, fontSize: '1.05rem',
              boxShadow: '0 4px 20px rgba(239,68,68,0.4)',
            }}>
            Resolver ahora →
          </button>
        </div>
      </Layout>
    )
  }

  // Persist active order for auto-redirect on next app open
  useEffect(() => {
    if (orderId && orderNumber && phone) {
      saveActiveOrder({ orderId, orderNumber, status: 'PENDING_PAYMENT', phone })
    }
  }, [orderId, orderNumber, phone])

  const totalBs = (total * rate).toFixed(2)

  const itemLines = (cart ?? [])
    .map((i) => `  • ${i.quantity}x ${i.name} — $${(i.priceUsd * i.quantity).toFixed(2)}`)
    .join('\n')

  const waMessage = [
    `🛵 *Pedido #${orderNumber}*`,
    `👤 Cliente: ${customerName}`,
    `📱 Teléfono: ${phone}`,
    ``,
    `🧾 *Productos:*`,
    itemLines,
    ``,
    `💰 *Total: $${total.toFixed(2)} | Bs ${totalBs}*`,
    ``,
    deliveryType === 'DELIVERY'
      ? `📍 *Delivery a:* ${address ?? ''}`
      : `🏪 *Pickup en local*`,
    ``,
    `📱 *Pago móvil realizado a:*`,
    `  Banco: ${pagoMovilBank}`,
    `  Teléfono: ${pagoMovilPhone}`,
    `  Titular: ${pagoMovilHolder}`,
    `  RIF/Cédula: ${pagoMovilRif}`,
  ].join('\n')

  const waLink = `https://wa.me/${adminPhone}?text=${encodeURIComponent(waMessage)}`

  return (
    <Layout>
      {/* ── Banner pago confirmado — auto-navega en 3s ── */}
      {pollStatus === 'PAYMENT_CONFIRMED' && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'linear-gradient(135deg, #14532d, #166534)',
          borderBottom: '2px solid #22c55e',
          padding: '0.9rem 1.25rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
          boxShadow: '0 4px 20px rgba(34,197,94,0.4)',
        }}>
          <div>
            <p style={{ fontWeight: 800, color: '#f0fdf4', fontSize: '0.95rem', marginBottom: '0.15rem' }}>
              ✅ ¡Pago confirmado! Tu pedido está en cocina
            </p>
            <p style={{ fontSize: '0.78rem', color: '#86efac' }}>
              Redirigiendo en {confirmedCountdown ?? 3}s...
            </p>
          </div>
          <button
            onClick={() => navigate(`/order/${orderId}`, { replace: true })}
            style={{
              flexShrink: 0, padding: '0.45rem 0.9rem',
              background: '#22c55e', color: '#fff',
              borderRadius: 8, fontWeight: 700, fontSize: '0.85rem', border: 'none',
              whiteSpace: 'nowrap',
            }}>
            Seguir mi pedido →
          </button>
        </div>
      )}

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1rem', textAlign: 'center' }}>

        {/* ── Icono éxito ── */}
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2rem', margin: '0 auto 1.25rem',
        }}>
          ✅
        </div>

        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '0.2rem' }}>
          ¡Pedido recibido!
        </h1>
        <p style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent)', marginBottom: '2rem' }}>
          {customerName} 🙌
        </p>

        {/* ── Número de pedido ── */}
        <div style={{
          background: 'var(--surface)', borderRadius: 14,
          padding: '1.25rem', marginBottom: '1.5rem',
        }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>Número de pedido</p>
          <p style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent)', letterSpacing: '-1px' }}>
            #{orderNumber}
          </p>
        </div>

        {/* ── Ítems del pedido ── */}
        <div style={{
          background: 'var(--surface)', borderRadius: 14,
          padding: '1.25rem', marginBottom: '1.5rem', textAlign: 'left',
        }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem', fontWeight: 600 }}>
            Tu pedido
          </p>
          {(cart ?? []).map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.3rem' }}>
              <span>{item.quantity}× {item.name}</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>${(item.priceUsd * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #2A2A2A', marginTop: '0.6rem', paddingTop: '0.6rem', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>Total</span>
            <span style={{ color: 'var(--accent)' }}>${total.toFixed(2)} | Bs {totalBs}</span>
          </div>
        </div>

        {/* ── Cola de espera ── */}
        {queued && (
          <div style={{
            background: 'rgba(245,158,11,0.1)',
            border: '2px solid rgba(245,158,11,0.45)',
            borderRadius: 14, padding: '1rem 1.25rem',
            marginBottom: '1rem',
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            textAlign: 'left',
          }}>
            <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>⏳</span>
            <div>
              <p style={{ fontWeight: 700, color: '#fbbf24', marginBottom: '0.25rem', fontSize: '0.95rem' }}>
                Alta demanda — tu pedido está en cola
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                Lo procesaremos en el orden en que llegó. Te notificaremos cuando sea confirmado. ¡Gracias por tu paciencia! 🙏
              </p>
            </div>
          </div>
        )}

        {/* ── Pedido cancelado ── */}
        {pollStatus === 'CANCELLED' && (
          <div style={{
            background: 'rgba(107,114,128,0.1)', border: '1px solid rgba(107,114,128,0.3)',
            borderRadius: 14, padding: '1rem 1.25rem', marginBottom: '1rem',
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem', textAlign: 'left',
          }}>
            <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>❌</span>
            <div>
              <p style={{ fontWeight: 700, color: '#9ca3af', marginBottom: '0.25rem', fontSize: '0.95rem' }}>
                Pedido cancelado
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                Este pedido fue cancelado. Puedes hacer uno nuevo cuando quieras.
              </p>
            </div>
          </div>
        )}

        {/* ── Estado + instrucción ── */}
        <div style={{
          background: 'var(--surface)', borderRadius: 14,
          padding: '1.25rem', marginBottom: '2rem',
          textAlign: 'left',
        }}>
          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>¿Qué sigue?</p>
          <ol style={{ paddingLeft: '1.2rem', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.8 }}>
            <li>Nuestro equipo revisará tu comprobante de pago</li>
            <li>Confirmaremos tu pedido y comenzaremos a prepararlo</li>
            {deliveryType === 'DELIVERY'
              ? <li>Un motorizado te llevará tu pedido a domicilio 🛵</li>
              : <li>Te avisaremos cuando esté listo para retirar 🏪</li>}
          </ol>
        </div>

        {/* ── CTA principal: seguir pedido ── */}
        <button
          onClick={() => navigate(`/order/${orderId}`)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            width: '100%', padding: '0.95rem',
            background: 'var(--accent)', color: '#000',
            borderRadius: 12, fontWeight: 800, fontSize: '1rem',
            marginBottom: '0.75rem',
            boxShadow: '0 4px 24px rgba(245,197,24,0.4)',
          }}
        >
          📍 Seguir mi pedido
        </button>

        {/* ── WhatsApp link ── */}
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            width: '100%', padding: '0.9rem',
            background: '#25D366', color: '#fff',
            borderRadius: 12, fontWeight: 700, fontSize: '0.95rem',
            marginBottom: '1rem',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Escribir al restaurante por WhatsApp
        </a>

        <button
          onClick={() => navigate('/')}
          style={{
            width: '100%', padding: '0.75rem',
            background: 'var(--surface)', color: 'var(--text-muted)',
            borderRadius: 12, fontWeight: 600, fontSize: '0.9rem',
          }}
        >
          Volver al menú
        </button>
      </div>

      {showNotifModal && vapidPublicKey && (
        <NotificationModal
          phone={phone}
          vapidPublicKey={vapidPublicKey}
          onClose={() => setShowNotifModal(false)}
        />
      )}
    </Layout>
  )
}
