import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { clearActiveOrder } from './OrderTrackingPage'
import { publicApi } from '../api/api'

type PageState = 'loading' | 'ready' | 'submitting' | 'done' | 'already_done' | 'not_available' | 'error'

const STAR_LABELS = ['', 'Muy malo', 'Malo', 'Regular', 'Bueno', '¡Excelente!']
const STAR_COLORS = ['', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#10b981']

export default function ReviewPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const [pageState, setPageState] = useState<PageState>('loading')
  const [orderNumber, setOrderNumber] = useState<number | null>(null)
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!orderId) { setPageState('error'); setErrorMsg('ID de pedido inválido'); return }

    publicApi.getOrderPublic(orderId)
      .then((data) => {
        setOrderNumber(data.orderNumber)
        setPageState('ready')
      })
      .catch((err: any) => {
        const status = err?.response?.status
        if (status === 403 || status === 404) { setPageState('not_available'); return }
        setPageState('error')
        setErrorMsg(err?.response?.data?.error ?? err?.message ?? 'Pedido no encontrado')
      })
  }, [orderId])

  const handleSubmit = async () => {
    if (!orderId || rating === 0) return
    setPageState('submitting')
    try {
      await publicApi.submitReview(orderId, { rating, comment: comment.trim() || undefined })
      clearActiveOrder()
      localStorage.removeItem('yebrams_cart')
      setPageState('done')
      setTimeout(() => navigate('/', { replace: true }), 2000)
    } catch (err: any) {
      if (err?.response?.status === 409) { setPageState('not_available'); return }
      setErrorMsg(err?.response?.data?.error ?? err?.message ?? 'Error desconocido')
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
        <p style={{ marginTop: '1rem', color: '#888', fontSize: '0.9rem' }}>Cargando...</p>
      </div>
    )
  }

  if (pageState === 'done') {
    return (
      <div style={s}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🙏</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>¡Gracias por tu reseña!</h1>
        <p style={{ color: '#888', fontSize: '0.95rem' }}>Tu opinión nos ayuda a mejorar 💛</p>
      </div>
    )
  }

  if (pageState === 'already_done') {
    return (
      <div style={s}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800 }}>Ya enviaste tu reseña</h1>
        <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>¡Gracias por tu opinión!</p>
      </div>
    )
  }

  if (pageState === 'not_available') {
    return (
      <div style={s}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⏳</div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800 }}>Reseña no disponible</h1>
        <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>
          El enlace de reseña estará disponible una vez que recibas tu pedido.
        </p>
      </div>
    )
  }

  if (pageState === 'error') {
    return (
      <div style={s}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>❌</div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 800 }}>Error</h1>
        <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>{errorMsg}</p>
      </div>
    )
  }

  const activeRating = hovered || rating
  const starColor = activeRating > 0 ? STAR_COLORS[activeRating] : '#444'

  return (
    <div style={{ ...s, justifyContent: 'flex-start', paddingTop: '3rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⭐</div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#F5C518' }}>
          Yebram's — Reseña
        </h1>
        {orderNumber !== null && (
          <p style={{ color: '#666', fontSize: '0.8rem' }}>
            Pedido #{String(orderNumber).padStart(4, '0')}
          </p>
        )}
      </div>

      <div style={{
        background: '#1A1A1A', borderRadius: 16, padding: '1.5rem',
        width: '100%', maxWidth: 380,
        border: '1px solid rgba(255,255,255,0.07)',
      }}>
        <p style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1.25rem' }}>
          ¿Cómo fue tu experiencia?
        </p>

        {/* Estrellas */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => setHovered(star)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => setRating(star)}
              style={{
                fontSize: '2.4rem',
                background: 'none', border: 'none',
                cursor: 'pointer',
                opacity: star <= activeRating ? 1 : 0.25,
                transform: star <= activeRating ? 'scale(1.1)' : 'scale(1)',
                transition: 'all 0.15s ease',
                filter: star <= activeRating ? `drop-shadow(0 0 6px ${STAR_COLORS[activeRating]})` : 'none',
                padding: '0.1rem',
              }}
            >
              ★
            </button>
          ))}
        </div>

        {/* Label de la estrella */}
        <p style={{
          fontSize: '0.9rem', fontWeight: 700, marginBottom: '1.25rem',
          color: starColor,
          minHeight: '1.2rem',
          transition: 'color 0.2s',
        }}>
          {activeRating > 0 ? STAR_LABELS[activeRating] : ''}
        </p>

        {/* Comentario */}
        <textarea
          placeholder="Déjanos un comentario (opcional)..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={280}
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '0.75rem',
            background: '#111', color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, fontSize: '0.9rem',
            resize: 'vertical', fontFamily: 'inherit',
            outline: 'none', marginBottom: '1rem',
          }}
        />

        {/* Botón enviar */}
        <button
          onClick={() => void handleSubmit()}
          disabled={rating === 0 || pageState === 'submitting'}
          style={{
            width: '100%',
            padding: '0.9rem',
            background: rating === 0 ? '#333' : '#F5C518',
            color: rating === 0 ? '#666' : '#000',
            borderRadius: 12, fontWeight: 800, fontSize: '1rem',
            border: 'none',
            cursor: rating === 0 || pageState === 'submitting' ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s, color 0.2s',
            boxShadow: rating > 0 ? '0 4px 20px rgba(245,197,24,0.35)' : 'none',
          }}
        >
          {pageState === 'submitting' ? 'Enviando...' : '✅ Enviar reseña'}
        </button>
      </div>

      <p style={{ color: '#444', fontSize: '0.72rem', marginTop: '1rem' }}>
        Tu opinión es privada y solo la ve el equipo de Yebram's
      </p>
    </div>
  )
}
