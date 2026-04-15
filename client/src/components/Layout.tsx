interface LayoutProps {
  children: React.ReactNode
  cartCount?: number
  onCartClick?: () => void
}

export default function Layout({ children, cartCount = 0, onCartClick }: LayoutProps) {
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
          {/* Avatar de texto — no existe archivo logo separado en el repo */}
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: '#000',
            border: '2px solid #F5C518',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, fontSize: '1.05rem', color: '#F5C518',
            flexShrink: 0, letterSpacing: '-0.5px',
          }}>Y</div>
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
