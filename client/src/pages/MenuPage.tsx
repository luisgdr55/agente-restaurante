import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { publicApi, isRestaurantOpen, type MenuCategory, type PublicConfig } from '../api/api'
import { useCart } from '../store/cart'
import Layout from '../components/Layout'
import CartDrawer from '../components/CartDrawer'
import ItemDetailSheet from '../components/ItemDetailSheet'
import type { MenuItem } from '../api/api'
import axios from 'axios'

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const arr = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i)
  return arr.buffer
}

const HERO_BG = 'https://raw.githubusercontent.com/luisgdr55/agente-restaurante/master/public/menu-images/layebrams.jpg'

const MENU_STYLES = `
@keyframes fadeInDown {
  from { opacity: 0; transform: translateY(-22px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes heroPulse {
  0%, 100% { box-shadow: 0 4px 24px rgba(245,197,24,0.45); }
  50%       { box-shadow: 0 4px 40px rgba(245,197,24,0.8); }
}
@keyframes gridFadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes cartBounce {
  0%   { transform: scale(1); }
  35%  { transform: scale(1.4); }
  65%  { transform: scale(0.88); }
  100% { transform: scale(1); }
}
@keyframes scrollBounce {
  0%, 100% { transform: translateY(0); opacity: 0.4; }
  50%       { transform: translateY(6px); opacity: 0.7; }
}
@keyframes spin { to { transform: rotate(360deg) } }
@keyframes pulseAmbar {
  0%, 100% { box-shadow: 0 2px 12px rgba(245,158,11,0.3); }
  50%       { box-shadow: 0 2px 28px rgba(245,158,11,0.85); }
}
@keyframes pulseRed {
  0%, 100% { box-shadow: 0 2px 12px rgba(239,68,68,0.3); }
  50%       { box-shadow: 0 2px 28px rgba(239,68,68,0.85); }
}
@keyframes pulseIndigo {
  0%, 100% { box-shadow: 0 2px 12px rgba(99,102,241,0.3); }
  50%       { box-shadow: 0 2px 28px rgba(99,102,241,0.85); }
}
`

function ItemPlaceholder() {
  return (
    <div style={{
      width: '100%', aspectRatio: '4/3',
      background: 'linear-gradient(135deg, #1E1E1E 0%, #2A2A2A 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
    }}>
      <span style={{ fontSize: '2.2rem', opacity: 0.4 }}>🍽️</span>
    </div>
  )
}

export default function MenuPage() {
  const [menu, setMenu] = useState<MenuCategory[]>([])
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartClosing, setCartClosing] = useState(false)
  const [heroError, setHeroError] = useState(false)
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)
  const [touchedCard, setTouchedCard] = useState<string | null>(null)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null)
  const [notifLoading, setNotifLoading] = useState(false)
  const [heroHovered, setHeroHovered] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [countBouncing, setCountBouncing] = useState(false)
  const [pauseCountdown, setPauseCountdown] = useState<string | null>(null)
  const [unavailableWarnings, setUnavailableWarnings] = useState<string[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)
  const { items, add, remove, clear, total, count } = useCart()
  const navigate = useNavigate()

  useEffect(() => {
    console.log('[Yebram\'s] Hero image URL:', HERO_BG)
    Promise.all([publicApi.getMenu(), publicApi.getConfig()])
      .then(([menuData, configData]) => {
        setMenu(menuData)
        setConfig(configData)
        if (menuData.length > 0) setActiveCategory(menuData[0].id)
      })
      .finally(() => setLoading(false))
    if ('Notification' in window) {
      setNotifPermission(Notification.permission)
    }
  }, [])

  // Bounce cart counter when an item is added
  useEffect(() => {
    if (count > prevCountRef.current) {
      setCountBouncing(true)
      const t = setTimeout(() => setCountBouncing(false), 420)
      prevCountRef.current = count
      return () => clearTimeout(t)
    }
    prevCountRef.current = count
  }, [count])

  // Real-time config + menu updates
  useEffect(() => {
    const BACKEND = import.meta.env.VITE_BACKEND_URL ?? 'https://yebrams.up.railway.app'
    const socket = io(BACKEND, { path: '/ws', transports: ['websocket'], reconnection: true })
    socket.on('config:updated', ({ key, value }: { key: string; value: string }) => {
      setConfig(prev => prev ? { ...prev, [key]: value } as PublicConfig : prev)
    })
    socket.on('menu:updated', () => {
      publicApi.getMenu().then(menuData => {
        setMenu(menuData)
        const allIds = new Set(menuData.flatMap(c => c.items).map(mi => mi.id))
        setUnavailableWarnings(prev => {
          const newWarnings = items
            .filter(ci => !allIds.has(ci.id))
            .map(ci => ci.name)
          return [...new Set([...prev, ...newWarnings])]
        })
      }).catch(() => undefined)
    })
    return () => { socket.disconnect() }
  }, [items])

  // Pause countdown
  useEffect(() => {
    if (config?.IS_ORDERS_PAUSED !== 'true' || !config.ORDERS_PAUSE_UNTIL) {
      setPauseCountdown(null)
      return
    }
    const update = () => {
      const ms = new Date(config.ORDERS_PAUSE_UNTIL!).getTime() - Date.now()
      if (ms <= 0) {
        setPauseCountdown(null)
        setConfig(prev => prev ? { ...prev, IS_ORDERS_PAUSED: 'false' } as PublicConfig : prev)
        return
      }
      const m = Math.floor(ms / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      setPauseCountdown(`${m}:${s.toString().padStart(2, '0')}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [config?.IS_ORDERS_PAUSED, config?.ORDERS_PAUSE_UNTIL])

  const handleCartClose = () => {
    setCartClosing(true)
    setTimeout(() => {
      setCartOpen(false)
      setCartClosing(false)
    }, 200)
  }

  const handleAddWithFeedback = (item: MenuItem) => {
    const priceUsd = parseFloat(item.priceUsd)
    add({ id: item.id, name: item.name, priceUsd, imageUrl: item.imageUrl })
    setAddingId(item.id)
    setTimeout(() => setAddingId(null), 150)
  }

  const handleEnableNotifications = async () => {
    if (!config?.vapidPublicKey) return
    const phone = localStorage.getItem('yebrams_last_phone')
    if (!phone) return
    setNotifLoading(true)
    try {
      const permission = await Notification.requestPermission()
      setNotifPermission(permission)
      if (permission !== 'granted') return
      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
      })
      const sub = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      await axios.post(`${import.meta.env.VITE_BACKEND_URL ?? 'https://yebrams.up.railway.app'}/api/push/subscribe`, { endpoint: sub.endpoint, keys: sub.keys, phone })
      localStorage.setItem('yebrams_push_asked', '1')
    } catch {
      // Silently fail — non-critical
    } finally {
      setNotifLoading(false)
    }
  }

  const isPaused = config?.IS_ORDERS_PAUSED === 'true'

  const handleCheckout = () => {
    if (items.length === 0) return
    if (isPaused) return
    sessionStorage.setItem('yebrams_checkout_cart', JSON.stringify(items))
    sessionStorage.setItem('yebrams_checkout_config', JSON.stringify(config))
    handleCartClose()
    setTimeout(() => navigate('/checkout'), 200)
  }

  const deliveryFeeUsd = parseFloat(config?.DELIVERY_FEE_USD ?? '1.50')
  const rate = parseFloat(config?.USD_TO_BS_RATE ?? '36.50')

  const activeItems = menu.find((c) => c.id === activeCategory)?.items ?? []
  const activeMenuIds = new Set(menu.flatMap(c => c.items).map(i => i.id))

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
      <style>{MENU_STYLES}</style>

      {/* ── Hero — ocupa el 100% del viewport ── */}
      <div style={{
        position: 'relative',
        height: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center',
        overflow: 'hidden',
        background: heroError
          ? 'linear-gradient(160deg, #1A1A1A 0%, #2A2A2A 60%, #1A1A1A 100%)'
          : undefined,
      }}>
        {!heroError && (
          <img
            src={HERO_BG}
            alt=""
            aria-hidden="true"
            onLoad={() => console.log('[hero] imagen cargada OK:', HERO_BG)}
            onError={() => {
              console.warn('[hero] imagen FALLÓ, activando fallback. URL:', HERO_BG)
              setHeroError(true)
            }}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover',
              objectPosition: 'center 30%',
              display: 'block',
            }}
          />
        )}

        {/* Overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: heroError
            ? 'transparent'
            : 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.6) 55%, rgba(0,0,0,0.85) 100%)',
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
            animation: 'fadeInDown 0.6s ease-out both',
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
            animation: 'fadeIn 0.6s ease-out 0.3s both',
          }}>
            Tu menú super crujiente
          </p>

          <div>
            <button
              onClick={() => menuRef.current?.scrollIntoView({ behavior: 'smooth' })}
              onMouseEnter={() => setHeroHovered(true)}
              onMouseLeave={() => setHeroHovered(false)}
              style={{
                padding: '0.9rem 2.5rem',
                background: '#F5C518',
                color: '#000',
                borderRadius: 30,
                fontWeight: 800,
                fontSize: '1.05rem',
                letterSpacing: '0.02em',
                animation: 'heroPulse 2.5s ease-in-out infinite',
                transform: heroHovered ? 'scale(1.05)' : 'scale(1)',
                transition: 'transform 0.2s ease',
              }}
            >
              Ver menú ↓
            </button>
          </div>
        </div>

        {/* Scroll hint */}
        <div style={{
          position: 'absolute', bottom: '1.5rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
          opacity: 0.5,
          animation: 'scrollBounce 2s infinite',
        }}>
          <div style={{ width: 1, height: 28, background: '#F5C518' }} />
        </div>
      </div>

      {/* ── Unavailable items warning ── */}
      {unavailableWarnings.length > 0 && (
        <div style={{
          position: 'sticky', top: 57, zIndex: 85,
          background: '#422006', borderBottom: '2px solid #f97316',
          padding: '0.55rem 1rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: '0.92rem', fontWeight: 700, color: '#fed7aa',
        }}>
          <span>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            {' '}{unavailableWarnings.join(', ')} ya no {unavailableWarnings.length === 1 ? 'está disponible' : 'están disponibles'} — revisa tu carrito
          </span>
          <button
            onClick={() => setUnavailableWarnings([])}
            style={{ marginLeft: '1rem', background: 'transparent', color: '#fed7aa', fontSize: '1.3rem', flexShrink: 0 }}
          >×</button>
        </div>
      )}

      {/* ── Crisis banners ── */}
      {(config?.IS_HIGH_DEMAND === 'true' || config?.IS_POWER_OUTAGE === 'true' || isPaused) && (
        <div style={{ position: 'sticky', top: 57, zIndex: 80 }}>
          {config?.IS_HIGH_DEMAND === 'true' && (
            <div style={{
              background: '#78350f',
              borderBottom: '2px solid #f59e0b',
              padding: '0.55rem 1rem',
              textAlign: 'center',
              fontSize: '1rem', fontWeight: 700, color: '#fde68a',
              animation: 'pulseAmbar 1.5s ease-in-out infinite',
            }}>
              <span style={{ fontSize: '1.3rem' }}>⏳</span>{' '}Alta demanda — los tiempos de espera son mayores al normal
            </div>
          )}
          {config?.IS_POWER_OUTAGE === 'true' && (
            <div style={{
              background: '#7f1d1d',
              borderBottom: '2px solid #ef4444',
              padding: '0.55rem 1rem',
              textAlign: 'center',
              fontSize: '1rem', fontWeight: 700, color: '#fecaca',
              animation: 'pulseRed 1.5s ease-in-out infinite',
            }}>
              <span style={{ fontSize: '1.3rem' }}>⚡</span>{' '}{config.OUTAGE_MESSAGE || 'Estamos con fallas eléctricas, procesando pedidos con cautela'}
            </div>
          )}
          {isPaused && (
            <div style={{
              background: '#1e1b4b',
              borderBottom: '2px solid #6366f1',
              padding: '0.55rem 1rem',
              textAlign: 'center',
              fontSize: '1rem', fontWeight: 700, color: '#c7d2fe',
              animation: 'pulseIndigo 1.5s ease-in-out infinite',
            }}>
              <span style={{ fontSize: '1.3rem' }}>⏸️</span>{' '}Pedidos pausados
              {pauseCountdown && ` — reabrimos en ${pauseCountdown}`}
            </div>
          )}
        </div>
      )}

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
      <div
        key={activeCategory ?? ''}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
          gap: '1rem',
          padding: '1.1rem',
          paddingBottom: count > 0 ? '5.5rem' : '1.5rem',
          animation: 'gridFadeIn 0.25s ease-out both',
        }}
      >
        {activeItems.map((item) => {
          const inCart = items.find((i) => i.id === item.id)
          const priceUsd = parseFloat(item.priceUsd)
          const hasImage = Boolean(item.imageUrl && item.imageUrl.trim() !== '')
          const isNeon = hoveredCard === item.id || touchedCard === item.id

          return (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              onMouseEnter={() => setHoveredCard(item.id)}
              onMouseLeave={() => setHoveredCard(null)}
              onTouchStart={() => {
                setTouchedCard(item.id)
                setTimeout(() => setTouchedCard(null), 350)
              }}
              style={{
                background: 'var(--surface)',
                borderRadius: 14,
                overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                border: isNeon
                  ? '1px solid #F5C518'
                  : inCart
                    ? '1.5px solid rgba(245,197,24,0.7)'
                    : '1.5px solid rgba(255,255,255,0.05)',
                transition: 'border 0.2s, box-shadow 0.2s, transform 0.2s',
                transform: isNeon ? 'translateY(-4px)' : 'translateY(0)',
                boxShadow: isNeon
                  ? '0 8px 24px rgba(245,197,24,0.2), 0 0 8px #F5C518'
                  : inCart
                    ? '0 0 16px rgba(245,197,24,0.12)'
                    : '0 2px 8px rgba(0,0,0,0.3)',
                cursor: 'pointer',
              }}
            >
              {/* Image */}
              {hasImage ? (
                <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', overflow: 'hidden' }}>
                  <img
                    src={item.imageUrl!}
                    alt={item.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={(e) => {
                      const target = e.currentTarget
                      const parent = target.parentElement
                      if (parent) {
                        target.style.display = 'none'
                        parent.style.background = 'linear-gradient(135deg, #1E1E1E 0%, #2A2A2A 100%)'
                        parent.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%"><span style="font-size:2rem;opacity:0.4">🍽️</span></div>'
                      }
                    }}
                  />
                </div>
              ) : (
                <ItemPlaceholder />
              )}

              {/* Info */}
              <div style={{ padding: '0.65rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <p style={{ fontWeight: 700, fontSize: '0.85rem', lineHeight: 1.3 }}>{item.name}</p>
                <p style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '0.88rem', marginTop: 'auto', paddingTop: '0.25rem' }}>
                  ${priceUsd.toFixed(2)}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.73rem' }}>
                    {' '}| Bs {(priceUsd * rate).toFixed(2)}
                  </span>
                </p>
              </div>

              {/* Add/remove */}
              <div
                style={{ padding: '0 0.75rem 0.75rem' }}
                onClick={(e) => e.stopPropagation()}
              >
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
                      }}
                    >−</button>
                    <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--accent)' }}>
                      {inCart.quantity}
                    </span>
                    <button
                      onClick={() => {
                        add({ id: item.id, name: item.name, priceUsd, imageUrl: item.imageUrl })
                        setAddingId(item.id)
                        setTimeout(() => setAddingId(null), 150)
                      }}
                      style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: 'var(--accent)', color: '#000',
                        fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800,
                        transform: addingId === item.id ? 'scale(0.82)' : 'scale(1)',
                        transition: 'transform 0.15s ease',
                      }}
                    >+</button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleAddWithFeedback(item)}
                    style={{
                      width: '100%', padding: '0.5rem',
                      background: 'var(--accent)', color: '#000',
                      borderRadius: 8, fontWeight: 800, fontSize: '0.85rem',
                      transform: addingId === item.id ? 'scale(0.92)' : 'scale(1)',
                      transition: 'transform 0.15s ease',
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

      {/* ── Push notification prompt ── */}
      {notifPermission === 'default'
        && config?.vapidPublicKey
        && localStorage.getItem('yebrams_last_phone')
        && 'serviceWorker' in navigator && (
        <div style={{ textAlign: 'center', padding: '0.75rem 1rem 0' }}>
          <button
            onClick={() => void handleEnableNotifications()}
            disabled={notifLoading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.45rem 1rem',
              border: '1px solid rgba(245,197,24,0.2)',
              borderRadius: '999px',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: '0.8rem',
              opacity: notifLoading ? 0.6 : 1,
            }}
          >
            🔔 {notifLoading ? 'Activando...' : 'Activar notificaciones de pedidos'}
          </button>
        </div>
      )}

      {/* ── Developer credit footer ── */}
      <footer style={{
        background: '#0D0D0D',
        paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        paddingTop: '1.75rem',
        paddingLeft: '1.25rem',
        paddingRight: '1.25rem',
        textAlign: 'center',
      }}>
        <div style={{
          width: '48px', height: '1px',
          background: 'rgba(245,197,24,0.2)',
          margin: '0 auto 1.25rem',
        }} />
        <p style={{ fontSize: '11px', color: '#555', marginBottom: '0.35rem', letterSpacing: '0.04em' }}>
          <span style={{ opacity: 0.5 }}>&lt;/&gt;</span>
          {'  '}⚡ Potenciado por tecnología
        </p>
        <p style={{ fontSize: '12px', color: '#888', marginBottom: '1rem' }}>
          Desarrollado por{' '}
          <span style={{ color: '#F5C518', fontWeight: 700 }}>Luis</span>
        </p>
        <a
          href="https://wa.me/584165434760?text=Hola%20Luis!%20Vi%20tu%20trabajo%20en%20Yebram's%20y%20me%20interesa%20un%20sistema%20as%C3%AD%20para%20mi%20negocio%20%F0%9F%8D%BD%EF%B8%8F"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            padding: '0.45rem 0.9rem',
            border: '1px solid rgba(245,197,24,0.25)',
            borderRadius: '999px',
            fontSize: '11px',
            color: '#aaa',
            textDecoration: 'none',
            letterSpacing: '0.02em',
            transition: 'border-color 0.2s, color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(245,197,24,0.6)'
            e.currentTarget.style.color = '#F5C518'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(245,197,24,0.25)'
            e.currentTarget.style.color = '#aaa'
          }}
        >
          Quiero esto para mi negocio{' '}
          <span style={{ fontSize: '10px', opacity: 0.8 }}>→</span>
        </a>
      </footer>

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
              display: 'inline-block',
              animation: countBouncing ? 'cartBounce 0.42s ease-out' : 'none',
            }}>{count} {count === 1 ? 'ítem' : 'ítems'}</span>
            <span>Ver pedido</span>
            <span style={{ fontWeight: 800 }}>${total.toFixed(2)}</span>
          </button>
        </div>
      )}

      {/* ── Item detail bottom sheet ── */}
      {selectedItem && (
        <ItemDetailSheet
          item={selectedItem}
          rate={rate}
          cartItem={items.find((i) => i.id === selectedItem.id)}
          onAdd={add}
          onRemove={remove}
          onClose={() => setSelectedItem(null)}
        />
      )}

      {/* ── Cart drawer ── */}
      {cartOpen && (
        <CartDrawer
          items={items}
          total={total}
          deliveryFeeUsd={deliveryFeeUsd}
          rate={rate}
          onAdd={add}
          onRemove={remove}
          onClear={clear}
          onClose={handleCartClose}
          onCheckout={handleCheckout}
          closing={cartClosing}
          isPaused={isPaused}
          pauseCountdown={pauseCountdown}
          activeMenuIds={activeMenuIds}
        />
      )}
    </Layout>
  )
}
