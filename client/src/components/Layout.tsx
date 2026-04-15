const LOGO = 'https://cdn.jsdelivr.net/gh/luisgdr55/agente-restaurante@master/public/menu-images/heropwa.png'

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
        background: '#111111',
        borderBottom: '1px solid #2A2A2A',
        padding: '0.75rem 1rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <img src={LOGO} alt="Yebram's" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
          <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>Yebram's</span>
        </div>

        {onCartClick && (
          <button
            onClick={onCartClick}
            style={{
              position: 'relative',
              background: 'var(--accent)',
              color: '#000',
              borderRadius: 20,
              padding: '0.4rem 0.9rem',
              fontWeight: 700,
              fontSize: '0.9rem',
              display: 'flex', alignItems: 'center', gap: '0.4rem',
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
                fontSize: '0.75rem', fontWeight: 700,
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
