import { useEffect, useState, useMemo, useRef } from 'react';
import { customersApi, type Customer, type CustomerSortBy } from '../api/api';
import api from '../api/api';

// ─── Emergency panel types & constants ────────────────────────────────────────

interface CustomerSearchResult {
  id: string;
  name: string | null;
  phone: string;
  sessionState: string | null;
  activeOrderId: string | null;
  activeOrderNumber: number | null;
  activeOrderStatus: string | null;
}

const SESSION_LABELS: Record<string, string> = {
  IDLE:                        'Sin sesión',
  MAIN_MENU:                   'Menú principal',
  AWAITING_NAME:               'Esperando nombre',
  BROWSE_CATEGORIES:           'Viendo categorías',
  BROWSE_ITEMS:                'Viendo ítems',
  BUILDING_ORDER:              'Armando pedido',
  ORDER_CONFIRMATION:          'Confirmando pedido',
  AWAITING_DELIVERY_TYPE:      'Tipo de entrega',
  AWAITING_DELIVERY_ADDRESS:   'Ingresando dirección',
  AWAITING_DELIVERY_REFERENCE: 'Ingresando referencia',
  AWAITING_PAYMENT_METHOD:     'Método de pago',
  AWAITING_PAYMENT_PROOF:      'Esperando comprobante',
  PAYMENT_UNDER_REVIEW:        'Pago en revisión',
  ORDER_IN_KITCHEN:            'Pedido en cocina',
  ORDER_READY:                 'Pedido listo',
  AWAITING_HUMAN:              '⚠️ Esperando humano',
  AWAITING_FEEDBACK_RATING:    'Calificando pedido',
  AWAITING_FEEDBACK_COMMENT:   'Dejando comentario',
  ADMIN_MODE:                  'Modo admin',
};

const STATE_COLOR: Record<string, string> = {
  AWAITING_HUMAN:       '#ef4444',
  PAYMENT_UNDER_REVIEW: '#f59e0b',
  ORDER_IN_KITCHEN:     '#f97316',
  BUILDING_ORDER:       '#3b82f6',
  MAIN_MENU:            '#10b981',
  IDLE:                 '#6b7280',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'Hace un momento';
  if (mins < 60)  return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30)  return `Hace ${days} días`;
  const months = Math.floor(days / 30);
  return `Hace ${months} mes${months > 1 ? 'es' : ''}`;
}

function initials(name: string | null, phone: string): string {
  if (!name) return phone.slice(-2);
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

const DAY_LABELS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

function DayChart({ counts }: { counts: number[] }) {
  const max = Math.max(...counts, 1);
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 24 }}>
      {counts.map((c, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div
            style={{
              width: 10,
              height: Math.max(3, Math.round((c / max) * 20)),
              background: c === max && max > 0 ? 'var(--accent)' : 'var(--surface2)',
              borderRadius: 2,
            }}
          />
          <span style={{ fontSize: 8, color: 'var(--text2)' }}>{DAY_LABELS[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Row component ────────────────────────────────────────────────────────────

function CustomerRow({ customer, rank }: { customer: Customer; rank: number }) {
  const [expanded, setExpanded] = useState(false);

  const retentionRate = customer.totalOrders > 0
    ? Math.round((customer.completedOrders / customer.totalOrders) * 100)
    : 0;

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer', transition: 'background 0.15s' }}
        className="customer-row"
      >
        {/* Rank */}
        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: 'var(--text2)', fontWeight: 700 }}>
          {rank}
        </td>

        {/* Avatar + nombre + teléfono */}
        <td style={{ padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 38, height: 38, borderRadius: '50%', background: 'var(--surface2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent)', flexShrink: 0,
            }}>
              {initials(customer.name, customer.phone)}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                {customer.name ?? <span style={{ color: 'var(--text2)', fontStyle: 'italic' }}>Sin nombre</span>}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>{customer.phone}</div>
            </div>
          </div>
        </td>

        {/* Pedidos */}
        <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{customer.totalOrders}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text2)' }}>
            ✅ {customer.completedOrders} · ❌ {customer.cancelledOrders}
          </div>
        </td>

        {/* Gastado */}
        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
          <div style={{ fontWeight: 700, color: 'var(--accent)' }}>
            ${customer.totalSpentUsd.toFixed(2)}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text2)' }}>
            Bs {customer.totalSpentBs.toFixed(2)}
          </div>
        </td>

        {/* Ticket promedio */}
        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
          <div style={{ fontWeight: 600 }}>${customer.avgOrderValueUsd.toFixed(2)}</div>
        </td>

        {/* Favorito */}
        <td style={{ padding: '0.75rem 1rem' }}>
          {customer.favoriteItemName
            ? <span style={{ fontSize: '0.8rem' }}>🍽️ {customer.favoriteItemName}</span>
            : <span style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>—</span>}
        </td>

        {/* Día preferido (mini chart) */}
        <td style={{ padding: '0.75rem 1rem' }}>
          {customer.totalOrders > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <DayChart counts={customer.dayCounts} />
              {customer.favoriteDay && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text2)' }}>
                  Frec. los {customer.favoriteDay}
                </span>
              )}
            </div>
          ) : <span style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>—</span>}
        </td>

        {/* Último pedido */}
        <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--text2)' }}>
          {relativeTime(customer.lastOrderAt)}
        </td>

        {/* Expander icon */}
        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: 'var(--text2)' }}>
          {expanded ? '▲' : '▼'}
        </td>
      </tr>

      {/* Fila expandida */}
      {expanded && (
        <tr style={{ background: 'rgba(255,107,53,0.04)' }}>
          <td colSpan={9} style={{ padding: '0 1rem 1rem 5rem' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '0.75rem',
              padding: '0.75rem',
              background: 'var(--surface2)',
              borderRadius: 8,
            }}>
              <DetailItem label="📍 Dirección guardada" value={customer.savedAddress ?? '—'} />
              <DetailItem label="📅 Primer pedido" value={
                customer.firstOrderAt
                  ? new Date(customer.firstOrderAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
                  : '—'
              } />
              <DetailItem label="🗓️ Último pedido" value={
                customer.lastOrderAt
                  ? new Date(customer.lastOrderAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
                  : '—'
              } />
              <DetailItem label="✅ Tasa de completado" value={`${retentionRate}%`} />
              <DetailItem label="❌ Cancelados" value={String(customer.cancelledOrders)} />
              <DetailItem label="🗓️ Cliente desde" value={
                new Date(customer.createdAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
              } />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text2)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<CustomerSortBy>('totalOrders');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // ── Emergency panel state ──────────────────────────────────────────────────
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [eQuery, setEQuery]               = useState('');
  const [eResults, setEResults]           = useState<CustomerSearchResult[]>([]);
  const [eLoading, setELoading]           = useState(false);
  const [eSearched, setESearched]         = useState(false);
  const [eResetting, setEResetting]       = useState<string | null>(null);
  const [eFeedback, setEFeedback]         = useState<Record<string, { ok: boolean; msg: string }>>({});
  const eInputRef = useRef<HTMLInputElement>(null);

  const handleEmergencySearch = async () => {
    const q = eQuery.trim();
    if (q.length < 3) return;
    setELoading(true);
    setESearched(true);
    try {
      const res = await api.get<CustomerSearchResult[]>('/customers/search', { params: { phone: q } });
      setEResults(res.data);
    } catch {
      setEResults([]);
    } finally {
      setELoading(false);
    }
  };

  const handleEmergencyReset = async (c: CustomerSearchResult) => {
    setEResetting(c.id);
    try {
      const res = await api.post<{ ok: boolean; cancelledOrderNumber: number | null }>(
        `/customers/${c.id}/reset-session`,
      );
      const cancelled = res.data.cancelledOrderNumber
        ? ` (orden #${String(res.data.cancelledOrderNumber).padStart(4, '0')} cancelada)`
        : '';
      setEFeedback((prev) => ({ ...prev, [c.id]: { ok: true, msg: `Sesión reseteada${cancelled}` } }));
      const updated = await api.get<CustomerSearchResult[]>('/customers/search', { params: { phone: eQuery.trim() } });
      setEResults(updated.data);
    } catch {
      setEFeedback((prev) => ({ ...prev, [c.id]: { ok: false, msg: 'Error al resetear' } }));
    } finally {
      setEResetting(null);
    }
  };

  useEffect(() => {
    setLoading(true);
    customersApi.getAll({ sortBy, order: sortOrder })
      .then(setCustomers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sortBy, sortOrder]);

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.phone.includes(q),
    );
  }, [customers, search]);

  // Summary stats
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek  = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const activeThisMonth = customers.filter(
    (c) => c.lastOrderAt && new Date(c.lastOrderAt) >= startOfMonth,
  ).length;
  const newThisWeek = customers.filter(
    (c) => new Date(c.createdAt) >= startOfWeek,
  ).length;
  const avgSpend = customers.length > 0
    ? customers.reduce((s, c) => s + c.avgOrderValueUsd, 0) / customers.filter(c => c.completedOrders > 0).length || 0
    : 0;

  const toggleSort = (field: CustomerSortBy) => {
    if (sortBy === field) setSortOrder(o => o === 'desc' ? 'asc' : 'desc');
    else { setSortBy(field); setSortOrder('desc'); }
  };

  const SortHeader = ({ field, label }: { field: CustomerSortBy; label: string }) => (
    <th
      onClick={() => toggleSort(field)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', padding: '0.75rem 1rem' }}
    >
      {label} {sortBy === field ? (sortOrder === 'desc' ? '↓' : '↑') : <span style={{ color: 'var(--text2)' }}>⇅</span>}
    </th>
  );

  return (
    <div>
      {/* ── Panel de emergencia ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem', padding: '0' }}>
        <button
          onClick={() => setEmergencyOpen((o) => !o)}
          style={{
            width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.75rem 1rem', background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'var(--text)', fontWeight: 700, fontSize: '0.9rem',
          }}
        >
          <span>🔧 Gestión de emergencia</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>{emergencyOpen ? '▲' : '▼'}</span>
        </button>

        {emergencyOpen && (
          <div style={{ padding: '0 1rem 1rem' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
              Busca un cliente por teléfono para ver su estado de sesión y resetearlo si quedó varado.
            </div>

            {/* Buscador */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <input
                ref={eInputRef}
                type="text"
                placeholder="Teléfono (ej: 5841...)"
                value={eQuery}
                onChange={(e) => setEQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleEmergencySearch(); }}
                style={{
                  flex: 1, padding: '0.45rem 0.65rem', borderRadius: '7px',
                  border: '1px solid var(--surface2)', background: 'var(--surface)',
                  color: 'var(--text)', fontSize: '0.88rem',
                }}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={eLoading || eQuery.trim().length < 3}
                onClick={() => void handleEmergencySearch()}
                style={{ minWidth: '72px' }}
              >
                {eLoading ? '…' : '🔍 Buscar'}
              </button>
            </div>

            {/* Sin resultados */}
            {eSearched && !eLoading && eResults.length === 0 && (
              <div className="text-muted" style={{ fontSize: '0.82rem', padding: '0.5rem 0' }}>
                No se encontraron clientes con ese número.
              </div>
            )}

            {/* Resultados */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {eResults.map((c) => {
                const stateLabel = c.sessionState ? (SESSION_LABELS[c.sessionState] ?? c.sessionState) : 'Sin sesión';
                const stateColor = c.sessionState ? (STATE_COLOR[c.sessionState] ?? '#6b7280') : '#6b7280';
                const fb = eFeedback[c.id];
                const isResetting = eResetting === c.id;
                const orderNum = c.activeOrderNumber ? String(c.activeOrderNumber).padStart(4, '0') : null;

                return (
                  <div key={c.id} style={{
                    background: 'var(--surface2)', borderRadius: '8px', padding: '0.75rem',
                    display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                  }}>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: '160px' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.name ?? 'Sin nombre'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>{c.phone}</div>
                      {orderNum && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text2)', marginTop: '0.15rem' }}>
                          Orden activa: <strong>#{orderNum}</strong> · {c.activeOrderStatus}
                        </div>
                      )}
                    </div>

                    {/* Badge estado */}
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px',
                      borderRadius: '999px', background: stateColor + '22', color: stateColor,
                      whiteSpace: 'nowrap',
                    }}>
                      {stateLabel}
                    </span>

                    {/* Feedback + botón */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                      {fb && (
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: fb.ok ? '#10b981' : '#ef4444' }}>
                          {fb.ok ? '✅' : '❌'} {fb.msg}
                        </span>
                      )}
                      <button
                        className="btn btn-sm btn-ghost"
                        disabled={isResetting}
                        onClick={() => void handleEmergencyReset(c)}
                        style={{ fontSize: '0.78rem', color: '#f59e0b', border: '1px solid #f59e0b44' }}
                      >
                        {isResetting ? 'Reseteando...' : '🔄 Resetear sesión'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>👥 Clientes</h2>

      {/* Summary cards */}
      <div className="card-grid" style={{ marginBottom: '1.5rem' }}>
        <SummaryCard emoji="👥" label="Total clientes" value={customers.length} />
        <SummaryCard emoji="📅" label="Activos este mes" value={activeThisMonth} color="var(--success)" />
        <SummaryCard emoji="✨" label="Nuevos esta semana" value={newThisWeek} color="var(--accent)" />
        <SummaryCard emoji="💰" label="Ticket promedio" value={`$${isNaN(avgSpend) ? '0.00' : avgSpend.toFixed(2)}`} color="var(--warning)" />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="🔍 Buscar por nombre o teléfono..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <select
          value={`${sortBy}-${sortOrder}`}
          onChange={(e) => {
            const [field, ord] = e.target.value.split('-') as [CustomerSortBy, 'asc' | 'desc'];
            setSortBy(field); setSortOrder(ord);
          }}
          style={{ width: 'auto' }}
        >
          <option value="totalOrders-desc">Más pedidos</option>
          <option value="totalSpentUsd-desc">Mayor gasto</option>
          <option value="lastOrderAt-desc">Último pedido (reciente)</option>
          <option value="name-asc">Nombre A–Z</option>
          <option value="name-desc">Nombre Z–A</option>
        </select>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text2)' }}>
          Cargando clientes...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text2)' }}>
          <p style={{ fontSize: '2rem' }}>👥</p>
          <p style={{ marginTop: '0.5rem' }}>
            {search ? 'No hay resultados para esa búsqueda.' : 'Aún no hay clientes registrados.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', color: 'var(--text2)', textAlign: 'left', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>#</th>
                  <SortHeader field="name" label="Cliente" />
                  <SortHeader field="totalOrders" label="Pedidos" />
                  <SortHeader field="totalSpentUsd" label="Gastado" />
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Ticket prom.</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Favorito</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Días activos</th>
                  <SortHeader field="lastOrderAt" label="Último pedido" />
                  <th style={{ padding: '0.75rem 0.5rem' }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <CustomerRow key={c.id} customer={c} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', color: 'var(--text2)', borderTop: '1px solid var(--surface2)' }}>
            {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
            {search && ` · filtrando "${search}"`}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ emoji, label, value, color }: {
  emoji: string; label: string; value: number | string; color?: string;
}) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <span style={{ fontSize: '2rem' }}>{emoji}</span>
      <div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>{label}</div>
        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: color ?? 'var(--text)' }}>{value}</div>
      </div>
    </div>
  );
}
