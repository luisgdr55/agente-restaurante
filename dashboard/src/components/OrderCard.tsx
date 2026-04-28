import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import type { Order, Driver } from '../api/api';
import { ordersApi, driversApi } from '../api/api';

const PWA_URL = import.meta.env.VITE_PWA_URL ?? 'https://yebramspedidos.up.railway.app';

// ── Micro-interaction CSS (injected once per app) ─────────────────────────────

const BUTTON_MICRO_STYLES = `
.btn-micro {
  position: relative !important;
  overflow: hidden !important;
  transition: filter 150ms ease, transform 150ms ease, box-shadow 150ms ease !important;
  cursor: pointer;
}
.btn-micro:hover:not(:disabled) {
  filter: brightness(1.15);
  transform: translateY(-1px);
}
.btn-micro:active:not(:disabled) {
  transform: scale(0.95) !important;
  filter: brightness(0.95);
  transition-duration: 60ms !important;
}
.btn-micro:disabled {
  cursor: not-allowed;
  animation: btnLoading 1.8s ease-in-out infinite;
}
@keyframes btnLoading {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}
.btn-micro > .ripple {
  position: absolute;
  border-radius: 50%;
  background: rgba(255,255,255,0.28);
  transform: scale(0);
  animation: rippleExpand 420ms ease-out forwards;
  pointer-events: none;
}
@keyframes rippleExpand {
  to { transform: scale(1); opacity: 0; }
}
.btn-glow-confirm:hover:not(:disabled) { box-shadow: 0 4px 18px rgba(34,197,94,0.5); }
.btn-glow-reject:hover:not(:disabled)  { box-shadow: 0 4px 18px rgba(239,68,68,0.5); }
.btn-glow-delivery:hover:not(:disabled){ box-shadow: 0 4px 18px rgba(99,102,241,0.5); }
`;

function injectButtonStyles() {
  const id = 'btn-micro-styles';
  if (!document.getElementById(id)) {
    const el = document.createElement('style');
    el.id = id;
    el.textContent = BUTTON_MICRO_STYLES;
    document.head.appendChild(el);
  }
}

function addRipple(e: React.MouseEvent<HTMLButtonElement>) {
  if ((e.currentTarget as HTMLButtonElement).disabled) return;
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  const size = Math.ceil(Math.sqrt(rect.width ** 2 + rect.height ** 2) * 2);
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(span);
  setTimeout(() => span.remove(), 430);
}

// ── Data ─────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT:            '⏳ Pend. pago',
  PAYMENT_UPLOADED:           '📤 Comp. subido',
  PAYMENT_CONFIRMED:          '✅ Pago conf.',
  PAYMENT_REJECTED:           '❌ Pago rechazado',
  IN_KITCHEN:                 '🍳 En cocina',
  AWAITING_DRIVER_ASSIGNMENT: '🛵 Asignar motor.',
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
  READY:                      '#22c55e',
  OUT_FOR_DELIVERY:           '#6366f1',
  DELIVERED:                  '#10b981',
  CANCELLED:                  '#6b7280',
};

const PAYMENT_LABELS: Record<string, string> = {
  PAGO_MOVIL:       '📱 Pago Móvil',
  CASH_ON_DELIVERY: '💵 Efectivo',
  POS:              '🏧 Punto de venta',
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
  const [qrOpen, setQrOpen] = useState(false);
  const [sendingOut, setSendingOut] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, string | null> | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);

  useEffect(() => { injectButtonStyles(); }, []);

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

  const openProof = async () => {
    setProofOpen(true);
    setOcrResult(null);
    if (proofUrl) return;
    setProofLoading(true);
    try {
      const data = await ordersApi.getProof(order.id);
      setProofUrl(data.paymentImageUrl);
    } finally {
      setProofLoading(false);
    }
  };

  const runOcr = async () => {
    setOcrLoading(true);
    try {
      const result = await ordersApi.runOcr(order.id);
      setOcrResult(result);
    } finally {
      setOcrLoading(false);
    }
  };

  const doSendOutForDelivery = async () => {
    setSendingOut(true);
    try {
      await ordersApi.setOutForDelivery(order.id);
      setQrOpen(true);
      onRefresh();
    } finally {
      setSendingOut(false);
    }
  };

  const isDone = TERMINAL.includes(order.status);
  const driverQrUrl = `${PWA_URL}/driver/${order.id}`;
  const isReady = order.status === 'READY';

  return (
    <div
      className="card"
      style={{
        padding: '1.5rem',
        border: isReady ? '3px solid #22c55e' : `4px solid ${borderColor}`,
        borderRadius: 14,
        opacity: isDone ? 0.75 : 1,
        animation: isReady ? 'readyPulse 1.6s ease-in-out infinite' : 'none',
      }}
    >
      {isReady && (
        <style>{`
          @keyframes readyPulse {
            0%, 100% { box-shadow: 0 0 0px #22c55e; }
            50%       { box-shadow: 0 0 24px #22c55e; }
          }
        `}</style>
      )}

      {/* READY Banner */}
      {isReady && (
        <div style={{
          background: 'rgba(34,197,94,0.15)',
          border: '1px solid rgba(34,197,94,0.5)',
          borderRadius: 10,
          padding: '0.65rem 1rem',
          marginBottom: '1rem',
          textAlign: 'center',
          fontWeight: 800,
          fontSize: '1rem',
          color: '#22c55e',
          letterSpacing: '0.08em',
        }}>
          ✅ LISTO PARA ENTREGAR
        </div>
      )}

      {/* Header: order number + status badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
        <span style={{ fontWeight: 900, fontSize: '1.4rem', letterSpacing: '-0.5px' }}>
          #{orderNum}
        </span>
        <span style={{
          fontSize: '0.82rem', fontWeight: 700,
          padding: '0.35rem 0.85rem',
          borderRadius: '999px',
          background: borderColor + '22',
          color: borderColor,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
        }}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      {/* Customer */}
      <div style={{ marginBottom: '0.85rem' }}>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.25 }}>
          {order.customer.name ?? 'Cliente'}
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
          {order.customer.phone}
        </div>
      </div>

      {/* Delivery + payment chips */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0.3rem 0.7rem', borderRadius: 8, background: 'var(--surface2)', color: 'var(--text2)' }}>
          {order.deliveryType === 'DELIVERY' ? '🛵 Delivery' : '🏃 Pickup'}
        </span>
        {order.paymentMethod && (
          <span style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0.3rem 0.7rem', borderRadius: 8, background: 'var(--surface2)', color: 'var(--text2)' }}>
            {PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}
          </span>
        )}
        {order.deliveryAddress && (
          <span style={{ fontSize: '0.78rem', fontWeight: 500, padding: '0.3rem 0.7rem', borderRadius: 8, background: 'var(--surface2)', color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
            📍 {order.deliveryAddress}
          </span>
        )}
      </div>

      {/* Proof / reference inline */}
      {order.hasPaymentImage && (
        <div style={{ marginBottom: '0.85rem' }}>
          <button
            className="btn btn-sm btn-ghost btn-micro"
            style={{ fontSize: '0.8rem', color: '#3b82f6', width: '100%', border: '1px solid #3b82f633', borderRadius: 8, padding: '0.45rem' }}
            onMouseDown={addRipple}
            onClick={() => void openProof()}
          >
            Ver comprobante 🧾
          </button>
        </div>
      )}
      {!order.hasPaymentImage && order.paymentReference && (
        <div style={{ marginBottom: '0.85rem', fontSize: '0.82rem', color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '0.45rem 0.75rem' }}>
          📋 Ref: <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.92rem' }}>
            {order.paymentReference}
          </span>
        </div>
      )}

      {/* Items */}
      <div style={{ borderTop: '1px solid var(--surface2)', borderBottom: '1px solid var(--surface2)', padding: '0.75rem 0', marginBottom: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {order.items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ minWidth: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', color: '#000', fontWeight: 800, fontSize: '0.88rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {item.quantity}
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>{item.menuItem.name}</span>
          </div>
        ))}
      </div>

      {/* Total + time */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: isDone ? 0 : '1rem' }}>
        <div>
          <div style={{ fontWeight: 800, color: 'var(--accent)', fontSize: '1.3rem', lineHeight: 1 }}>
            ${parseFloat(order.totalUsd).toFixed(2)}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
            Bs {parseFloat(order.totalBs).toFixed(2)}
          </div>
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>hace {timeAgo}m</span>
      </div>

      {/* Action buttons */}
      {!isDone && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

          {/* Confirm / Reject payment */}
          {(order.status === 'PAYMENT_UPLOADED' ||
            (order.status === 'PENDING_PAYMENT' && order.paymentMethod === 'PAGO_MOVIL' && order.paymentReference)) && (
            <div className="flex gap-1">
              <button className="btn btn-sm btn-success btn-micro btn-glow-confirm"
                style={{ flex: 1, minHeight: 48, fontSize: '1rem' }}
                disabled={loading}
                onMouseDown={addRipple}
                onClick={() => doAction('PAYMENT_CONFIRMED')}>
                ✅ Confirmar pago
              </button>
              <button className="btn btn-sm btn-danger btn-micro btn-glow-reject"
                style={{ flex: 1, minHeight: 48, fontSize: '1rem' }}
                disabled={loading}
                onMouseDown={addRipple}
                onClick={() => setRejectOpen(true)}>
                ❌ Rechazar
              </button>
            </div>
          )}

          {/* Cash/POS → kitchen */}
          {order.status === 'PENDING_PAYMENT' && (order.paymentMethod === 'CASH_ON_DELIVERY' || order.paymentMethod === 'POS') && (
            <button className="btn btn-sm btn-primary btn-micro"
              style={{ minHeight: 48, fontSize: '1rem' }}
              disabled={loading}
              onMouseDown={addRipple}
              onClick={() => doAction('IN_KITCHEN')}>
              🍳 Enviar a cocina
            </button>
          )}

          {/* Payment confirmed — auto in kitchen */}
          {order.status === 'PAYMENT_CONFIRMED' && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text2)', textAlign: 'center', padding: '0.4rem 0' }}>
              🍳 Enviado a cocina automáticamente
            </div>
          )}

          {order.status === 'IN_KITCHEN' && (
            <button className="btn btn-sm btn-success btn-micro btn-glow-confirm"
              style={{ minHeight: 48, fontSize: '1rem' }}
              disabled={loading}
              onMouseDown={addRipple}
              onClick={() => doAction('READY')}>
              🎉 Marcar como listo
            </button>
          )}

          {/* Assign driver panel */}
          {order.status === 'AWAITING_DRIVER_ASSIGNMENT' && (
            <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ec4899' }}>
                🛵 Asignar motorizado
              </div>

              {(adHocMode || drivers.length === 0) ? (
                <>
                  <input
                    placeholder="Nombre del motorizado"
                    value={adHocName}
                    onChange={(e) => setAdHocName(e.target.value)}
                    style={{ padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid var(--surface2)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.9rem' }}
                  />
                  <input
                    placeholder="Teléfono (ej: 584121234567)"
                    value={adHocPhone}
                    onChange={(e) => setAdHocPhone(e.target.value)}
                    style={{ padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid var(--surface2)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.9rem' }}
                  />
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      className="btn btn-sm btn-primary btn-micro"
                      style={{ flex: 1, minHeight: 44 }}
                      disabled={assigning || !adHocName.trim() || !adHocPhone.trim()}
                      onMouseDown={addRipple}
                      onClick={() => void doAssignAdHoc()}
                    >
                      {assigning ? 'Asignando...' : '📲 Asignar y notificar'}
                    </button>
                    {drivers.length > 0 && (
                      <button className="btn btn-sm btn-ghost btn-micro"
                        style={{ fontSize: '0.78rem' }}
                        onMouseDown={addRipple}
                        onClick={() => { setAdHocMode(false); setAdHocName(''); setAdHocPhone(''); }}>
                        Cancelar
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <select
                    value={selectedDriverId}
                    onChange={(e) => setSelectedDriverId(e.target.value)}
                    style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid var(--surface2)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.9rem' }}
                  >
                    <option value="">Selecciona un motorizado...</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.name} · {d.phone}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-sm btn-primary btn-micro"
                    style={{ minHeight: 44 }}
                    disabled={assigning || !selectedDriverId}
                    onMouseDown={addRipple}
                    onClick={() => void doAssignDriver()}
                  >
                    {assigning ? 'Asignando...' : '📲 Asignar y notificar'}
                  </button>
                  <button className="btn btn-sm btn-ghost btn-micro"
                    style={{ fontSize: '0.78rem', color: 'var(--text2)' }}
                    onMouseDown={addRipple}
                    onClick={() => setAdHocMode(true)}>
                    ➕ Motorizado nuevo
                  </button>
                </>
              )}
            </div>
          )}

          {/* READY actions — green buttons */}
          {order.status === 'READY' && order.deliveryType === 'DELIVERY' && (
            <button
              className="btn btn-sm btn-micro btn-glow-delivery"
              style={{ minHeight: 48, fontSize: '1rem', background: '#22c55e', color: '#fff', fontWeight: 700 }}
              disabled={sendingOut}
              onMouseDown={addRipple}
              onClick={() => void doSendOutForDelivery()}
            >
              {sendingOut ? 'Procesando...' : '🛵 Salió a domicilio'}
            </button>
          )}

          {order.status === 'READY' && order.deliveryType !== 'DELIVERY' && (
            <button
              className="btn btn-sm btn-micro btn-glow-confirm"
              style={{ minHeight: 48, fontSize: '1rem', background: '#22c55e', color: '#fff', fontWeight: 700 }}
              disabled={loading}
              onMouseDown={addRipple}
              onClick={() => doAction('DELIVERED')}
            >
              ✅ Cliente retiró
            </button>
          )}

          {order.status === 'OUT_FOR_DELIVERY' && (
            <button className="btn btn-sm btn-ghost btn-micro"
              style={{ fontSize: '0.82rem', minHeight: 40 }}
              onMouseDown={addRipple}
              onClick={() => setQrOpen(true)}>
              📱 Ver QR motorizado
            </button>
          )}

          {/* Cancel */}
          {!['DELIVERED', 'CANCELLED', 'IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY'].includes(order.status) && (
            <button className="btn btn-sm btn-ghost btn-micro"
              style={{ color: 'var(--danger, #ef4444)', fontSize: '0.82rem', minHeight: 40 }}
              disabled={loading}
              onMouseDown={addRipple}
              onClick={() => doAction('CANCELLED')}>
              Cancelar pedido
            </button>
          )}
        </div>
      )}

      {/* QR Modal Portal */}
      {qrOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setQrOpen(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '1.5rem', maxWidth: 320, width: '100%', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '0.25rem' }}>📱 QR Motorizado</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginBottom: '1rem' }}>
              Pedido #{orderNum} · {order.customer.name ?? order.customer.phone}
            </div>
            <div style={{ background: '#fff', padding: '1rem', borderRadius: 12, display: 'inline-block', marginBottom: '1rem' }}>
              <QRCodeSVG value={driverQrUrl} size={200} />
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text2)', marginBottom: '1rem', wordBreak: 'break-all' }}>
              {driverQrUrl}
            </div>
            <button className="btn btn-sm btn-ghost btn-micro" style={{ width: '100%' }}
              onMouseDown={addRipple}
              onClick={() => setQrOpen(false)}>
              Cerrar
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Proof Modal Portal */}
      {proofOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', overflowY: 'auto' }}
          onClick={() => setProofOpen(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '1.25rem', maxWidth: 420, width: '100%' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '0.75rem' }}>🧾 Comprobante — #{orderNum}</div>

            {proofLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text2)' }}>Cargando...</div>
            ) : proofUrl ? (
              <>
                <img src={proofUrl} alt="Comprobante"
                  style={{ width: '100%', borderRadius: 10, marginBottom: '0.75rem', display: 'block' }} />
                <button className="btn btn-sm btn-primary btn-micro"
                  style={{ width: '100%', marginBottom: '0.5rem' }}
                  disabled={ocrLoading}
                  onMouseDown={addRipple}
                  onClick={() => void runOcr()}>
                  {ocrLoading ? 'Extrayendo...' : '🔍 Extraer datos OCR'}
                </button>
                {ocrResult && (
                  <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '0.75rem', marginBottom: '0.5rem', fontSize: '0.82rem' }}>
                    {[
                      ['Referencia', ocrResult.referencia],
                      ['Fecha', ocrResult.fecha],
                      ['Hora', ocrResult.hora],
                      ['Monto', ocrResult.monto],
                      ['Banco origen', ocrResult.bancoOrigen],
                      ['Banco destino', ocrResult.bancoDestino],
                      ['Titular', ocrResult.titular],
                    ].map(([label, val]) => val ? (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ color: 'var(--text2)' }}>{label}</span>
                        <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{val}</span>
                      </div>
                    ) : null)}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text2)' }}>Sin imagen</div>
            )}

            <button className="btn btn-sm btn-ghost btn-micro" style={{ width: '100%' }}
              onMouseDown={addRipple}
              onClick={() => setProofOpen(false)}>
              Cerrar
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Reject panel */}
      {rejectOpen && (
        <div style={{ marginTop: '0.75rem', background: 'var(--surface2)', borderRadius: 10, padding: '0.75rem' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Motivo del rechazo (opcional):</div>
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Ej: monto incorrecto..."
            style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid var(--surface2)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.9rem' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button className="btn btn-sm btn-danger btn-micro btn-glow-reject"
              style={{ flex: 1, minHeight: 44 }}
              disabled={loading}
              onMouseDown={addRipple}
              onClick={() => doAction('PAYMENT_REJECTED', rejectReason || undefined)}>
              Confirmar rechazo
            </button>
            <button className="btn btn-sm btn-ghost btn-micro"
              style={{ flex: 1, minHeight: 44 }}
              onMouseDown={addRipple}
              onClick={() => { setRejectOpen(false); setRejectReason(''); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
