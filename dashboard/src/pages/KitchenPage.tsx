import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { kitchenOrdersApi } from '../api/api';
import type { Order } from '../api/api';
import { io, Socket } from 'socket.io-client';

// ── Timer helpers ─────────────────────────────────────────────────────────────

function minutesSince(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
}

type AlertLevel = 'normal' | 'warning' | 'urgent';

function alertLevel(minutes: number): AlertLevel {
  if (minutes >= 18) return 'urgent';
  if (minutes >= 10) return 'warning';
  return 'normal';
}

function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function playBeep(frequency: number, duration: number, volume = 0.5) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = volume;
    osc.frequency.value = frequency;
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch { /* ignore */ }
}

function playNewOrderSound() {
  playBeep(880, 0.2);
}

function playUrgentSound() {
  // Triple beep for urgent
  try {
    const ctx = new AudioContext();
    [0, 0.25, 0.5].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.7;
      osc.frequency.value = 660;
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.2);
    });
  } catch { /* ignore */ }
}

const KITCHEN_STATUSES = ['PAYMENT_CONFIRMED', 'IN_KITCHEN'];

// ── CSS animations (injected once) ───────────────────────────────────────────

const KITCHEN_STYLES = `
@keyframes kitchenPulseYellow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245,197,24,0.5); border-color: #F5C518; }
  50%       { box-shadow: 0 0 0 8px rgba(245,197,24,0); border-color: #f7d04f; }
}
@keyframes kitchenPulseRed {
  0%, 30%  { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); border-color: #ef4444; background: var(--surface); }
  50%      { box-shadow: 0 0 0 12px rgba(239,68,68,0); border-color: #f87171; background: rgba(239,68,68,0.08); }
  100%     { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); border-color: #ef4444; background: var(--surface); }
}
.kitchen-warning {
  animation: kitchenPulseYellow 1.6s ease-in-out infinite;
  border-left: 5px solid #F5C518 !important;
}
.kitchen-urgent {
  animation: kitchenPulseRed 0.8s ease-in-out infinite;
  border-left: 5px solid #ef4444 !important;
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

export default function KitchenPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const urgentAlerted = useRef<Set<string>>(new Set()); // orders already alerted as urgent
  const navigate = useNavigate();

  // Inject CSS once
  useEffect(() => {
    const id = 'kitchen-anim-styles';
    if (!document.getElementById(id)) {
      const el = document.createElement('style');
      el.id = id;
      el.textContent = KITCHEN_STYLES;
      document.head.appendChild(el);
    }
  }, []);

  // Verify token
  useEffect(() => {
    if (!localStorage.getItem('kitchen_token')) {
      navigate('/kitchen/login', { replace: true });
    }
  }, [navigate]);

  // Tick every 30s — refresh timers and check for newly urgent orders
  useEffect(() => {
    const id = setInterval(() => {
      setTick((n) => n + 1);
      setOrders((prev) => {
        for (const order of prev) {
          const mins = minutesSince(order.createdAt);
          if (mins >= 18 && !urgentAlerted.current.has(order.id)) {
            urgentAlerted.current.add(order.id);
            playUrgentSound();
          }
        }
        return prev;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await kitchenOrdersApi.getKitchen();
      setOrders(data.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load + socket setup
  useEffect(() => {
    void load();

    const token = localStorage.getItem('kitchen_token');
    const socket = io(import.meta.env.VITE_API_URL ?? '', {
      path: '/ws',
      transports: ['websocket'],
      auth: { token },
    });
    socketRef.current = socket;

    const onNew = ({ order }: { order: Order }) => {
      if (!KITCHEN_STATUSES.includes(order.status)) return;
      setOrders((prev) => {
        const exists = prev.some((o) => o.id === order.id);
        if (exists) return prev;
        playNewOrderSound();
        return [...prev, order].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      });
    };

    const onUpdated = ({ order }: { order: Order }) => {
      if (!KITCHEN_STATUSES.includes(order.status)) {
        setOrders((prev) => prev.filter((o) => o.id !== order.id));
      } else {
        setOrders((prev) => {
          const exists = prev.some((o) => o.id === order.id);
          const next = exists
            ? prev.map((o) => (o.id === order.id ? order : o))
            : [...prev, order]; // upsert: add if transitioning into kitchen view
          return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
        // Play new order sound when order enters kitchen view for the first time
        setOrders((prev) => {
          const wasNew = !prev.some((o) => o.id === order.id);
          if (wasNew) playNewOrderSound();
          return prev;
        });
      }
    };

    socket.on('order:new', onNew);
    socket.on('order:updated', onUpdated);

    return () => {
      socket.off('order:new', onNew);
      socket.off('order:updated', onUpdated);
      socket.disconnect();
    };
  }, [load]);

  const markReady = async (id: string) => {
    setMarking(id);
    try {
      await kitchenOrdersApi.markReady(id);
      setOrders((prev) => prev.filter((o) => o.id !== id));
      urgentAlerted.current.delete(id);
    } catch {
      alert('Error al marcar como listo. Intenta de nuevo.');
    } finally {
      setMarking(null);
    }
  };

  const logout = () => {
    localStorage.removeItem('kitchen_token');
    socketRef.current?.disconnect();
    navigate('/kitchen/login', { replace: true });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--text2)' }}>
        Cargando...
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>🍳 Cocina</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{orders.length} pendiente{orders.length !== 1 ? 's' : ''}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => void load()}>↻</button>
          <button className="btn btn-ghost btn-sm" onClick={logout} style={{ fontSize: '0.75rem' }}>Salir</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.72rem', color: 'var(--text2)' }}>
        <span style={{ color: 'var(--success)' }}>● &lt;10 min</span>
        <span style={{ color: '#f97316' }}>● 10-14 min</span>
        <span style={{ color: '#ef4444' }}>● ≥18 min URGENTE</span>
      </div>

      {/* Orders */}
      {orders.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text2)' }}>
          <p style={{ fontSize: '3rem' }}>✅</p>
          <p style={{ marginTop: '1rem', fontSize: '1.1rem' }}>Sin pedidos pendientes</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {orders.map((order) => {
            const mins = minutesSince(order.createdAt);
            const level = alertLevel(mins);
            const timerColor = level === 'urgent' ? '#ef4444' : level === 'warning' ? '#f97316' : 'var(--success)';
            const fId = String(order.orderNumber).padStart(4, '0');
            const isBusy = marking === order.id;
            const cardClass = level === 'urgent' ? 'card kitchen-urgent' : level === 'warning' ? 'card kitchen-warning' : 'card';

            return (
              <div
                key={order.id}
                className={cardClass}
                style={{ borderLeft: `4px solid ${timerColor}`, padding: '1rem' }}
              >
                {/* Top row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div>
                    <span style={{ fontSize: '1.3rem', fontWeight: 700 }}>#{fId}</span>
                    <span style={{
                      marginLeft: '0.75rem',
                      fontSize: '0.75rem',
                      background: order.status === 'PAYMENT_CONFIRMED' ? 'var(--warning)' : 'var(--primary)',
                      color: '#fff',
                      padding: '0.15rem 0.5rem',
                      borderRadius: 4,
                    }}>
                      {order.status === 'PAYMENT_CONFIRMED' ? 'Confirmado' : 'En cocina'}
                    </span>
                    {level === 'urgent' && (
                      <span style={{
                        marginLeft: '0.5rem', fontSize: '0.7rem', fontWeight: 700,
                        color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>
                        ⚠️ URGENTE
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: level === 'urgent' ? '1.8rem' : '1.5rem',
                      fontWeight: 800,
                      color: timerColor,
                    }}>
                      {formatElapsed(mins)}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text2)' }}>
                      {order.deliveryType === 'DELIVERY' ? '🛵 Delivery' : '🏠 Retiro en local'}
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div style={{ marginBottom: '0.75rem' }}>
                  {order.items.map((item, i) => (
                    <div key={i} style={{ fontSize: '1rem', padding: '0.2rem 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>{item.quantity}×</span>
                      {' '}{item.menuItem.name}
                    </div>
                  ))}
                </div>

                {/* Customer */}
                <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
                  👤 {order.customer.name ?? order.customer.phone}
                  {order.deliveryAddress && <span> · 📍 {order.deliveryAddress}</span>}
                </div>

                {/* LISTO button */}
                <button
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '0.9rem',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    background: 'var(--success)',
                    letterSpacing: '0.05rem',
                  }}
                  disabled={isBusy}
                  onClick={() => void markReady(order.id)}
                >
                  {isBusy ? '...' : '✅ LISTO'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
