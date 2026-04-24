import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { publicApi, type OrderPublic } from '../api/api'

type PageState = 'loading' | 'ready' | 'confirming' | 'done' | 'already_done' | 'error'

export default function DriverPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const [order, setOrder] = useState<OrderPublic | null>(null)
  const [pageState, setPageState] = useState<PageState>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!orderId) { setPageState('error'); setErrorMsg('ID de pedido inválido'); return }

    publicApi.getOrderPublic(orderId)
      .then((data) => {
        setOrder(data)
        if (data.status === 'DELIVERED') setPageState('already_done')
        else setPageState('ready')
      })
      .catch((err: any) => {
        if (err?.response?.status === 403) { setPageState('already_done'); return }
        setPageState('error')
        setErrorMsg(err?.response?.data?.error ?? err?.message ?? 'Pedido no encontrado')
      })
  }, [orderId])

  const handleConfirm = async () => {
    if (!orderId) return
    setPageState('confirming')
    try {
      await publicApi.confirmDelivery(orderId)
      setPageState('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Error desconocido')
      setPageState('error')
    }
  }

  const s: React.CSSProperties = {
    minHeight: '100vh', background: '#111111', color: '#fff',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '2rem 1.25rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    textAlign: 'center',
  }

  if (pageState === 'loading') {
    return (
      <div style={s}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #2A2A2A', borderTopColor: '#F5C518', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        <p style={{ marginTop: '1rem', color: '#888', fontSize: '0.9rem' }}>Cargando pedido...</p>
      </div>
    )
  }

  if (pageState === 'done') {
    return (
      <div style={s}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎉</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>¡Entrega confirmada!</h1>
        <p style={{ color: '#888' }}>Gracias por el servicio 👊</p>
      </div>
    )
  }

  if (pageState === 'already_done') {
    return (
      <div style={s}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.5rem' }}>Pedido ya entregado</h1>
        <p style={{ color: '#888', fontSize: '0.9rem' }}>Este pedido ya fue marcado como entregado.</p>
      </div>
    )
  }

  if (pageState === 'error') {
    return (
      <div style={s}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>❌</div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.5rem' }}>Error</h1>
        <p style={{ color: '#888', fontSize: '0.9rem' }}>{errorMsg}</p>
      </div>
    )
  }

  return (
    <div style={{ ...s, justifyContent: 'flex-start', paddingTop: '2.5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🛵</div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#F5C518', letterSpacing: '-0.5px' }}>
          Yebram's — Entrega
        </h1>
        <p style={{ color: '#666', fontSize: '0.8rem' }}>
          Pedido #{String(order?.orderNumber).padStart(4, '0')}
        </p>
      </div>

      {/* Datos del pedido */}
      <div style={{
        background: '#1A1A1A', borderRadius: 16, padding: '1.25rem',
        width: '100%', maxWidth: 380, marginBottom: '1.5rem',
        border: '1px solid rgba(255,255,255,0.07)',
        textAlign: 'left',
      }}>
        <Row label="👤 Cliente" value={order?.customer.name ?? 'Cliente'} />
        <Row label="📍 Dirección" value={order?.deliveryAddress ?? 'Sin dirección'} />
        {order?.deliveryReference && (
          <Row label="📌 Referencia" value={order.deliveryReference} />
        )}
        <div style={{ paddingTop: '0.85rem', marginTop: '0.85rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <p style={{ fontSize: '0.72rem', color: '#666', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Teléfono
          </p>
          <a
            href={`tel:${order?.customer.phone}`}
            style={{
              color: '#F5C518', fontWeight: 700, fontSize: '1rem',
              textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem',
            }}
          >
            📞 {order?.customer.phone}
          </a>
        </div>
      </div>

      {/* Botón confirmar */}
      <button
        onClick={() => void handleConfirm()}
        disabled={pageState === 'confirming'}
        style={{
          width: '100%', maxWidth: 380,
          padding: '1rem',
          background: pageState === 'confirming' ? '#555' : '#F5C518',
          color: '#000',
          borderRadius: 14, fontWeight: 800, fontSize: '1.1rem',
          border: 'none', cursor: pageState === 'confirming' ? 'not-allowed' : 'pointer',
          boxShadow: pageState === 'confirming' ? 'none' : '0 4px 20px rgba(245,197,24,0.45)',
          transition: 'background 0.2s',
        }}
      >
        {pageState === 'confirming' ? 'Confirmando...' : '✅ Confirmar Entrega'}
      </button>

      <p style={{ color: '#555', fontSize: '0.75rem', marginTop: '1rem' }}>
        Al confirmar, el cliente recibirá una notificación
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: '0.85rem' }}>
      <p style={{ fontSize: '0.72rem', color: '#666', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </p>
      <p style={{ fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.4 }}>{value}</p>
    </div>
  )
}
