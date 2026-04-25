import { useEffect, useCallback, useState, useRef } from 'react';
import { ordersApi } from '../api/api';
import type { Order } from '../api/api';
import OrderCard from '../components/OrderCard';
import { useStore } from '../store/useStore';
import { getSocket } from '../socket/socket';

// ── Filter config ─────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'active' | 'PENDING_PAYMENT' | 'PAYMENT_UPLOADED' | 'PAYMENT_CONFIRMED' | 'IN_KITCHEN' | 'AWAITING_DRIVER_ASSIGNMENT' | 'READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';

const FILTERS: { key: FilterKey; label: string; emoji: string }[] = [
  { key: 'all',                        label: 'Todos',      emoji: '📋' },
  { key: 'active',                     label: 'Activos',    emoji: '🔥' },
  { key: 'PENDING_PAYMENT',            label: 'Pendiente',  emoji: '⏳' },
  { key: 'PAYMENT_UPLOADED',           label: 'Comprobante',emoji: '📎' },
  { key: 'PAYMENT_CONFIRMED',          label: 'Confirmado', emoji: '✅' },
  { key: 'IN_KITCHEN',                 label: 'Cocina',     emoji: '👨‍🍳' },
  { key: 'AWAITING_DRIVER_ASSIGNMENT', label: 'Motorizado', emoji: '🛵' },
  { key: 'READY',                      label: 'Listo',      emoji: '🟢' },
  { key: 'OUT_FOR_DELIVERY',           label: 'En camino',  emoji: '🛵' },
  { key: 'DELIVERED',                  label: 'Entregado',  emoji: '📦' },
  { key: 'CANCELLED',                  label: 'Cancelado',  emoji: '❌' },
];

const ACTIVE_STATUSES = ['PENDING_PAYMENT', 'PAYMENT_UPLOADED', 'PAYMENT_CONFIRMED', 'IN_KITCHEN', 'AWAITING_DRIVER_ASSIGNMENT', 'READY', 'OUT_FOR_DELIVERY'];

function filterOrders(orders: Order[], key: FilterKey): Order[] {
  if (key === 'all')    return orders;
  if (key === 'active') return orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  return orders.filter((o) => o.status === key);
}

function countFor(orders: Order[], key: FilterKey): number {
  return filterOrders(orders, key).length;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [todayOrders, setTodayOrders] = useState<Order[]>([]);
  const [loading, setLoading]         = useState(true);
  const [connected, setConnected]     = useState(false);
  const [filter, setFilter]           = useState<FilterKey>('all');
  const setOrders = useStore((s) => s.setOrders);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const timeout = <T,>(p: Promise<T>): Promise<T> =>
        Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000))]);

      const [activeResult, todayResult] = await Promise.allSettled([
        timeout(ordersApi.getActive()),
        timeout(ordersApi.getToday()),
      ]);

      const active = activeResult.status === 'fulfilled' ? activeResult.value : [];
      const today  = todayResult.status  === 'fulfilled' ? todayResult.value  : [];

      setOrders(active);
      setTodayOrders(today);
    } catch {
      // falla silenciosa — se muestra la página vacía
    } finally {
      setLoading(false);
    }
  }, [setOrders]);

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    void loadRef.current();

    const socket = getSocket();
    setConnected(socket.connected);

    const onConnect    = () => { setConnected(true);  void loadRef.current(); };
    const onDisconnect = () => { setConnected(false); };

    const onOrderNew = ({ order }: { order: Order }) => {
      setTodayOrders((prev) => {
        const exists = prev.some((o) => o.id === order.id);
        return exists ? prev : [order, ...prev];
      });
    };

    const onOrderUpdated = ({ order }: { order: Order }) => {
      setTodayOrders((prev) => {
        const exists = prev.some((o) => o.id === order.id);
        return exists
          ? prev.map((o) => (o.id === order.id ? order : o))
          : [order, ...prev];
      });
    };

    socket.on('connect',       onConnect);
    socket.on('disconnect',    onDisconnect);
    socket.on('order:new',     onOrderNew);
    socket.on('order:updated', onOrderUpdated);

    return () => {
      socket.off('connect',       onConnect);
      socket.off('disconnect',    onDisconnect);
      socket.off('order:new',     onOrderNew);
      socket.off('order:updated', onOrderUpdated);
    };
  }, []);

  if (loading) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text2)' }}>
      Cargando pedidos...
    </div>
  );

  const filtered = filterOrders(todayOrders, filter);
  const active   = filtered.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const done     = filtered.filter((o) => !ACTIVE_STATUSES.includes(o.status));
  const showGrouped = filter === 'all';

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center" style={{ marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '1.25rem' }}>📋 Pedidos de hoy ({todayOrders.length})</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
            fontSize: '0.72rem', color: connected ? 'var(--success)' : 'var(--error)',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? 'var(--success)' : 'var(--error)',
            }} />
            {connected ? 'En vivo' : 'Sin conexión'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => void load()}>↻</button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {FILTERS.map(({ key, label, emoji }) => {
          const count = countFor(todayOrders, key);
          const isActive = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="btn btn-sm"
              style={{
                background: isActive ? 'var(--accent)' : 'var(--surface2)',
                color: isActive ? '#fff' : count === 0 ? 'var(--text2)' : 'var(--text)',
                border: isActive ? 'none' : '1px solid transparent',
                fontWeight: isActive ? 700 : 400,
                opacity: count === 0 && !isActive ? 0.45 : 1,
              }}
            >
              {emoji} {label}
              {count > 0 && (
                <span style={{
                  marginLeft: '0.3rem',
                  background: isActive ? 'rgba(255,255,255,0.25)' : 'rgba(255,107,53,0.2)',
                  color: isActive ? '#fff' : 'var(--accent)',
                  borderRadius: '10px',
                  padding: '0 0.4rem',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Orders — grouped when "Todos", flat otherwise */}
      {todayOrders.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text2)' }}>
          No hay pedidos hoy todavía.
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text2)' }}>
          No hay pedidos con este estado.
        </div>
      ) : showGrouped ? (
        <>
          {active.length > 0 && (
            <>
              <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Activos ({active.length})</h3>
              <div className="card-grid" style={{ marginBottom: '1.5rem' }}>
                {active.map((o) => <OrderCard key={o.id} order={o} onRefresh={load} />)}
              </div>
            </>
          )}
          {done.length > 0 && (
            <>
              <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem', color: 'var(--text2)' }}>
                Completados ({done.length})
              </h3>
              <div className="card-grid">
                {done.map((o) => <OrderCard key={o.id} order={o} onRefresh={load} />)}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="card-grid">
          {filtered.map((o) => <OrderCard key={o.id} order={o} onRefresh={load} />)}
        </div>
      )}
    </div>
  );
}
