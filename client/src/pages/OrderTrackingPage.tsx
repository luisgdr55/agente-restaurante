import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import Layout from '../components/Layout'

// ── Types ──────────────────────────────────────────────────────────────────

interface TrackingOrder {
  id: string
  orderNumber: number
  status: string
  deliveryType: string | null
  deliveryAddress: string | null
  customerName: string | null
  totalUsd: string
  totalBs: string
  items: { name: string; quantity: number; unitPriceUsd: string }[]
}

// ── localStorage helpers ───────────────────────────────────────────────────

const ACTIVE_ORDER_KEY = 'yebrams_active_order'

export interface ActiveOrderData {
  orderId: string
  orderNumber: number
  status: string
  phone: string
}

export function saveActiveOrder(data: ActiveOrderData) {
  localStorage.setItem(ACTIVE_ORDER_KEY, JSON.stringify(data))
}

export function loadActiveOrder(): ActiveOrderData | null {
  try {
    const raw = localStorage.getItem(ACTIVE_ORDER_KEY)
    return raw ? (JSON.parse(raw) as ActiveOrderData) : null
  } catch { return null }
}

export function clearActiveOrder() {
  localStorage.removeItem(ACTIVE_ORDER_KEY)
}

// ── Phase config ───────────────────────────────────────────────────────────

const PHASES = [
  { icon: '📋', label: 'Recibido' },
  { icon: '✅', label: 'Pago' },
  { icon: '👨‍🍳', label: 'Cocina' },
  { icon: '🛵', label: 'En camino' },
  { icon: '🎉', label: 'Entregado' },
]

function statusToPhase(status: string): number {
  switch (status) {
    case 'PENDING_PAYMENT':
    case 'PAYMENT_UPLOADED':          return 0
    case 'PAYMENT_CONFIRMED':         return 1
    case 'IN_KITCHEN':
    case 'AWAITING_DRIVER_ASSIGNMENT':
    case 'READY':                     return 2
    case 'OUT_FOR_DELIVERY':          return 3
    case 'DELIVERED':                 return 4
    default:                          return 0
  }
}

const TERMINAL_STATUSES = ['DELIVERED', 'CANCELLED']

// ── Subcomponents ──────────────────────────────────────────────────────────

function ProgressBar({ phase, prevPhase }: { phase: number; prevPhase: number }) {
  const [animPhase, setAnimPhase] = useState(prevPhase)

  useEffect(() => {
    const t = setTimeout(() => setAnimPhase(phase), 80)
    return () => clearTimeout(t)
  }, [phase])

  return (
    <div style={{ padding: '1.5rem 1rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        {/* Connector line behind icons */}
        <div style={{
          position: 'absolute', top: '50%', left: '10%', right: '10%',
          height: 3, background: '#2A2A2A', transform: 'translateY(-50%)', zIndex: 0,
        }} />
        {/* Active fill */}
        <div style={{
          position: 'absolute', top: '50%', left: '10%',
          height: 3,
          width: `${(animPhase / (PHASES.length - 1)) * 80}%`,
          background: 'linear-gradient(90deg, #10b981, #F5C518)',
          transform: 'translateY(-50%)', zIndex: 1,
          transition: 'width 0.6s cubic-bezier(.4,0,.2,1)',
        }} />

        {PHASES.map((p, i) => {
          const done = i < animPhase
          const active = i === animPhase
          const pending = i > animPhase
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', zIndex: 2 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: active ? '1.3rem' : '1.1rem',
                background: done ? '#10b981' : active ? '#F5C518' : '#2A2A2A',
                border: active ? '2px solid #F5C518' : done ? '2px solid #10b981' : '2px solid #333',
                boxShadow: active ? '0 0 14px rgba(245,197,24,0.55)' : done ? '0 0 8px rgba(16,185,129,0.3)' : 'none',
                transition: 'all 0.5s ease',
                opacity: pending ? 0.45 : 1,
              }}>
                {done ? '✓' : p.icon}
              </div>
              <span style={{
                fontSize: '0.62rem', fontWeight: active ? 700 : 500,
                color: active ? '#F5C518' : done ? '#10b981' : '#555',
                transition: 'color 0.4s ease',
                whiteSpace: 'nowrap',
              }}>
                {p.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function OrderTrackingPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<TrackingOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState(0)
  const [prevPhase, setPrevPhase] = useState(0)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [uploadingProof, setUploadingProof] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchOrder = async () => {
    try {
      const res = await axios.get<TrackingOrder>(`/api/public/orders/${orderId}/tracking`)
      const o = res.data
      setOrder(o)
      setPrevPhase((p) => p)
      setPhase(statusToPhase(o.status))
      setError('')

      // Update localStorage status
      const saved = loadActiveOrder()
      if (saved?.orderId === orderId) {
        if (TERMINAL_STATUSES.includes(o.status)) {
          clearActiveOrder()
          localStorage.removeItem('yebrams_cart')
        } else {
          saveActiveOrder({ ...saved, status: o.status })
        }
      }
    } catch {
      setError('No pudimos cargar tu pedido.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!orderId) return
    void fetchOrder()
    pollingRef.current = setInterval(() => void fetchOrder(), 10_000)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  // Stop polling when terminal status reached
  useEffect(() => {
    if (order && TERMINAL_STATUSES.includes(order.status)) {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [order])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setProofFile(file)
    setProofPreview(URL.createObjectURL(file))
  }

  const handleUploadProof = async () => {
    if (!proofFile || !orderId) return
    setUploadingProof(true)
    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((res, rej) => {
        reader.onload = () => res(reader.result as string)
        reader.onerror = rej
        reader.readAsDataURL(proofFile)
      })
      await axios.patch(`/api/public/orders/${orderId}/payment-proof`, { paymentImageUrl: base64 })
      setProofFile(null)
      setProofPreview(null)
      await fetchOrder()
    } catch {
      alert('Error al subir el comprobante. Intenta de nuevo.')
    } finally {
      setUploadingProof(false)
    }
  }

  const handleCancel = async () => {
    if (!orderId) return
    if (!window.confirm('¿Cancelar este pedido?')) return
    setCancelling(true)
    try {
      await axios.delete(`/api/public/orders/${orderId}`)
      clearActiveOrder()
      localStorage.removeItem('yebrams_cart')
      navigate('/', { replace: true })
    } catch {
      alert('No se pudo cancelar el pedido.')
      setCancelling(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Layout>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #2A2A2A', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Cargando tu pedido...</p>
        </div>
      </Layout>
    )
  }

  if (error || !order) {
    return (
      <Layout>
        <div style={{ maxWidth: 440, margin: '0 auto', padding: '3rem 1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>😕</div>
          <p style={{ color: 'var(--text-muted)' }}>{error || 'Pedido no encontrado.'}</p>
          <button onClick={() => navigate('/')} style={{ marginTop: '1.5rem', color: 'var(--accent)', fontWeight: 600 }}>
            Ir al menú →
          </button>
        </div>
      </Layout>
    )
  }

  const isCancelled = order.status === 'CANCELLED'
  const isRejected = order.status === 'PAYMENT_REJECTED'
  const isDelivered = order.status === 'DELIVERED'
  const orderNum = String(order.orderNumber).padStart(4, '0')

  return (
    <Layout>
      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: '3rem' }}>

        {/* ── Header ── */}
        <div style={{ padding: '1.25rem 1rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={() => navigate('/')} style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>← Menú</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pedido</p>
            <p style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--accent)', letterSpacing: '-1px' }}>#{orderNum}</p>
          </div>
          <div style={{ width: 60 }} />
        </div>

        {/* ── CANCELLED ── */}
        {isCancelled && (
          <div style={{ margin: '1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 14, padding: '1.25rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>❌</div>
            <p style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.3rem' }}>Pedido cancelado</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Este pedido fue cancelado.</p>
            <button onClick={() => navigate('/')} style={{ background: 'var(--accent)', color: '#000', borderRadius: 10, padding: '0.6rem 1.5rem', fontWeight: 700 }}>
              Hacer nuevo pedido
            </button>
          </div>
        )}

        {/* ── PAYMENT_REJECTED ── */}
        {isRejected && (
          <div style={{ margin: '1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 14, padding: '1.25rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>❌</div>
              <p style={{ fontWeight: 700, fontSize: '1rem', color: '#ef4444' }}>Tu pago no pudo verificarse</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.3rem' }}>
                Sube un nuevo comprobante o cancela el pedido.
              </p>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />

            {proofPreview ? (
              <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
                <img src={proofPreview} alt="Comprobante" style={{ width: '100%', borderRadius: 10, maxHeight: 200, objectFit: 'cover' }} />
                <button onClick={() => { setProofFile(null); setProofPreview(null) }}
                  style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: '50%', width: 28, height: 28, fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ×
                </button>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()}
                style={{ width: '100%', padding: '0.75rem', background: 'var(--surface)', border: '2px dashed #3A3A3A', borderRadius: 10, color: 'var(--text-muted)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                📸 Subir nuevo comprobante
              </button>
            )}

            {proofFile && (
              <button onClick={() => void handleUploadProof()} disabled={uploadingProof}
                style={{ width: '100%', padding: '0.75rem', background: 'var(--accent)', color: '#000', borderRadius: 10, fontWeight: 700, marginBottom: '0.75rem', opacity: uploadingProof ? 0.7 : 1 }}>
                {uploadingProof ? 'Enviando...' : '✅ Enviar comprobante'}
              </button>
            )}

            <button onClick={() => void handleCancel()} disabled={cancelling}
              style={{ width: '100%', padding: '0.65rem', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem' }}>
              {cancelling ? 'Cancelando...' : 'Cancelar pedido'}
            </button>
          </div>
        )}

        {/* ── Progress bar (all non-cancelled statuses) ── */}
        {!isCancelled && !isRejected && (
          <ProgressBar phase={phase} prevPhase={prevPhase} />
        )}

        {/* ── Status label ── */}
        {!isCancelled && !isRejected && (
          <div style={{ textAlign: 'center', padding: '0 1rem 1rem' }}>
            <p style={{ fontWeight: 700, fontSize: '1rem', color: isDelivered ? '#10b981' : 'var(--accent)' }}>
              {statusLabel(order.status)}
            </p>
            {!isDelivered && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                Actualizando automáticamente...
              </p>
            )}
          </div>
        )}

        {/* ── Order summary ── */}
        <div style={{ margin: '0 1rem', background: 'var(--surface)', borderRadius: 14, padding: '1rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
            Tu pedido
          </p>
          {order.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', marginBottom: '0.3rem' }}>
              <span>{item.quantity}× {item.name}</span>
              <span style={{ color: 'var(--accent)' }}>${(parseFloat(item.unitPriceUsd) * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #333', marginTop: '0.6rem', paddingTop: '0.6rem', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>Total</span>
            <span style={{ color: 'var(--accent)' }}>${parseFloat(order.totalUsd).toFixed(2)} | Bs {parseFloat(order.totalBs).toFixed(2)}</span>
          </div>
        </div>

        {/* ── Delivery info ── */}
        {order.deliveryType === 'DELIVERY' && order.deliveryAddress && (
          <div style={{ margin: '0 1rem 1rem', background: 'var(--surface)', borderRadius: 14, padding: '0.85rem 1rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.2rem' }}>📍</span>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>Dirección de entrega</p>
              <p style={{ fontSize: '0.88rem', fontWeight: 600 }}>{order.deliveryAddress}</p>
            </div>
          </div>
        )}
        {order.deliveryType === 'PICKUP' && (
          <div style={{ margin: '0 1rem 1rem', background: 'var(--surface)', borderRadius: 14, padding: '0.85rem 1rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <span style={{ fontSize: '1.2rem' }}>🏪</span>
            <p style={{ fontSize: '0.88rem', fontWeight: 600 }}>Retiro en local</p>
          </div>
        )}

        {/* ── DELIVERED: review CTA ── */}
        {isDelivered && (
          <div style={{ margin: '0 1rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              ¡Gracias por tu pedido, {order.customerName ?? ''}! 🙌
            </p>
            <button
              onClick={() => navigate(`/review/${order.id}`)}
              style={{ width: '100%', padding: '0.9rem', background: 'var(--accent)', color: '#000', borderRadius: 12, fontWeight: 700, fontSize: '1rem', marginBottom: '0.75rem', boxShadow: '0 4px 20px rgba(245,197,24,0.35)' }}>
              ⭐ Dejar reseña
            </button>
            <button onClick={() => navigate('/')} style={{ width: '100%', padding: '0.65rem', background: 'var(--surface)', color: 'var(--text-muted)', borderRadius: 12, fontWeight: 600 }}>
              Hacer otro pedido
            </button>
          </div>
        )}
      </div>
    </Layout>
  )
}

function statusLabel(status: string): string {
  switch (status) {
    case 'PENDING_PAYMENT':            return '⏳ Esperando confirmación de pago'
    case 'PAYMENT_UPLOADED':           return '📤 Comprobante enviado, revisando...'
    case 'PAYMENT_CONFIRMED':          return '✅ Pago confirmado'
    case 'IN_KITCHEN':                 return '👨‍🍳 Tu pedido está en cocina'
    case 'READY':                      return '🍗 ¡Listo! Preparando envío'
    case 'AWAITING_DRIVER_ASSIGNMENT': return '🛵 Asignando motorizado...'
    case 'OUT_FOR_DELIVERY':           return '🛵 Tu pedido va en camino'
    case 'DELIVERED':                  return '🎉 ¡Pedido entregado!'
    default:                           return status
  }
}
