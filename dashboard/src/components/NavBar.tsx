import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';

export default function NavBar() {
  const logout = useStore((s) => s.logout);
  const lastUpdated = useStore((s) => s.lastUpdated);
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);

  function handleLogout() {
    setSheetOpen(false);
    logout();
  }

  function goTo(path: string) {
    setSheetOpen(false);
    navigate(path);
  }

  return (
    <>
      {/* ── Desktop top nav ─────────────────────────────────────────────── */}
      <nav className="top-nav" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--surface2)', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent)', letterSpacing: '0.02em' }}>🍗 Yebram's</span>
          <NavLink to="/" style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' })}>Panel</NavLink>
          <NavLink to="/orders" style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' })}>Pedidos</NavLink>
          <NavLink to="/settings" style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' })}>Config</NavLink>
          <NavLink to="/customers" style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' })}>Clientes</NavLink>
          <NavLink to="/menu" style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' })}>Menú</NavLink>
          <NavLink to="/analytics" style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' })}>Análisis</NavLink>
          <NavLink to="/finance"   style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' })}>Finanzas</NavLink>
          <NavLink to="/reviews"   style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' })}>Reseñas</NavLink>
          <NavLink to="/manual-order" style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text2)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' })}>➕ Pedido</NavLink>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {lastUpdated && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>
              ⚡ {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={logout}>Salir</button>
        </div>
      </nav>

      {/* ── Mobile bottom nav ───────────────────────────────────────────── */}
      <nav className="bottom-nav">
        <NavLink to="/" end>
          <span className="nav-icon">🏠</span>
          Panel
        </NavLink>
        <NavLink to="/orders">
          <span className="nav-icon">📋</span>
          Pedidos
        </NavLink>
        <NavLink to="/analytics">
          <span className="nav-icon">📈</span>
          Análisis
        </NavLink>
        <NavLink to="/customers">
          <span className="nav-icon">👥</span>
          Clientes
        </NavLink>
        <div className="bottom-nav-more" onClick={() => setSheetOpen(true)}>
          <span className="nav-icon">⋯</span>
          Más
        </div>
      </nav>

      {/* ── "Más" bottom sheet ──────────────────────────────────────────── */}
      {sheetOpen && (
        <>
          <div className="bottom-nav-overlay" onClick={() => setSheetOpen(false)} />
          <div className="bottom-nav-sheet">
            <button onClick={() => goTo('/manual-order')}>➕ Pedido manual</button>
            <button onClick={() => goTo('/finance')}>💰 Finanzas</button>
            <button onClick={() => goTo('/reviews')}>⭐ Reseñas</button>
            <button onClick={() => goTo('/menu')}>🍽️ Menú</button>
            <button onClick={() => goTo('/settings')}>⚙️ Config</button>
            {lastUpdated && (
              <button style={{ color: 'var(--text2)', cursor: 'default', fontWeight: 400, fontSize: '0.8rem' }} onClick={() => setSheetOpen(false)}>
                ⚡ Actualizado {lastUpdated.toLocaleTimeString()}
              </button>
            )}
            <button onClick={handleLogout} style={{ color: 'var(--error)' }}>🚪 Salir</button>
          </div>
        </>
      )}
    </>
  );
}
