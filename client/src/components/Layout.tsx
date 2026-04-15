import { useState } from 'react'

const LOGO = 'https://cdn.jsdelivr.net/gh/luisgdr55/agente-restaurante@master/public/menu-images/heropwa.png'

interface LayoutProps {
  children: React.ReactNode
  cartCount?: number
  onCartClick?: () => void
}

export default function Layout({ children, cartCount = 0, onCartClick }: LayoutProps) {
  const [logoError, setLogoError] = useState(false)

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(17,17,17,0.96)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '0.6rem 1rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          {logoError ? (
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 900, fontSize: '1rem', color: '#000', flexShrink: 0,
            }}>Y</div>
          ) : (
            /* contenedor fijo 36x36 — la imagen se adapta sin distorsión */
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#2A2A2A', flexShrink: 0,
              overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <img
                src={LOGO}
                alt="Yebram's"
                onError={() => setLogoError(true)}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>
          )}
          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent)', letterSpacing: '-0.3px' }}>
            Yebram's
          </span>
        </div>

        {onCartClick && (
          <button
            onClick={onCartClick}
            style={{
              position: 'relative',
              background: cartCount > 0 ? 'var(--accent)' : 'var(--surface)',
              color: cartCount > 0 ? '#000' : 'var(--text-muted)',
              borderRadius: 20,
              padding: '0.4rem 0.85rem',
              fontWeight: 700,
              fontSize: '0.9rem',
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              transition: 'background 0.2s, color 0.2s',
              border: cartCount > 0 ? 'none' : '1px solid #333',
            }}
          >
            🛒
            {cartCount > 0 && (
              <span style={{
                background: '#000',
                color: 'var(--accent)',
                borderRadius: '50%',
                width: 20, height: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.72rem', fontWeight: 800,
                animation: 'pulse 0.3s ease-out',
              }}>
                {cartCount}
              </span>
            )}
          </button>
        )}
      </header>

      <main style={{ flex: 1 }}>
        {children}
      </main>
    </div>
  )
}
