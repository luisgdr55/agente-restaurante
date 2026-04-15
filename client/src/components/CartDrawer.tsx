import type { CartItem } from '../store/cart'

interface CartDrawerProps {
  items: CartItem[]
  total: number
  deliveryFeeUsd: number
  rate: number
  onAdd: (item: Omit<CartItem, 'quantity'>) => void
  onRemove: (id: string) => void
  onClose: () => void
  onCheckout: () => void
}

function usdToBs(usd: number, rate: number) {
  return (usd * rate).toFixed(2)
}

export default function CartDrawer({ items, total, deliveryFeeUsd, rate, onAdd, onRemove, onClose, onCheckout }: CartDrawerProps) {
  const grandTotal = total + deliveryFeeUsd

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--surface)',
        borderRadius: '16px 16px 0 0',
        zIndex: 201,
        maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0.75rem' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: '#555' }} />
        </div>

        <div style={{ padding: '0 1rem 0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.1rem', color: 'var(--text)' }}>Tu pedido</h2>
          <button onClick={onClose} style={{ color: 'var(--text-muted)', fontSize: '1.4rem', lineHeight: 1 }}>×</button>
        </div>

        {/* Items */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '0 1rem' }}>
          {items.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>
              Tu carrito está vacío
            </p>
          ) : (
            items.map((item) => (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.75rem 0',
                borderBottom: '1px solid #333',
              }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.name}</p>
                  <p style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
                    ${(item.priceUsd * item.quantity).toFixed(2)} | Bs {usdToBs(item.priceUsd * item.quantity, rate)}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    onClick={() => onRemove(item.id)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'var(--surface2)', color: 'var(--text)',
                      fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >−</button>
                  <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{item.quantity}</span>
                  <button
                    onClick={() => onAdd({ id: item.id, name: item.name, priceUsd: item.priceUsd, imageUrl: item.imageUrl })}
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'var(--accent)', color: '#000',
                      fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700,
                    }}
                  >+</button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div style={{ padding: '1rem', borderTop: '1px solid #333' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <span>Subtotal</span>
              <span>${total.toFixed(2)} | Bs {usdToBs(total, rate)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <span>Delivery</span>
              <span>${deliveryFeeUsd.toFixed(2)} | Bs {usdToBs(deliveryFeeUsd, rate)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontWeight: 700, fontSize: '1rem' }}>
              <span>Total</span>
              <span style={{ color: 'var(--accent)' }}>${grandTotal.toFixed(2)} | Bs {usdToBs(grandTotal, rate)}</span>
            </div>
            <button
              onClick={onCheckout}
              style={{
                width: '100%', padding: '0.85rem',
                background: 'var(--accent)', color: '#000',
                borderRadius: 10, fontWeight: 700, fontSize: '1rem',
              }}
            >
              Ir a pagar →
            </button>
          </div>
        )}
      </div>
    </>
  )
}
