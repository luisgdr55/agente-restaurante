import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { kitchenAuthApi } from '../api/api';

export default function KitchenLoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { token } = await kitchenAuthApi.login(pin);
      localStorage.setItem('kitchen_token', token);
      navigate('/kitchen');
    } catch {
      setError('PIN incorrecto. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="card" style={{ width: '100%', maxWidth: 360, padding: '2rem' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--warning)', fontSize: '1.5rem' }}>
          🍳 Cocina
        </h1>
        <form onSubmit={handleSubmit}>
          <label>PIN de cocina</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••••"
            autoFocus
            style={{ fontSize: '1.5rem', letterSpacing: '0.5rem', textAlign: 'center', marginTop: '0.5rem' }}
          />
          {error && <p style={{ color: 'var(--error)', marginTop: '0.5rem', fontSize: '0.85rem' }}>{error}</p>}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading || pin.length !== 6}
            style={{ width: '100%', marginTop: '1rem', padding: '0.75rem', background: 'var(--warning)' }}
          >
            {loading ? 'Verificando...' : 'Entrar a cocina'}
          </button>
        </form>
      </div>
    </div>
  );
}
