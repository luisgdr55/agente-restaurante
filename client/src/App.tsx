import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import MenuPage from './pages/MenuPage'
import CheckoutPage from './pages/CheckoutPage'
import ConfirmPage from './pages/ConfirmPage'
import ReviewPage from './pages/ReviewPage'
import DriverPage from './pages/DriverPage'

function App() {
  console.log('%c[Yebram\'s] BUILD_V3 — SW cache invalidado', 'color:#F5C518;font-weight:bold')
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MenuPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/review/:orderId" element={<ReviewPage />} />
        <Route path="/driver/:orderId" element={<DriverPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
