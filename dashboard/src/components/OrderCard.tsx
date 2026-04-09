import { useState, useEffect } from 'react';
import type { Order, Driver } from '../api/api';
import { ordersApi, driversApi } from '../api/api';

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT:            '⏳ Pend. pago',
  PAYMENT_UPLOADED:           '📤 Comp. subido',
  PAYMENT_CONFIRMED:          '✅ Pago conf.',
  PAYMENT_REJECTED:           '❌ Pago rechazado',
  IN_KITCHEN:                 '🍳 En cocina',
  AWAITING_DRIVER_ASSIGNMENT: '🛵 Asignar motorizado',
  READY:                      '🎉 Listo',
  OUT_FOR_DELIVERY:           '🛵 En camino',
  DELIVERED:                  '✅ Entregado',
  CANCELLED:                  '❌ Cancelado',
};

const STATUS_COLOR: Record<string, string> = {
  PENDING_PAYMENT:            '#f59e0b',
  PAYMENT_UPLOADED:           '#3b82f6',
  PAYMENT_CONFIRMED:          '#10b981',
  PAYMENT_REJECTED:           '#ef4444',
  IN_KITCHEN:                 '#f97316',
  AWAITING_DRIVER_ASSIGNMENT: '#ec4899',
  READY:                      '#8b5cf6',
  OUT_FOR_DELIVERY:           '#6366f1',
  DELIVERED:                  '#10b981',
  CANCELLED:                  '#6b7280',
};

const PAYMENT_LABELS: Record<string, string> = {
  PAGO_MOVIL:       '📱 Pago Móvil',
  CASH_ON_DELIVERY: '💵 Efectivo',
};

const TERMINAL = ['DELIVERED', 'CANCELLED'];

interface Props {
  order: Order;
  onRefresh: () => void;
}

export default function OrderCard({ order, onRefresh }: Props) {
  const [loading, setLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [adHocMode, setAdHocMode] = useState(false);
  const [adHocName, setAdHocName] = useState('');
  const [adHocPhone, setAdHocPhone] = useState('');

  useEffect(() => {
    if (order.status === 'AWAITING_DRIVER_ASSIGNMENT') {
      driversApi.getAll().then((all) => {
        setDrivers(all.filter((d) => d.isActive));
      }).catch(() => undefined);
    }
  }, [order.status]);

  const orderNum = String(order.orderNumber).padStart(4, '0');
  const createdAt = new Date(order.createdAt);
  const timeAgo = Math.round((Date.now() - createdAt.getTime()) / 60000);
  const borderColor = STATUS_COLOR[order.status] ?? '#6b7280';

  const doAction = async (status: string, reason?: string) => {
    setLoading(true);
    try {
      await ordersApi.updateStatus(order.id, status, reason);
      onRefresh();
    } finally {
      setLoading(false);
      setRejectOpen(false);
      setRejectReason('');
    }
  };

  const doAssignDriver = async () => {
    if (!selectedDriverId) return;
    setAssigning(true);
    try {
      await ordersApi.assignDriver(order.id, selectedDriverId);
      onRefresh();
    } finally {
      setAssigning(false);
    }
  };

  const doAssignAdHoc = async () => {
    if (!adHocName.trim() || !adHocPhone.trim()) return;
    setAssigning(true);
    try {
      const newDriver = await driversApi.create({ name: adHocName.trim(), phone: adHocPhone.trim() });
      await ordersApi.assignDriver(order.id, newDriver.id);
      onRefresh();
    } catch {
      // teléfono duplicado u otro error — dejar formulario abierto para corregir
    } finally {
      setAssigning(false);
      setAdHocMode(false);
      setAdHocName('');
      setAdHocPhone('');
    }
  };

  const isDone = TERMINAL.includes(order.status);

  return (
    <div className="card" style={{ borderTop: `3px solid ${borderColor}`, opacity: isDone ? 0.75 : 1 }}>
      {/* Header */}
      <div className="flex justify-between items-center">
        <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>#{orderNum}</span>
        <span style={{
          fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px',
          borderRadius: '999px', background: borderColor + '22', color: borderColor,
        }}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      {/* Cliente */}
      <div className="mt-1">
        <div style={{ fontWeight: 600 }}>{order.customer.name ?? 'Cliente'}</div>
        <div className="text-muted text-xs">{order.customer.phone}</div>
      </div>

      {/* Tipo de entrega */}
      <div className="text-xs mt-1" style={{ color: 'var(--text2)' }}>
        {order.deliveryType === 'DELIVERY' ? '🛵 Delivery' : '🏃 Pickup'}
        {order.deliveryAddress && <span> · {order.deliveryAddress}</span>}
        {order.paymentMethod && (
          <span> · {PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}</span>
        )}
        {order.paymentReference && <span> · Ref: {order.paymentReference}</span>}
      </div>

      {/* Ítems */}
      <div className="mt-1" style={{ borderTop: '1px solid var(--surface2)', paddingTop: '0.5rem' }}>
        {order.items.map((item, i) => (
          <div key={i} className="text-sm flex justify-between">
            <span>{item.quantity}x {item.menuItem.name}</span>
          </div>
        ))}
      </div>

      {/* Total + tiempo */}
      <div className="flex justify-between items-center mt-1">
        <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '1rem' }}>
          Bs {parseFloat(order.totalBs).toFixed(2)}
        </span>
        <span className="text-xs text-muted">hace {timeAgo}m</span>
      </div>

      {/* Acciones */}
      {!isDone && (
        <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>

          {/* Confirmar / Rechazar pago */}
          {order.status === 'PAYMENT_UPLOADED' && (
            <div className="flex gap-1">
              <button className="btn btn-sm btn-success" style={{ flex: 1 }}
                disabled={loading} onClick={() => doAction('PAYMENT_CONFIRMED')}>
                ✅ Confirmar pago
              </button>
              <button className="btn btn-sm btn-danger" style={{ flex: 1 }}
                disabled={loading} onClick={() => setRejectOpen(true)}>
                ❌ Rechazar pago
              </button>
            </div>
          )}

          {/* Efectivo pendiente → enviar a cocina */}
          {order.status === 'PENDING_PAYMENT' && order.paymentMethod === 'CASH_ON_DELIVERY' && (
            <button className="btn btn-sm btn-primary" disabled={loading}
              onClick={() => doAction('IN_KITCHEN')}>
              🍳 Enviar a cocina
            </button>
          )}

          {/* PAYMENT_CONFIRMED: ya está en cocina automáticamente, sin acción manual */}
          {order.status === 'PAYMENT_CONFIRMED' && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text2)', textAlign: 'center', padding: '0.3rem 0' }}>
              🍳 Enviado a cocina automáticamente
            </div>
          )}

          {order.status === 'IN_KITCHEN' && (
            <button className="btn btn-sm btn-success" disabled={loading}
              onClick={() => doAction('READY')}>
              🎉 Marcar como listo
            </button>
          )}

          {order.status === 'AWAITING_DRIVER_ASSIGNMENT' && (
            <div style={{ background: 'var(--surface2)', borderRadius: '8px', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#ec4899' }}>
                🛵 Asignar motorizado
              </div>

              {/* ── Formulario ad-hoc ── */}
              {(adHocMode || drivers.length === 0) ? (
                <>
                  <input
                    placeholder="Nombre del motorizado"
                    value={adHocName}
                    onChange={(e) => setAdHocName(e.target.value)}
                    style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--surface2)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.85rem' }}
                  />
                  <input
                    placeholder="Teléfono (ej: 584121234567)"
                    value={adHocPhone}
                    onChange={(e) => setAdHocPhone(e.target.value)}
                    style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--surface2)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.85rem' }}
                  />
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={assigning || !adHocName.trim() || !adHocPhone.trim()}
                      onClick={() => void doAssignAdHoc()}
                      style={{ flex: 1 }}
                    >
                      {assigning ? 'Asignando...' : '📲 Asignar y notificar'}
                    </button>
                    {drivers.length > 0 && (
                      <button className="btn btn-sm btn-ghost" onClick={() => { setAdHocMode(false); setAdHocName(''); setAdHocPhone(''); }} style={{ fontSize: '0.75rem' }}>
                        Cancelar
                      </button>
                    )}
                  </div>
                </>
              ) : (
                /* ── Dropdown motorizados registrados ── */
                <>
                  <select
                    value={selectedDriverId}
                    onChange={(e) => setSelectedDriverId(e.target.value)}
                    style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px',
                      border: '1px solid var(--surface2)', background: 'var(--surface)',
                      color: 'var(--text)', fontSize: '0.85rem' }}
                  >
                    <option value="">Selecciona un motorizado...</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.name} · {d.phone}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={assigning || !selectedDriverId}
                    onClick={() => void doAssignDriver()}
                  >
                    {assigning ? 'Asignando...' : '📲 Asignar y notificar'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setAdHocMode(true)} style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>
                    ➕ Motorizado nuevo
                  </button>
                </>
              )}
            </div>
          )}

          {order.status === 'READY' && (
            <button className="btn btn-sm btn-success" disabled={loading}
              onClick={() => doAction('DELIVERED')}>
              {order.deliveryType === 'DELIVERY' ? '🛵 Marcar entregado' : '✅ Cliente retiró'}
            </button>
          )}

          {/* Cancelar (disponible en cualquier estado activo) */}
          {!['DELIVERED', 'CANCELLED', 'IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY'].includes(order.status) && (
            <button className="btn btn-sm btn-ghost" disabled={loading}
              style={{ color: 'var(--danger, #ef4444)', fontSize: '0.75rem' }}
              onClick={() => doAction('CANCELLED')}>
              Cancelar pedido
            </button>
          )}
        </div>
      )}

      {/* Panel de rechazo */}
      {rejectOpen && (
        <div style={{ marginTop: '0.5rem', background: 'var(--surface2)', borderRadius: '8px', padding: '0.6rem' }}>
          <div className="text-xs text-muted" style={{ marginBottom: '0.3rem' }}>Motivo del rechazo (opcional):</div>
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Ej: monto incorrecto..."
            style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px',
              border: '1px solid var(--surface2)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.85rem' }}
          />
          <div className="flex gap-1 mt-1">
            <button className="btn btn-sm btn-danger" style={{ flex: 1 }} disabled={loading}
              onClick={() => doAction('PAYMENT_REJECTED', rejectReason || undefined)}>
              Confirmar rechazo
            </button>
            <button className="btn btn-sm btn-ghost" style={{ flex: 1 }}
              onClick={() => { setRejectOpen(false); setRejectReason(''); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
