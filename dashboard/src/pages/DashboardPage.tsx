import { useEffect, useCallback, useRef, useState } from 'react';
import { statsApi, ordersApi } from '../api/api';
import { useStore } from '../store/useStore';
import { getSocket } from '../socket/socket';
import StatsCard from '../components/StatsCard';
import OrderCard from '../components/OrderCard';
import type { Order, Stats } from '../api/api';

const POLL_INTERVAL = 30_000; // 30s fallback polling

function playNewOrderAlert() {
  try {
    const ctx = new AudioContext();
    // 3 beeps ascendentes: 880 Hz → 1046 Hz → 1318 Hz (A5 → C6 → E6)
    const freqs = [880, 1046, 1318];
    const beepDuration = 0.12;   // segundos por beep
    const gap = 0.07;            // silencio entre beeps

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.value = freq;

      const start = ctx.currentTime + i * (beepDuration + gap);
      const end = start + beepDuration;

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.4, start + 0.01); // fade in rápido
      gain.gain.setValueAtTime(0.4, end - 0.02);
      gain.gain.linearRampToValueAtTime(0, end);             // fade out suave

      osc.start(start);
      osc.stop(end);
    });

    // Cierra el contexto tras el último beep
    const totalDuration = freqs.length * (beepDuration + gap) + 0.1;
    setTimeout(() => void ctx.close(), totalDuration * 1000);
  } catch {
    // Web Audio no disponible — falla silenciosamente
  }
}

export default function DashboardPage() {
  const stats       = useStore((s) => s.stats);
  const orders      = useStore((s) => s.orders);
  const setStats    = useStore((s) => s.setStats);
  const setOrders   = useStore((s) => s.setOrders);
  const upsertOrder = useStore((s) => s.upsertOrder);
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([statsApi.get(), ordersApi.getActive()]);
      setStats(s);
      setOrders(o);
    } catch { /* interceptor maneja 401 */ }
  }, [setStats, setOrders]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    void refreshRef.current();
    const id = setInterval(() => void refreshRef.current(), POLL_INTERVAL);

    const socket = getSocket();

    // Sync connection state indicator
    setConnected(socket.connected);
    const onConnect    = () => { setConnected(true);  void refreshRef.current(); };
    const onDisconnect = () => { setConnected(false); };

    const onOrderNew = ({ order }: { order: Order }) => {
      upsertOrder(order);
      playNewOrderAlert();
      void statsApi.get().then(setStats).catch(() => undefined);
    };

    const onOrderUpdated = ({ order }: { order: Order }) => {
      upsertOrder(order);
      void statsApi.get().then(setStats).catch(() => undefined);
    };

    const onStatsUpdated = ({ stats }: { stats: Stats }) => {
      setStats(stats);
    };

    socket.on('connect',       onConnect);
    socket.on('disconnect',    onDisconnect);
    socket.on('order:new',     onOrderNew);
    socket.on('order:updated', onOrderUpdated);
    socket.on('stats:updated', onStatsUpdated);

    return () => {
      clearInterval(id);
      socket.off('connect',       onConnect);
      socket.off('disconnect',    onDisconnect);
      socket.off('order:new',     onOrderNew);
      socket.off('order:updated', onOrderUpdated);
      socket.off('stats:updated', onStatsUpdated);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upsertOrder, setStats]);

  const urgent    = orders.filter((o) => ['PAYMENT_UPLOADED', 'PAYMENT_CONFIRMED', 'AWAITING_DRIVER_ASSIGNMENT'].includes(o.status));
  const inKitchen = orders.filter((o) => ['IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY'].includes(o.status));
  const pending   = orders.filter((o) => o.status === 'PENDING_PAYMENT');

  return (
    <div>
      {/* Header con indicador de conexión */}
      <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.25rem' }}>📊 Panel de hoy</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
            fontSize: '0.72rem', color: connected ? 'var(--success)' : 'var(--error)',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? 'var(--success)' : 'var(--error)',
              boxShadow: connected ? '0 0 0 2px rgba(16,185,129,0.3)' : 'none',
            }} />
            {connected ? 'En vivo' : 'Sin conexión'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => void refresh()}>↻</button>
        </div>
      </div>

      {stats && (
        <div className="card-grid" style={{ marginBottom: '1.5rem' }}>
          <StatsCard label="Pedidos hoy"    value={stats.totalOrders}                  emoji="🛒" />
          <StatsCard label="En proceso"     value={stats.inProgress}                   emoji="🍳" color="var(--warning)" />
          <StatsCard label="Entregados"     value={stats.delivered}                    emoji="✅" color="var(--success)" />
          <StatsCard label="Cancelados"     value={stats.cancelled}                    emoji="❌" color="var(--error)" />
          <StatsCard label="Ingresos (Bs)"  value={stats.revenueBs.toFixed(2)}         emoji="💰" color="var(--accent)" />
          <StatsCard label="Ingresos (USD)" value={`$${stats.revenueUsd.toFixed(2)}`}  emoji="💵" color="var(--accent)" />
        </div>
      )}

      {urgent.length > 0 && (
        <>
          <h3 style={{ marginBottom: '0.75rem', color: 'var(--warning)' }}>
            ⚠️ Requieren acción ({urgent.length})
          </h3>
          <div className="card-grid" style={{ marginBottom: '1.5rem' }}>
            {urgent.map((o) => <OrderCard key={o.id} order={o} onRefresh={refresh} />)}
          </div>
        </>
      )}

      {inKitchen.length > 0 && (
        <>
          <h3 style={{ marginBottom: '0.75rem' }}>🍳 En cocina / Listos ({inKitchen.length})</h3>
          <div className="card-grid" style={{ marginBottom: '1.5rem' }}>
            {inKitchen.map((o) => <OrderCard key={o.id} order={o} onRefresh={refresh} />)}
          </div>
        </>
      )}

      {pending.length > 0 && (
        <>
          <h3 style={{ marginBottom: '0.75rem', color: 'var(--text2)' }}>
            ⏳ Esperando pago ({pending.length})
          </h3>
          <div className="card-grid" style={{ marginBottom: '1.5rem' }}>
            {pending.map((o) => <OrderCard key={o.id} order={o} onRefresh={refresh} />)}
          </div>
        </>
      )}

      {orders.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text2)' }}>
          <p style={{ fontSize: '3rem' }}>🎉</p>
          <p style={{ marginTop: '1rem' }}>No hay pedidos activos ahora.</p>
        </div>
      )}
    </div>
  );
}
