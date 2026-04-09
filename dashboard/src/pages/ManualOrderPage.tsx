import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { menuApi, manualOrderApi, type MenuItemFlat } from '../api/api';

interface CartLine { item: MenuItemFlat; qty: number; }

interface FormState {
  step: 1 | 2 | 3 | 4 | 5;
  // Paso 1
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerResolved: boolean;
  // Paso 2
  cart: CartLine[];
  // Paso 3
  deliveryType: 'DELIVERY' | 'PICKUP';
  deliveryAddress: string;
  // Paso 4
  paymentMethod: 'EFECTIVO' | 'PAGO_MOVIL';
  paymentReference: string;
  notifyCustomer: boolean;
}

const INIT: FormState = {
  step: 1,
  customerId: '', customerName: '', customerPhone: '', customerResolved: false,
  cart: [],
  deliveryType: 'PICKUP', deliveryAddress: '',
  paymentMethod: 'EFECTIVO', paymentReference: '',
  notifyCustomer: true,
};

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.startsWith('04') && digits.length === 11
    ? '58' + digits.slice(1)
    : digits;
}

export default function ManualOrderPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(INIT);
  const [items, setItems] = useState<MenuItemFlat[]>([]);
  const [search, setSearch] = useState('');
  const [phoneSearch, setPhoneSearch] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    menuApi.getItemsFlat().then(setItems).catch(() => {});
  }, []);

  const usd = form.cart.reduce((s, l) => s + l.qty * l.item.priceUsd, 0);
  const bs  = form.cart.reduce((s, l) => s + l.qty * l.item.priceBs,  0);

  const filtered = search.length >= 2
    ? items.filter(i =>
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        i.categoryName.toLowerCase().includes(search.toLowerCase()))
    : [];

  function addToCart(item: MenuItemFlat) {
    setForm(f => {
      const existing = f.cart.find(l => l.item.id === item.id);
      if (existing) {
        return { ...f, cart: f.cart.map(l => l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l) };
      }
      return { ...f, cart: [...f.cart, { item, qty: 1 }] };
    });
    setSearch('');
    searchRef.current?.focus();
  }

  function setQty(itemId: string, qty: number) {
    if (qty <= 0) {
      setForm(f => ({ ...f, cart: f.cart.filter(l => l.item.id !== itemId) }));
    } else {
      setForm(f => ({ ...f, cart: f.cart.map(l => l.item.id === itemId ? { ...l, qty } : l) }));
    }
  }

  async function lookupPhone() {
    if (!phoneSearch.trim()) return;
    setPhoneLoading(true);
    const phone = normalizePhone(phoneSearch);
    try {
      const res = await api.get<{ id: string; name: string | null; phone: string }[]>(
        '/customers/search', { params: { phone: phoneSearch } }
      );
      if (res.data.length > 0) {
        const c = res.data[0];
        setForm(f => ({ ...f, customerId: c.id, customerName: c.name ?? '', customerPhone: c.phone, customerResolved: true }));
      } else {
        setForm(f => ({ ...f, customerId: '', customerPhone: phone, customerResolved: false }));
      }
    } catch { /* ignore */ } finally {
      setPhoneLoading(false);
    }
  }

  async function submit() {
    setError('');
    setSubmitting(true);
    try {
      await manualOrderApi.create({
        ...(form.customerId
          ? { customerId: form.customerId }
          : { customerName: form.customerName || 'Cliente', customerPhone: form.customerPhone }),
        items: form.cart.map(l => ({ menuItemId: l.item.id, quantity: l.qty })),
        deliveryType: form.deliveryType,
        ...(form.deliveryType === 'DELIVERY' && form.deliveryAddress ? { deliveryAddress: form.deliveryAddress } : {}),
        paymentMethod: form.paymentMethod,
        ...(form.paymentReference ? { paymentReference: form.paymentReference } : {}),
        notifyCustomer: form.notifyCustomer,
      });
      navigate('/');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Error al registrar el pedido');
    } finally {
      setSubmitting(false);
    }
  }

  const canNext1 = form.customerPhone.length >= 7;
  const canNext2 = form.cart.length > 0;
  const canNext3 = form.deliveryType === 'PICKUP' || form.deliveryAddress.length >= 5;

  return (
    <div className="page-container" style={{ maxWidth: 600, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Volver</button>
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>➕ Pedido manual</h1>
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {[1, 2, 3, 4, 5].map(s => (
          <div key={s} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: form.step >= s ? 'var(--accent)' : 'var(--surface2)',
          }} />
        ))}
      </div>

      {/* PASO 1 — Cliente */}
      {form.step === 1 && (
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Paso 1 — Cliente</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              className="input"
              placeholder="Buscar por teléfono (ej. 04165434760)"
              value={phoneSearch}
              onChange={e => setPhoneSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookupPhone()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-sm" onClick={lookupPhone} disabled={phoneLoading}>
              {phoneLoading ? '…' : '🔍'}
            </button>
          </div>
          {form.customerResolved && (
            <div style={{ padding: '0.5rem 0.75rem', background: 'var(--surface2)', borderRadius: 6,
                          fontSize: '0.85rem', color: 'var(--success)' }}>
              ✅ Cliente encontrado: <strong>{form.customerName || 'Sin nombre'}</strong> — {form.customerPhone}
            </div>
          )}
          {!form.customerResolved && form.customerPhone && (
            <>
              <input
                className="input"
                placeholder="Nombre del cliente (opcional)"
                value={form.customerName}
                onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
              />
              <div style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>
                Se creará un cliente nuevo con el teléfono: <strong>{form.customerPhone}</strong>
              </div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn" disabled={!canNext1}
              onClick={() => setForm(f => ({ ...f, step: 2 }))}>
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {/* PASO 2 — Productos */}
      {form.step === 2 && (
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Paso 2 — Productos</h2>
          <div style={{ position: 'relative' }}>
            <input
              ref={searchRef}
              className="input"
              placeholder="Buscar ítem del menú..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            {filtered.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                            background: 'var(--surface)', border: '1px solid var(--surface2)',
                            borderRadius: 6, maxHeight: 240, overflowY: 'auto' }}>
                {filtered.slice(0, 12).map(item => (
                  <div key={item.id}
                    onClick={() => addToCart(item)}
                    style={{ padding: '0.6rem 0.75rem', cursor: 'pointer', display: 'flex',
                             justifyContent: 'space-between', alignItems: 'center',
                             borderBottom: '1px solid var(--surface2)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{item.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>{item.categoryName}</div>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                      ${item.priceUsd.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {form.cart.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {form.cart.map(line => (
                <div key={line.item.id} style={{ display: 'flex', alignItems: 'center',
                     gap: '0.5rem', padding: '0.5rem 0.75rem',
                     background: 'var(--surface2)', borderRadius: 6 }}>
                  <div style={{ flex: 1, fontSize: '0.9rem' }}>{line.item.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '0 0.5rem' }}
                      onClick={() => setQty(line.item.id, line.qty - 1)}>−</button>
                    <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{line.qty}</span>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '0 0.5rem' }}
                      onClick={() => setQty(line.item.id, line.qty + 1)}>+</button>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--accent)', minWidth: 60, textAlign: 'right' }}>
                    ${(line.qty * line.item.priceUsd).toFixed(2)}
                  </div>
                </div>
              ))}
              <div style={{ padding: '0.5rem 0.75rem', display: 'flex', justifyContent: 'space-between',
                            fontWeight: 700, borderTop: '1px solid var(--surface2)', marginTop: '0.25rem' }}>
                <span>Total</span>
                <span style={{ color: 'var(--accent)' }}>${usd.toFixed(2)} | Bs {bs.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text2)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
              Busca y agrega ítems arriba
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" onClick={() => setForm(f => ({ ...f, step: 1 }))}>← Atrás</button>
            <button className="btn" disabled={!canNext2}
              onClick={() => setForm(f => ({ ...f, step: 3 }))}>Siguiente →</button>
          </div>
        </div>
      )}

      {/* PASO 3 — Entrega */}
      {form.step === 3 && (
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Paso 3 — Entrega</h2>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {(['PICKUP', 'DELIVERY'] as const).map(dt => (
              <button key={dt}
                className={`btn ${form.deliveryType === dt ? '' : 'btn-ghost'}`}
                style={{ flex: 1 }}
                onClick={() => setForm(f => ({ ...f, deliveryType: dt }))}>
                {dt === 'PICKUP' ? '🏪 Retiro en local' : '🛵 Delivery'}
              </button>
            ))}
          </div>
          {form.deliveryType === 'DELIVERY' && (
            <input
              className="input"
              placeholder="Dirección de entrega"
              value={form.deliveryAddress}
              onChange={e => setForm(f => ({ ...f, deliveryAddress: e.target.value }))}
              autoFocus
            />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" onClick={() => setForm(f => ({ ...f, step: 2 }))}>← Atrás</button>
            <button className="btn" disabled={!canNext3}
              onClick={() => setForm(f => ({ ...f, step: 4 }))}>Siguiente →</button>
          </div>
        </div>
      )}

      {/* PASO 4 — Pago */}
      {form.step === 4 && (
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Paso 4 — Pago</h2>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {(['EFECTIVO', 'PAGO_MOVIL'] as const).map(pm => (
              <button key={pm}
                className={`btn ${form.paymentMethod === pm ? '' : 'btn-ghost'}`}
                style={{ flex: 1 }}
                onClick={() => setForm(f => ({ ...f, paymentMethod: pm }))}>
                {pm === 'EFECTIVO' ? '💵 Efectivo' : '📱 Pago Móvil'}
              </button>
            ))}
          </div>
          {form.paymentMethod === 'EFECTIVO' && (
            <div style={{ padding: '0.5rem 0.75rem', background: 'var(--surface2)', borderRadius: 6,
                          fontSize: '0.85rem', color: 'var(--success)' }}>
              ✅ El pedido pasará directamente a cocina (pago confirmado)
            </div>
          )}
          {form.paymentMethod === 'PAGO_MOVIL' && (
            <>
              <input
                className="input"
                placeholder="Referencia de pago (opcional)"
                value={form.paymentReference}
                onChange={e => setForm(f => ({ ...f, paymentReference: e.target.value }))}
              />
              <div style={{ padding: '0.5rem 0.75rem', background: 'var(--surface2)', borderRadius: 6,
                            fontSize: '0.85rem', color: 'var(--text2)' }}>
                ⏳ El pedido quedará pendiente de verificación de pago
              </div>
            </>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                          fontSize: '0.9rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.notifyCustomer}
              onChange={e => setForm(f => ({ ...f, notifyCustomer: e.target.checked }))} />
            Notificar al cliente por WhatsApp
          </label>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" onClick={() => setForm(f => ({ ...f, step: 3 }))}>← Atrás</button>
            <button className="btn" onClick={() => setForm(f => ({ ...f, step: 5 }))}>Revisar →</button>
          </div>
        </div>
      )}

      {/* PASO 5 — Confirmar */}
      {form.step === 5 && (
        <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Paso 5 — Confirmar pedido</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
            <div><strong>Cliente:</strong> {form.customerName || 'Sin nombre'} — {form.customerPhone}</div>
            <div><strong>Entrega:</strong> {form.deliveryType === 'PICKUP'
              ? '🏪 Retiro en local'
              : `🛵 Delivery → ${form.deliveryAddress}`}</div>
            <div><strong>Pago:</strong> {form.paymentMethod === 'EFECTIVO'
              ? '💵 Efectivo (pasa directo a cocina)'
              : `📱 Pago Móvil${form.paymentReference ? ` — Ref: ${form.paymentReference}` : ''}`}</div>
            <div><strong>WhatsApp:</strong> {form.notifyCustomer ? '✅ Notificar' : '❌ No notificar'}</div>
          </div>

          <div style={{ borderTop: '1px solid var(--surface2)', paddingTop: '0.75rem',
                        display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {form.cart.map(line => (
              <div key={line.item.id}
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                <span>{line.qty}x {line.item.name}</span>
                <span style={{ color: 'var(--accent)' }}>${(line.qty * line.item.priceUsd).toFixed(2)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700,
                          borderTop: '1px solid var(--surface2)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
              <span>Total</span>
              <span style={{ color: 'var(--accent)' }}>${usd.toFixed(2)} | Bs {bs.toFixed(2)}</span>
            </div>
          </div>

          {error && (
            <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(220,38,38,0.1)',
                          color: 'var(--error)', borderRadius: 6, fontSize: '0.85rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" onClick={() => setForm(f => ({ ...f, step: 4 }))}>← Atrás</button>
            <button className="btn" disabled={submitting} onClick={submit}>
              {submitting ? 'Registrando…' : '✅ Registrar pedido'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
