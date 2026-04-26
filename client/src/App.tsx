import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import './index.css'
import MenuPage from './pages/MenuPage'
import CheckoutPage from './pages/CheckoutPage'
import ConfirmPage from './pages/ConfirmPage'
import ReviewPage from './pages/ReviewPage'
import DriverPage from './pages/DriverPage'
import OrderTrackingPage, { loadActiveOrder, clearActiveOrder } from './pages/OrderTrackingPage'

const TERMINAL_STATUSES = ['DELIVERED', 'CANCELLED']

// Redirects to active order tracking page if one exists in localStorage
function ActiveOrderGuard() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // Only redirect from root path
    if (location.pathname !== '/') return
    const active = loadActiveOrder()
    if (!active) return
    if (TERMINAL_STATUSES.includes(active.status)) {
      clearActiveOrder()
      return
    }
    navigate(`/order/${active.orderId}`, { replace: true })
  }, [location.pathname, navigate])

  return null
}

function AutoUpdate() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    })
  }, [])
  return null
}

function App() {
  console.log('%c[Yebram\'s] BUILD_V4', 'color:#F5C518;font-weight:bold')
  return (
    <BrowserRouter>
      <ActiveOrderGuard />
      <Routes>
        <Route path="/" element={<MenuPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/order/:orderId" element={<OrderTrackingPage />} />
        <Route path="/review/:orderId" element={<ReviewPage />} />
        <Route path="/driver/:orderId" element={<DriverPage />} />
      </Routes>
      <AutoUpdate />
    </BrowserRouter>
  )
}

export default App
