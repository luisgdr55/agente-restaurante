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
      background: '#2A2A2A',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
    }}>
      <span style={{ fontSize: '2rem' }}>🍽️</span>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0 0.5rem' }}>{name}</span>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <p style={{ color: 'var(--text-muted)' }}>Cargando menú...</p>
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
      {/* Hero */}
      <div style={{
        position: 'relative',
        minHeight: '60vh',
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
              objectPosition: 'center',
            }}
          />
        )}

        {/* Dark overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: heroError
            ? 'transparent'
            : 'rgba(0,0,0,0.58)',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, padding: '3rem 1.5rem 2rem' }}>
          <h1 style={{
            fontSize: 'clamp(2.4rem, 10vw, 4rem)',
            fontWeight: 900,
            color: '#FFFFFF',
            letterSpacing: '-1px',
            lineHeight: 1.1,
            marginBottom: '0.5rem',
            textShadow: '0 2px 16px rgba(0,0,0,0.7)',
          }}>
            Yebram's
          </h1>
          <p style={{
            fontSize: 'clamp(0.85rem, 4vw, 1.15rem)',
            fontWeight: 800,
            color: '#F5C518',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: '1.5rem',
            textShadow: '0 1px 8px rgba(0,0,0,0.6)',
          }}>
            Tu menú super crujiente
          </p>

          {/* Delivery badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(245,197,24,0.4)',
            borderRadius: 20,
            padding: '0.35rem 0.9rem',
            fontSize: '0.82rem', color: '#F5C518', fontWeight: 600,
            marginBottom: '2rem',
          }}>
            🛵 Delivery ${deliveryFeeUsd.toFixed(2)} | Bs {(deliveryFeeUsd * rate).toFixed(2)}
          </div>

          {/* CTA */}
          <div>
            <button
              onClick={() => menuRef.current?.scrollIntoView({ behavior: 'smooth' })}
              style={{
                padding: '0.8rem 2.2rem',
                background: '#F5C518',
                color: '#000',
                borderRadius: 30,
                fontWeight: 800,
                fontSize: '1rem',
                letterSpacing: '0.02em',
                boxShadow: '0 4px 20px rgba(245,197,24,0.4)',
              }}
            >
              Ver menú ↓
            </button>
          </div>
        </div>
      </div>

      {/* Category tabs */}
      <div ref={menuRef} style={{
        position: 'sticky', top: 57, zIndex: 50,
        background: 'var(--bg)',
        borderBottom: '1px solid #2A2A2A',
        overflowX: 'auto',
        display: 'flex', gap: '0.25rem',
        padding: '0.5rem 1rem',
        scrollbarWidth: 'none',
      }}>
        {menu.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            style={{
              whiteSpace: 'nowrap',
              padding: '0.4rem 0.85rem',
              borderRadius: 20,
              fontWeight: 600,
              fontSize: '0.85rem',
              background: activeCategory === cat.id ? 'var(--accent)' : 'var(--surface)',
              color: activeCategory === cat.id ? '#000' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}
          >
            {cat.emoji} {cat.name}
          </button>
        ))}
      </div>

      {/* Items grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: '0.85rem',
        padding: '1rem',
        paddingBottom: count > 0 ? '5rem' : '1rem',
      }}>
        {activeItems.map((item) => {
          const inCart = items.find((i) => i.id === item.id)
          const priceUsd = parseFloat(item.priceUsd)
          return (
            <div
              key={item.id}
              style={{
                background: 'var(--surface)',
                borderRadius: 12,
                overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                border: inCart ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                transition: 'border 0.15s',
              }}
            >
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <ItemPlaceholder name={item.name} />
              )}

              <div style={{ padding: '0.6rem 0.7rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <p style={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.3 }}>{item.name}</p>
                {item.description && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.3 }}>
                    {item.description.length > 50 ? item.description.slice(0, 50) + '…' : item.description}
                  </p>
                )}
                <p style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.85rem', marginTop: 'auto' }}>
                  ${priceUsd.toFixed(2)}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>
                    {' '}| Bs {(priceUsd * rate).toFixed(2)}
                  </span>
                </p>
              </div>

              {/* Add/remove controls */}
              <div style={{ padding: '0 0.7rem 0.7rem' }}>
                {inCart ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button
                      onClick={() => remove(item.id)}
                      style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: 'var(--surface2)', color: 'var(--text)',
                        fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >−</button>
                    <span style={{ fontWeight: 700 }}>{inCart.quantity}</span>
                    <button
                      onClick={() => add({ id: item.id, name: item.name, priceUsd, imageUrl: item.imageUrl })}
                      style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: 'var(--accent)', color: '#000',
                        fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700,
                      }}
                    >+</button>
                  </div>
                ) : (
                  <button
                    onClick={() => add({ id: item.id, name: item.name, priceUsd, imageUrl: item.imageUrl })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'var(--accent)', color: '#000',
                      borderRadius: 8, fontWeight: 700, fontSize: '0.85rem',
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

      {/* Floating cart bar */}
      {count > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '0.85rem 1rem',
          background: 'var(--accent)',
          zIndex: 100,
        }}>
          <button
            onClick={() => setCartOpen(true)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              color: '#000', fontWeight: 700, fontSize: '1rem',
            }}
          >
            <span style={{
              background: '#000', color: 'var(--accent)',
              borderRadius: '50%', width: 26, height: 26,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.8rem',
            }}>{count}</span>
            <span>Ver pedido</span>
            <span>${total.toFixed(2)}</span>
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
