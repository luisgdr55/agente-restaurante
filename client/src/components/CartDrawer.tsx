import type { CartItem } from '../store/cart'

interface CartDrawerProps {
  items: CartItem[]
  total: number
  deliveryFeeUsd: number
  rate: number
  closing?: boolean
  isPaused?: boolean
  pauseCountdown?: string | null
  onAdd: (item: Omit<CartItem, 'quantity'>) => void
  onRemove: (id: string) => void
  onClear: () => void
  onClose: () => void
  onCheckout: () => void
}

const CART_STYLES = `
@keyframes slideUp {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}
@keyframes slideDown {
  from { transform: translateY(0); }
  to   { transform: translateY(100%); }
}
@keyframes fadeInBackdrop {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes fadeOutBackdrop {
  from { opacity: 1; }
  to   { opacity: 0; }
}
`

function usdToBs(usd: number, rate: number) {
  return (usd * rate).toFixed(2)
}

export default function CartDrawer({ items, total, deliveryFeeUsd, rate, closing, isPaused, pauseCountdown, onAdd, onRemove, onClear, onClose, onCheckout }: CartDrawerProps) {
  const grandTotal = total + deliveryFeeUsd

  return (
    <>
      <style>{CART_STYLES}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(2px)',
          zIndex: 200,
          animation: closing
            ? 'fadeOutBackdrop 0.2s ease-in both'
            : 'fadeInBackdrop 0.25s ease-out both',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#1A1A1A',
        borderRadius: '20px 20px 0 0',
        zIndex: 201,
        maxHeight: '82vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
        animation: closing
          ? 'slideDown 0.2s ease-in both'
          : 'slideUp 0.3s ease-out both',
      }}>
        {/* Handle bar */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0.8rem 0 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#444' }} />
        </div>

        {/* Header */}
        <div style={{
          padding: '0.75rem 1.25rem 0.75rem',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
              Tu pedido
            </h2>
            {items.length > 0 && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>
                {items.reduce((s, i) => s + i.quantity, 0)} {items.reduce((s, i) => s + i.quantity, 0) === 1 ? 'ítem' : 'ítems'}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {items.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm('¿Vaciar el carrito?')) {
                    onClear()
                    onClose()
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                  padding: '0.3rem 0.65rem',
                  borderRadius: 20,
                  background: 'rgba(255,68,68,0.1)',
                  border: '1px solid rgba(255,68,68,0.25)',
                  color: '#FF4444',
                  fontSize: '0.75rem', fontWeight: 600,
                }}
              >
                🗑️ Vaciar
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: '#2A2A2A', color: 'var(--text-muted)',
                fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>
          </div>
        </div>

        {/* Items */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '0.5rem 1.25rem' }}>
          {items.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '3rem 0', gap: '0.5rem',
            }}>
              <span style={{ fontSize: '2.5rem' }}>🛒</span>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Tu carrito está vacío</p>
            </div>
          ) : (
            items.map((item, idx) => (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.85rem',
                padding: '0.85rem 0',
                borderBottom: idx < items.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}>
                {/* Thumb */}
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    style={{
                      width: 48, height: 48, borderRadius: 8,
                      objectFit: 'cover', flexShrink: 0,
                    }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div style={{
                    width: 48, height: 48, borderRadius: 8,
                    background: '#2A2A2A', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.2rem',
                  }}>🍽️</div>
                )}

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: '0.88rem', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name}
                  </p>
                  <p style={{ color: 'var(--accent)', fontSize: '0.8rem', marginTop: '0.15rem' }}>
                    ${(item.priceUsd * item.quantity).toFixed(2)}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                      {' '}| Bs {usdToBs(item.priceUsd * item.quantity, rate)}
                    </span>
                  </p>
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <button
                    onClick={() => onRemove(item.id)}
                    style={{
                      width: 30, height: 30, borderRadius: '50%',
                      background: '#2A2A2A', color: 'var(--text)',
                      fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >−</button>
                  <span style={{ minWidth: 18, textAlign: 'center', fontWeight: 800, fontSize: '0.95rem' }}>
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => onAdd({ id: item.id, name: item.name, priceUsd: item.priceUsd, imageUrl: item.imageUrl })}
                    style={{
                      width: 30, height: 30, borderRadius: '50%',
                      background: 'var(--accent)', color: '#000',
                      fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800,
                    }}
                  >+</button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div style={{
            padding: '1rem 1.25rem 1.5rem',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            background: '#1A1A1A',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.83rem' }}>Subtotal</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.83rem' }}>
                ${total.toFixed(2)} | Bs {usdToBs(total, rate)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.83rem' }}>Delivery</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.83rem' }}>
                ${deliveryFeeUsd.toFixed(2)} | Bs {usdToBs(deliveryFeeUsd, rate)}
              </span>
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', marginBottom: '0.85rem' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
              <span style={{ fontWeight: 800, fontSize: '1rem' }}>Total</span>
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '1.15rem' }}>
                  ${grandTotal.toFixed(2)}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', display: 'block' }}>
                  Bs {usdToBs(grandTotal, rate)}
                </span>
              </div>
            </div>

            {isPaused ? (
              <div style={{
                width: '100%', padding: '0.85rem',
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.35)',
                borderRadius: 12, textAlign: 'center',
                color: '#a5b4fc', fontWeight: 700, fontSize: '0.9rem',
              }}>
                ⏸️ Pedidos en pausa
                {pauseCountdown && (
                  <span style={{ display: 'block', fontSize: '1.3rem', fontWeight: 900, marginTop: '0.2rem', color: '#c7d2fe' }}>
                    Reabrimos en {pauseCountdown}
                  </span>
                )}
              </div>
            ) : (
              <button
                onClick={onCheckout}
                style={{
                  width: '100%', padding: '0.9rem',
                  background: 'var(--accent)', color: '#000',
                  borderRadius: 12, fontWeight: 800, fontSize: '1rem',
                  letterSpacing: '0.01em',
                  boxShadow: '0 4px 20px rgba(245,197,24,0.35)',
                }}
              >
                Ir a pagar →
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
