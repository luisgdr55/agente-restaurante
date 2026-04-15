import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { publicApi, isRestaurantOpen, type MenuCategory, type PublicConfig } from '../api/api'
import { useCart } from '../store/cart'
import Layout from '../components/Layout'
import CartDrawer from '../components/CartDrawer'

const HERO_BG = 'https://cdn.jsdelivr.net/gh/luisgdr55/agente-restaurante@master/public/menu-images/layebrams.jpg'

function ItemPlaceholder({ name }: { name: string }) {
  return (
    <div style={{
      width: '100%', aspectRatio: '4/3',
      background: 'linear-gradient(135deg, #1E1E1E 0%, #2A2A2A 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
    }}>
      <span style={{ fontSize: '2.2rem', opacity: 0.6 }}>🍽️</span>
      <span style={{
        fontSize: '0.68rem', color: 'var(--text-muted)',
        textAlign: 'center', padding: '0 0.6rem',
        lineHeight: 1.3,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
      }}>{name}</span>
    </div>
  )
}

export default function MenuPage() {
  const [menu, setMenu] = useState<MenuCategory[]>([])
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [heroError, setHeroError] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { items, add, remove, total, count } = useCart()
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([publicApi.getMenu(), publicApi.getConfig()])
      .then(([menuData, configData]) => {
        // Debug: ver qué URLs llegan en el menú
        if (import.meta.env.DEV) {
          menuData.forEach(cat => cat.items.forEach(item => {
            console.log(`[menu] ${item.name} → imageUrl:`, item.imageUrl)
          }))
        }
        setMenu(menuData)
        setConfig(configData)
        if (menuData.length > 0) setActiveCategory(menuData[0].id)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleCheckout = () => {
    if (items.length === 0) return
    sessionStorage.setItem('yebrams_checkout_cart', JSON.stringify(items))
    sessionStorage.setItem('yebrams_checkout_config', JSON.stringify(config))
    setCartOpen(false)
    navigate('/checkout')
  }

  const deliveryFeeUsd = parseFloat(config?.DELIVERY_FEE_USD ?? '1.50')
  const rate = parseFloat(config?.USD_TO_BS_RATE ?? '36.50')

  const activeItems = menu.find((c) => c.id === activeCategory)?.items ?? []

  if (loading) {
    return (
      <Layout>
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            border: '3px solid #2A2A2A', borderTopColor: 'var(--accent)',
            animation: 'spin 0.8s linear infinite',
          }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Cargando menú...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </Layout>
    )
  }

  if (config && !isRestaurantOpen(config)) {
    return (
      <Layout>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '80vh', padding: '2rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🌙</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
            Estamos cerrados
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', maxWidth: 300 }}>
            En este momento no estamos recibiendo pedidos. ¡Vuelve pronto!
          </p>
          <div style={{
            background: 'var(--surface)', borderRadius: 14,
            padding: '1rem 1.5rem', maxWidth: 300, width: '100%',
          }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Horario de atención
            </p>
            <p style={{ fontWeight: 600, color: 'var(--accent)' }}>
              {config.RESTAURANT_HOURS || 'Próximamente'}
            </p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout cartCount={count} onCartClick={() => setCartOpen(true)}>
      {/* ── Hero ── */}
      <div style={{
        position: 'relative',
        minHeight: '62vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center',
        overflow: 'hidden',
        background: heroError
          ? 'linear-gradient(160deg, #1A1A1A 0%, #2A2A2A 60%, #1A1A1A 100%)'
          : undefined,
      }}>
        {/* Background image */}
        {!heroError && (
          <img
            src={HERO_BG}
            alt=""
            aria-hidden="true"
            onError={() => setHeroError(true)}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover',
              objectPosition: 'center top',
            }}
          />
        )}

        {/* Dark overlay — gradient para mejor legibilidad abajo */}
        <div style={{
          position: 'absolute', inset: 0,
          background: heroError
            ? 'transparent'
            : 'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.65) 60%, rgba(0,0,0,0.82) 100%)',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, padding: '3rem 1.5rem 2.5rem' }}>
          <h1 style={{
            fontSize: 'clamp(2.8rem, 12vw, 4.5rem)',
            fontWeight: 900,
            color: '#FFFFFF',
            letterSpacing: '-2px',
            lineHeight: 1.0,
            marginBottom: '0.4rem',
            textShadow: '0 2px 20px rgba(0,0,0,0.8)',
          }}>
            Yebram's
          </h1>
          <p style={{
            fontSize: 'clamp(0.8rem, 3.5vw, 1rem)',
            fontWeight: 800,
            color: '#F5C518',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: '1.75rem',
            textShadow: '0 1px 8px rgba(0,0,0,0.7)',
          }}>
            Tu menú super crujiente
          </p>

          {/* Delivery badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(245,197,24,0.5)',
            borderRadius: 20,
            padding: '0.35rem 0.9rem',
            fontSize: '0.8rem', color: '#F5C518', fontWeight: 600,
            marginBottom: '2rem',
            backdropFilter: 'blur(4px)',
          }}>
            🛵 Delivery ${deliveryFeeUsd.toFixed(2)} | Bs {(deliveryFeeUsd * rate).toFixed(2)}
          </div>

          {/* CTA */}
          <div>
            <button
              onClick={() => menuRef.current?.scrollIntoView({ behavior: 'smooth' })}
              style={{
                padding: '0.85rem 2.4rem',
                background: '#F5C518',
                color: '#000',
                borderRadius: 30,
                fontWeight: 800,
                fontSize: '0.95rem',
                letterSpacing: '0.02em',
                boxShadow: '0 4px 24px rgba(245,197,24,0.45)',
              }}
            >
              Ver menú ↓
            </button>
          </div>
        </div>
      </div>

      {/* ── Category tabs ── */}
      <div ref={menuRef} style={{
        position: 'sticky', top: 57, zIndex: 50,
        background: 'rgba(17,17,17,0.97)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        overflowX: 'auto',
        display: 'flex', gap: '0.35rem',
        padding: '0.6rem 1rem',
        scrollbarWidth: 'none',
      }}>
        {menu.map((cat) => {
          const isActive = activeCategory === cat.id
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                whiteSpace: 'nowrap',
                padding: '0.45rem 1rem',
                borderRadius: 20,
                fontWeight: 700,
                fontSize: '0.82rem',
                letterSpacing: '0.01em',
                background: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                color: isActive ? '#000' : 'var(--text-muted)',
                transition: 'background 0.15s, color 0.15s',
                border: isActive ? 'none' : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {cat.emoji} {cat.name}
            </button>
          )
        })}
      </div>

      {/* ── Items grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
        gap: '1rem',
        padding: '1.1rem',
        paddingBottom: count > 0 ? '5.5rem' : '1.5rem',
      }}>
        {activeItems.map((item) => {
          const inCart = items.find((i) => i.id === item.id)
          const priceUsd = parseFloat(item.priceUsd)
          // Imagen válida: existe, no es string vacío
          const hasImage = Boolean(item.imageUrl && item.imageUrl.trim() !== '')

          return (
            <div
              key={item.id}
              style={{
                background: 'var(--surface)',
                borderRadius: 14,
                overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                border: inCart
                  ? '1.5px solid rgba(245,197,24,0.7)'
                  : '1.5px solid rgba(255,255,255,0.05)',
                transition: 'border 0.15s, box-shadow 0.15s',
                boxShadow: inCart
                  ? '0 0 16px rgba(245,197,24,0.12)'
                  : '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              {/* Image / Placeholder */}
              {hasImage ? (
                <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', overflow: 'hidden' }}>
                  <img
                    src={item.imageUrl!}
                    alt={item.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={(e) => {
                      // Si la imagen falla, mostrar el placeholder
                      const target = e.currentTarget
                      const parent = target.parentElement
                      if (parent) {
                        target.style.display = 'none'
                        parent.style.background = 'linear-gradient(135deg, #1E1E1E 0%, #2A2A2A 100%)'
                        parent.innerHTML = `
                          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:0.5rem">
                            <span style="font-size:2.2rem;opacity:0.6">🍽️</span>
                          </div>`
                      }
                    }}
                  />
                </div>
              ) : (
                <ItemPlaceholder name={item.name} />
              )}

              {/* Info */}
              <div style={{ padding: '0.65rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <p style={{ fontWeight: 700, fontSize: '0.85rem', lineHeight: 1.3 }}>{item.name}</p>
                {item.description && (
                  <p style={{
                    color: 'var(--text-muted)', fontSize: '0.72rem', lineHeight: 1.35,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                  }}>
                    {item.description}
                  </p>
                )}
                <p style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '0.88rem', marginTop: 'auto', paddingTop: '0.25rem' }}>
                  ${priceUsd.toFixed(2)}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.73rem' }}>
                    {' '}| Bs {(priceUsd * rate).toFixed(2)}
                  </span>
                </p>
              </div>

              {/* Add/remove controls */}
              <div style={{ padding: '0 0.75rem 0.75rem' }}>
                {inCart ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'rgba(245,197,24,0.08)', borderRadius: 8, padding: '0.2rem 0.3rem',
                  }}>
                    <button
                      onClick={() => remove(item.id)}
                      style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.1)', color: 'var(--text)',
                        fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.15s',
                      }}
                    >−</button>
                    <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--accent)' }}>
                      {inCart.quantity}
                    </span>
                    <button
                      onClick={() => add({ id: item.id, name: item.name, priceUsd, imageUrl: item.imageUrl })}
                      style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: 'var(--accent)', color: '#000',
                        fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800,
                        transition: 'transform 0.1s',
                      }}
                    >+</button>
                  </div>
                ) : (
                  <button
                    onClick={() => add({ id: item.id, name: item.name, priceUsd, imageUrl: item.imageUrl })}
                    style={{
                      width: '100%', padding: '0.5rem',
                      background: 'var(--accent)', color: '#000',
                      borderRadius: 8, fontWeight: 800, fontSize: '0.85rem',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    Agregar
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Floating cart bar ── */}
      {count > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '0.75rem 1rem',
          background: 'var(--accent)',
          zIndex: 100,
          boxShadow: '0 -4px 20px rgba(245,197,24,0.4)',
        }}>
          <button
            onClick={() => setCartOpen(true)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              color: '#000', fontWeight: 800, fontSize: '0.95rem',
            }}
          >
            <span style={{
              background: 'rgba(0,0,0,0.18)',
              borderRadius: 20,
              padding: '0.15rem 0.6rem',
              fontSize: '0.82rem', fontWeight: 800,
            }}>{count} {count === 1 ? 'ítem' : 'ítems'}</span>
            <span>Ver pedido</span>
            <span style={{ fontWeight: 800 }}>${total.toFixed(2)}</span>
          </button>
        </div>
      )}

      {cartOpen && (
        <CartDrawer
          items={items}
          total={total}
          deliveryFeeUsd={deliveryFeeUsd}
          rate={rate}
          onAdd={add}
          onRemove={remove}
          onClose={() => setCartOpen(false)}
          onCheckout={handleCheckout}
        />
      )}
    </Layout>
  )
}
