import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import MenuPage from './pages/MenuPage'
import CheckoutPage from './pages/CheckoutPage'
import ConfirmPage from './pages/ConfirmPage'
import ReviewPage from './pages/ReviewPage'
import DriverPage from './pages/DriverPage'

function UpdateToast() {
  const [show, setShow] = useState(false)
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.ready.then((r) => {
      setReg(r)
      // Ya hay un SW esperando (ej: recargó la página con una actualización pendiente)
      if (r.waiting) setShow(true)

      // Detectar nuevo SW instalándose
      r.addEventListener('updatefound', () => {
        const newWorker = r.installing
        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setShow(true)
          }
        })
      })
    })

    // Cuando el SW nuevo toma control → recargar la página
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    })
  }, [])

  const handleUpdate = () => {
    reg?.waiting?.postMessage({ type: 'SKIP_WAITING' })
    setShow(false)
  }

  if (!show) return null

  return (
    <div style={{
      position: 'fixed', bottom: '1rem', left: '1rem', right: '1rem',
      background: '#1C1C1C',
      border: '1px solid rgba(245,197,24,0.4)',
      borderRadius: 14,
      padding: '0.85rem 1rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
      zIndex: 9999,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      animation: 'slideUpToast 0.3s ease-out',
    }}>
      <style>{`
        @keyframes slideUpToast {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
      <div>
        <p style={{ fontWeight: 700, fontSize: '0.88rem' }}>Nueva versión disponible</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.1rem' }}>
          Actualiza para ver los últimos cambios
        </p>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button
          onClick={() => setShow(false)}
          style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '0.3rem 0.6rem' }}
        >
          Luego
        </button>
        <button
          onClick={handleUpdate}
          style={{
            background: 'var(--accent)', color: '#000',
            borderRadius: 8, fontWeight: 700, fontSize: '0.82rem',
            padding: '0.4rem 0.9rem',
          }}
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}

function App() {
  console.log('%c[Yebram\'s] BUILD_V4', 'color:#F5C518;font-weight:bold')
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MenuPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/review/:orderId" element={<ReviewPage />} />
        <Route path="/driver/:orderId" element={<DriverPage />} />
      </Routes>
      <UpdateToast />
    </BrowserRouter>
  )
}

export default App
