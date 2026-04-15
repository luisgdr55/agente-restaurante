import { useRef, useState } from 'react'
import type { CartItem } from '../store/cart'

interface MenuItem {
  id: string
  name: string
  description: string | null
  priceUsd: string
  imageUrl: string | null
}

interface ItemDetailSheetProps {
  item: MenuItem
  rate: number
  cartItem: CartItem | undefined
  onAdd: (item: Omit<CartItem, 'quantity'>) => void
  onRemove: (id: string) => void
  onClose: () => void
}

export default function ItemDetailSheet({ item, rate, cartItem, onAdd, onRemove, onClose }: ItemDetailSheetProps) {
  const priceUsd = parseFloat(item.priceUsd)
  const hasImage = Boolean(item.imageUrl && item.imageUrl.trim())
  const [imgError, setImgError] = useState(false)

  // Swipe down to close
  const touchStartY = useRef<number | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return
    const delta = e.changedTouches[0].clientY - touchStartY.current
    if (delta > 60) onClose()
    touchStartY.current = null
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(3px)',
          zIndex: 300,
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#1C1C1C',
          borderRadius: '22px 22px 0 0',
          zIndex: 301,
          maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -12px 48px rgba(0,0,0,0.7)',
          animation: 'slideUp 0.28s cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        <style>{`
          @keyframes slideUp {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
        `}</style>

        {/* Handle + close */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0.7rem 1rem 0',
          position: 'relative',
        }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#444' }} />
          <button
            onClick={onClose}
            style={{
              position: 'absolute', right: '1rem',
              width: 30, height: 30, borderRadius: '50%',
              background: '#2A2A2A', color: '#888',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1rem',
            }}
          >×</button>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Image 16:9 */}
          <div style={{
            width: '100%', aspectRatio: '16/9',
            background: 'linear-gradient(135deg, #1E1E1E 0%, #2A2A2A 100%)',
            overflow: 'hidden',
          }}>
            {hasImage && !imgError ? (
              <img
                src={item.imageUrl!}
                alt={item.name}
                onError={() => setImgError(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: '0.5rem',
              }}>
                <span style={{ fontSize: '3rem', opacity: 0.4 }}>🍽️</span>
              </div>
            )}
          </div>

          {/* Info */}
          <div style={{ padding: '1.25rem 1.25rem 0' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, lineHeight: 1.25, marginBottom: '0.6rem' }}>
              {item.name}
            </h2>

            {item.description && (
              <p style={{
                color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.55,
                marginBottom: '1rem',
              }}>
                {item.description}
              </p>
            )}

            {/* Price */}
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: '0.5rem',
              marginBottom: '1.25rem',
            }}>
              <span style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '1.4rem' }}>
                ${priceUsd.toFixed(2)}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Bs {(priceUsd * rate).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Fixed footer — add/remove */}
        <div style={{ padding: '0.85rem 1.25rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {cartItem ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(245,197,24,0.1)', borderRadius: 14, padding: '0.5rem 0.75rem',
            }}>
              <button
                onClick={() => onRemove(item.id)}
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.1)', color: 'var(--text)',
                  fontSize: '1.3rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >−</button>
              <div style={{ textAlign: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent)' }}>
                  {cartItem.quantity}
                </span>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>en tu pedido</p>
              </div>
              <button
                onClick={() => onAdd({ id: item.id, name: item.name, priceUsd, imageUrl: item.imageUrl ?? null })}
                style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'var(--accent)', color: '#000',
                  fontSize: '1.3rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800,
                }}
              >+</button>
            </div>
          ) : (
            <button
              onClick={() => {
                onAdd({ id: item.id, name: item.name, priceUsd, imageUrl: item.imageUrl ?? null })
                onClose()
              }}
              style={{
                width: '100%', padding: '0.95rem',
                background: 'var(--accent)', color: '#000',
                borderRadius: 14, fontWeight: 800, fontSize: '1.05rem',
                boxShadow: '0 4px 20px rgba(245,197,24,0.4)',
              }}
            >
              Agregar al carrito
            </button>
          )}
        </div>
      </div>
    </>
  )
}
