import { useEffect, useCallback, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { financialsApi } from '../api/api';
import type { FinancialSummary, ChartPoint, FinancialPeriod } from '../api/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtBs  = (n: number) => `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

function TrendBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const up    = value >= 0;
  const color = up ? 'var(--success)' : 'var(--error)';
  return (
    <span style={{ fontSize: '0.75rem', color, fontWeight: 600, marginLeft: '0.4rem' }}>
      {up ? '▲' : '▼'} {up ? '+' : ''}{value}%
    </span>
  );
}

function KpiCard({
  label, valueBs, valueUsd, trend, highlight = false,
}: {
  label: string; valueBs: number; valueUsd: number; trend?: number | null; highlight?: boolean;
}) {
  return (
    <div className="card" style={{
      padding: '1.1rem 1.25rem',
      borderLeft: highlight ? '3px solid var(--accent)' : undefined,
    }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text2)', marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1 }}>
        {fmtBs(valueBs)}
        {trend !== undefined && <TrendBadge value={trend ?? null} />}
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginTop: '0.15rem' }}>
        ~{fmtUsd(valueUsd)}
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="card" style={{ padding: '1rem 1.25rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text2)', marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginTop: '0.15rem' }}>{sub}</div>}
    </div>
  );
}

function SplitBar({
  label, items,
}: {
  label: string;
  items: { name: string; value: number; count: number; color: string }[];
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="card" style={{ padding: '1.1rem 1.25rem' }}>
      <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.9rem' }}>{label}</div>
      {items.map((item) => {
        const pct = total > 0 ? (item.value / total) * 100 : 0;
        return (
          <div key={item.name} style={{ marginBottom: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.2rem' }}>
              <span>{item.name} <span style={{ color: 'var(--text2)', fontSize: '0.75rem' }}>({item.count} ped.)</span></span>
              <span style={{ fontWeight: 600 }}>{fmtBs(item.value)}</span>
            </div>
            <div style={{ background: 'var(--surface2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: item.color, borderRadius: 4, transition: 'width 0.5s' }} />
            </div>
          </div>
        );
      })}
      {total === 0 && (
        <div style={{ color: 'var(--text2)', fontSize: '0.82rem' }}>Sin datos en este período.</div>
      )}
    </div>
  );
}

// ── Period config ─────────────────────────────────────────────────────────────

const PERIODS: { key: FinancialPeriod; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'week',  label: '7 días' },
  { key: 'month', label: '30 días' },
  { key: 'year',  label: '12 meses' },
];

// ── Custom tooltip for chart ──────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--surface2)',
      padding: '0.6rem 0.9rem', borderRadius: 8, fontSize: '0.82rem',
    }}>
      <div style={{ color: 'var(--text2)', marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{fmtBs(payload[0]?.value ?? 0)}</div>
      {payload[1] && (
        <div style={{ color: 'var(--text2)' }}>{payload[1].value} pedidos</div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [period, setPeriod]       = useState<FinancialPeriod>('month');
  const [summary, setSummary]     = useState<FinancialSummary | null>(null);
  const [chart, setChart]         = useState<ChartPoint[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async (p: FinancialPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const [s, c] = await Promise.all([
        financialsApi.getSummary(p),
        financialsApi.getChart(p),
      ]);
      setSummary(s);
      setChart(c);
    } catch {
      setError('No se pudo cargar la información financiera.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(period); }, [period, load]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ fontSize: '1.25rem' }}>💰 Finanzas del Negocio</h2>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className="btn btn-sm"
              style={{
                background: period === key ? 'var(--accent)' : 'var(--surface2)',
                color: period === key ? '#fff' : 'var(--text)',
                fontWeight: period === key ? 700 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text2)' }}>
          Cargando datos financieros...
        </div>
      )}

      {error && (
        <div className="card" style={{ padding: '1.5rem', color: 'var(--error)', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {!loading && summary && (
        <>
          {/* ── KPIs principales ─────────────────────────────────────────── */}
          <div className="card-grid" style={{ marginBottom: '1.25rem' }}>
            <KpiCard
              label="💵 Ingresos netos"
              valueBs={summary.netRevenueBs}
              valueUsd={summary.netRevenueUsd}
              trend={summary.vsPrevRevenuePct}
              highlight
            />
            <KpiCard
              label="📦 Ingresos brutos"
              valueBs={summary.grossRevenueBs}
              valueUsd={summary.grossRevenueUsd}
            />
            <StatCard
              label="🎟️ Ticket promedio"
              value={fmtBs(summary.avgTicketBs)}
              sub={`~${fmtUsd(summary.avgTicketUsd)}`}
              color="var(--accent)"
            />
            <StatCard
              label="📊 Conversión"
              value={`${summary.conversionRate}%`}
              sub={`${summary.deliveredOrders} de ${summary.deliveredOrders + summary.cancelledOrders} completados`}
              color={summary.conversionRate >= 80 ? 'var(--success)' : summary.conversionRate >= 60 ? 'var(--warning)' : 'var(--error)'}
            />
          </div>

          {/* ── Segunda fila de KPIs ─────────────────────────────────────── */}
          <div className="card-grid" style={{ marginBottom: '1.25rem' }}>
            <StatCard
              label="🛒 Total pedidos"
              value={summary.totalOrders}
              sub={`En proceso: ${summary.inProgressOrders}`}
            />
            <StatCard
              label="✅ Entregados"
              value={summary.deliveredOrders}
              color="var(--success)"
            />
            <StatCard
              label="❌ Cancelados"
              value={summary.cancelledOrders}
              sub={`Pérdida est. ${fmtBs(summary.cancelledOrders * summary.avgTicketBs)}`}
              color={summary.cancelledOrders > 0 ? 'var(--error)' : 'var(--text2)'}
            />
            {summary.discountBs > 0 && (
              <StatCard
                label="🏷️ Descuentos aplicados"
                value={fmtBs(summary.discountBs)}
                sub={`~${fmtUsd(summary.discountUsd)}`}
                color="var(--warning)"
              />
            )}
          </div>

          {/* ── Gráfico de tendencia ─────────────────────────────────────── */}
          {chart.length > 1 && (
            <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '1rem', fontSize: '0.9rem' }}>
                📈 Tendencia de ingresos (Bs)
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chart} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--surface2)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'var(--text2)' }}
                    tickFormatter={(v: string) => {
                      if (period === 'year') {
                        const [, m] = v.split('-');
                        return ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][parseInt(m!) - 1] ?? v;
                      }
                      return v.slice(5); // MM-DD
                    }}
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text2)' }} width={60}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="revenueBs"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#colorRevenue)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Desglose ─────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            <SplitBar
              label="💳 Ingresos por método de pago"
              items={[
                { name: 'Pago Móvil', value: summary.pagoMovilRevenueBs, count: summary.pagoMovilCount, color: 'var(--accent)' },
                { name: 'Efectivo / Contraentrega', value: summary.cashRevenueBs, count: summary.cashCount, color: 'var(--success)' },
              ]}
            />
            <SplitBar
              label="🛵 Ingresos por tipo de entrega"
              items={[
                { name: 'Delivery', value: summary.deliveryRevenueBs, count: summary.deliveryCount, color: 'var(--accent)' },
                { name: 'Retiro en local', value: summary.pickupRevenueBs, count: summary.pickupCount, color: '#8b5cf6' },
              ]}
            />
          </div>

          {/* ── Nota de período ──────────────────────────────────────────── */}
          {summary.vsPrevRevenuePct !== null && (
            <div style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'var(--text2)', textAlign: 'right' }}>
              Comparado con el período anterior de igual duración.
              {summary.discountBs > 0 && ' Los ingresos netos excluyen descuentos aplicados.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
