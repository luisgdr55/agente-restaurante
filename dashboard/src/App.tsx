import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store/useStore';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import OrdersPage from './pages/OrdersPage';
import SettingsPage from './pages/SettingsPage';
import CustomersPage from './pages/CustomersPage';
import MenuPage from './pages/MenuPage';
import AnalyticsPage from './pages/AnalyticsPage';
import FinancePage from './pages/FinancePage';
import ReviewsPage from './pages/ReviewsPage';
import ManualOrderPage from './pages/ManualOrderPage';
import KitchenLoginPage from './pages/KitchenLoginPage';
import KitchenPage from './pages/KitchenPage';
import NavBar from './components/NavBar';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function KitchenRoute({ children }: { children: React.ReactNode }) {
  return localStorage.getItem('kitchen_token')
    ? <>{children}</>
    : <Navigate to="/kitchen/login" replace />;
}

export default function App() {
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const location = useLocation();
  const isKitchenRoute = location.pathname.startsWith('/kitchen');
  return (
    <div className="app">
      {isAuthenticated && !isKitchenRoute && <NavBar />}
      <main className="main-content">
        <Routes>
          {/* Admin routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
          <Route path="/orders" element={<PrivateRoute><OrdersPage /></PrivateRoute>} />
          <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
          <Route path="/customers" element={<PrivateRoute><CustomersPage /></PrivateRoute>} />
          <Route path="/menu" element={<PrivateRoute><MenuPage /></PrivateRoute>} />
          <Route path="/analytics" element={<PrivateRoute><AnalyticsPage /></PrivateRoute>} />
          <Route path="/finance"   element={<PrivateRoute><FinancePage /></PrivateRoute>} />
          <Route path="/reviews"   element={<PrivateRoute><ReviewsPage /></PrivateRoute>} />
          <Route path="/manual-order" element={<PrivateRoute><ManualOrderPage /></PrivateRoute>} />

          {/* Kitchen routes — standalone, no admin nav */}
          <Route path="/kitchen/login" element={<KitchenLoginPage />} />
          <Route path="/kitchen" element={<KitchenRoute><KitchenPage /></KitchenRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
