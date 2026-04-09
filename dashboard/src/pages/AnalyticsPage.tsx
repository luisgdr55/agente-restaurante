import { useEffect, useState, useCallback } from 'react';
import { analyticsApi, type AnalyticsPeriod, type ProductStat, type CustomerStat } from '../api/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'week',  label: '7 días' },
  { key: 'month', label: '30 días' },
  { key: 'year',  label: 'Este año' },
  { key: 'all',   label: 'Histórico' },
];

const MEDALS = ['🥇', '🥈', '🥉'];
const MEDAL_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];

function medal(i: number) {
  return MEDALS[i] ?? null;
}
function medalColor(i: number): string {
  return MEDAL_COLORS[i] ?? 'var(--text2)';
}

function fmtBs(n: number)  { return `Bs ${n.toFixed(2)}`; }
function fmtUsd(n: number) { return `$${n.toFixed(2)}`; }
function displayName(name: string | null, phone: string) {
  return name ?? phone;
}

// ─── Componente barra proporcional ────────────────────────────────────────────

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ flex: 1, background: 'var(--surface2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
    </div>
  );
}

// ─── Card cliente del mes ─────────────────────────────────────────────────────

function TopCustomerCard({ customer, period }: { customer: CustomerStat; period: AnalyticsPeriod }) {
  const label = period === 'today' ? 'del día' : period === 'week' ? 'de la semana' : period === 'month' ? 'del mes' : period === 'year' ? 'del año' : 'histórico';
  return (
    <div className="card" style={{ marginBottom: '1.5rem', background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface2) 100%)', border: '1px solid var(--accent)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -10, right: -10, fontSize: '5rem', opacity: 0.06, pointerEvents: 'none' }}>👑</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ fontSize: '2.5rem' }}>👑</div>
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Cliente {label}
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>
            {displayName(customer.name, customer.phone)}
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.4rem', fontSize: '0.82rem', color: 'var(--text2)' }}>
            <span>🛒 <strong style={{ color: 'var(--text)' }}>{customer.orders}</strong> pedidos</span>
            <span>💰 <strong style={{ color: 'var(--success)' }}>{fmtBs(customer.totalSpentBs)}</strong></span>
            <span>💵 <strong style={{ color: 'var(--accent)' }}>{fmtUsd(customer.totalSpentUsd)}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sección top productos ────────────────────────────────────────────────────

function ProductsSection({ items, loading }: { items: ProductStat[]; loading: boolean }) {
  const maxUnits = items[0]?.units ?? 1;

  return (
    <div className="card" style={{ flex: 1, minWidth: 0 }}>
      <h3 style={{ marginBottom: '1rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        🍽️ Top Productos
        <span style={{ fontSize: '0.72rem', color: 'var(--text2)', fontWeight: 400 }}>por unidades vendidas</span>
      </h3>

      {loading ? (
        <div style={{ color: 'var(--text2)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>Cargando...</div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--text2)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>Sin datos en este período</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((item, i) => (
            <div key={item.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                <span style={{ fontSize: '1rem', minWidth: 28, textAlign: 'center', color: medalColor(i), fontWeight: 700 }}>
                  {medal(i) ?? <span style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>#{i + 1}</span>}
                </span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </span>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                  {item.units} u.
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ minWidth: 28 }} />
                <Bar value={item.units} max={maxUnits} color={i === 0 ? 'var(--accent)' : i === 1 ? 'var(--success)' : 'var(--text2)'} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  {fmtBs(item.revenueBs)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sección top clientes ─────────────────────────────────────────────────────

function CustomersSection({ items, loading }: { items: CustomerStat[]; loading: boolean }) {
  const maxOrders = items[0]?.orders ?? 1;

  return (
    <div className="card" style={{ flex: 1, minWidth: 0 }}>
      <h3 style={{ marginBottom: '1rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        🏆 Top Clientes
        <span style={{ fontSize: '0.72rem', color: 'var(--text2)', fontWeight: 400 }}>por pedidos entregados</span>
      </h3>

      {loading ? (
        <div style={{ color: 'var(--text2)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>Cargando...</div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--text2)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>Sin datos en este período</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map((customer, i) => (
            <div key={customer.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                <span style={{ fontSize: '1rem', minWidth: 28, textAlign: 'center', color: medalColor(i), fontWeight: 700 }}>
                  {medal(i) ?? <span style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>#{i + 1}</span>}
                </span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName(customer.name, customer.phone)}
                </span>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                  {customer.orders} 🛒
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ minWidth: 28 }} />
                <Bar value={customer.orders} max={maxOrders} color={i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--text2)'} />
                <span style={{ fontSize: '0.75rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  {fmtUsd(customer.totalSpentUsd)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const [products, setProducts]     = useState<ProductStat[]>([]);
  const [customers, setCustomers]   = useState<CustomerStat[]>([]);
  const [loadingP, setLoadingP]     = useState(true);
  const [loadingC, setLoadingC]     = useState(true);

  const load = useCallback(async (p: AnalyticsPeriod) => {
    setLoadingP(true);
    setLoadingC(true);
    const [prods, custs] = await Promise.all([
      analyticsApi.getProducts(p).catch(() => []),
      analyticsApi.getCustomers(p).catch(() => []),
    ]);
    setProducts(prods);
    setCustomers(custs);
    setLoadingP(false);
    setLoadingC(false);
  }, []);

  useEffect(() => { void load(period); }, [period, load]);

  const topCustomer = customers[0] ?? null;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.25rem' }}>📈 Análisis de rendimiento</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => void load(period)}>↻ Actualizar</button>
      </div>

      {/* Selector de período */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {PERIODS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className="btn btn-sm"
            style={{
              background: period === key ? 'var(--accent)' : 'var(--surface2)',
              color: period === key ? '#fff' : 'var(--text2)',
              border: 'none',
              fontWeight: period === key ? 700 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Cliente destacado */}
      {topCustomer && !loadingC && (
        <TopCustomerCard customer={topCustomer} period={period} />
      )}

      {/* Rankings en dos columnas */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <ProductsSection  items={products}  loading={loadingP} />
        <CustomersSection items={customers} loading={loadingC} />
      </div>
    </div>
  );
}
