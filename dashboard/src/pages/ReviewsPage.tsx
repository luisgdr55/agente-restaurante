import { useEffect, useState, useCallback } from 'react';
import { reviewsApi } from '../api/api';
import type { Review, ReviewStats } from '../api/api';

const STARS = [5, 4, 3, 2, 1];
const PAGE_SIZE = 20;

function StarBar({ rating, count, total }: { rating: number; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
      <span style={{ width: '1.8rem', textAlign: 'right', color: 'var(--text2)' }}>{rating}★</span>
      <div style={{ flex: 1, background: 'var(--surface2)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: rating >= 4 ? 'var(--success, #10b981)' : rating === 3 ? '#f59e0b' : 'var(--error, #ef4444)',
          borderRadius: '4px', transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ width: '2.5rem', color: 'var(--text2)' }}>{count}</span>
    </div>
  );
}

function renderStars(rating: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <span key={i} style={{ color: i < rating ? '#F5C518' : 'var(--surface2)', fontSize: '1rem' }}>★</span>
  ));
}

export default function ReviewsPage() {
  const [stats, setStats]       = useState<ReviewStats | null>(null);
  const [reviews, setReviews]   = useState<Review[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<number | null>(null);
  const [offset, setOffset]     = useState(0);

  const loadStats = useCallback(async () => {
    const s = await reviewsApi.getStats();
    setStats(s);
  }, []);

  const loadReviews = useCallback(async (f: number | null, o: number) => {
    setLoading(true);
    try {
      const params: { limit: number; offset: number; rating?: number } = { limit: PAGE_SIZE, offset: o };
      if (f !== null) params.rating = f;
      const res = await reviewsApi.getAll(params);
      setReviews(res.reviews);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadReviews(filter, offset);
  }, [filter, offset, loadReviews]);

  function setFilterAndReset(f: number | null) {
    setFilter(f);
    setOffset(0);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.25rem', marginBottom: '1.25rem' }}>⭐ Reseñas de clientes</h2>

      {/* Stats card */}
      {stats && (
        <div className="card" style={{ marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* Left — promedio */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
            <div style={{ fontSize: '3rem', fontWeight: 800, color: '#F5C518', lineHeight: 1 }}>
              {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '—'}
            </div>
            <div style={{ display: 'flex', gap: '0.1rem' }}>
              {renderStars(Math.round(stats.averageRating))}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>
              {stats.totalReviews} {stats.totalReviews === 1 ? 'reseña' : 'reseñas'}
            </div>
          </div>

          {/* Right — distribución */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', justifyContent: 'center' }}>
            {STARS.map((s) => (
              <StarBar
                key={s}
                rating={s}
                count={stats.distribution[String(s)] ?? 0}
                total={stats.totalReviews}
              />
            ))}
          </div>
        </div>
      )}

      {/* Filtros por rating */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {[null, 5, 4, 3, 2, 1].map((r) => (
          <button
            key={r ?? 'all'}
            className="btn btn-sm"
            onClick={() => setFilterAndReset(r)}
            style={{
              background: filter === r ? 'var(--accent)' : 'var(--surface2)',
              color: filter === r ? '#fff' : 'var(--text)',
              border: 'none',
              fontWeight: filter === r ? 700 : 400,
            }}
          >
            {r === null ? 'Todas' : `${r} ★`}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text2)' }}>Cargando...</div>
      ) : reviews.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text2)' }}>
          {filter !== null ? `No hay reseñas de ${filter} estrella${filter === 1 ? '' : 's'}.` : 'Aún no hay reseñas.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {reviews.map((r) => (
            <div key={r.id} className="card" style={{ padding: '0.85rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>{renderStars(r.rating)}</span>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{r.customer.name ?? r.customer.phone}</span>
                  </div>
                  {r.comment && (
                    <div style={{ marginTop: '0.35rem', color: 'var(--text)', fontSize: '0.88rem', lineHeight: 1.5 }}>
                      "{r.comment}"
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>
                    Pedido #{String(r.order.orderNumber).padStart(4, '0')}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text2)' }}>
                    {new Date(r.createdAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button className="btn btn-sm btn-ghost"
            disabled={currentPage === 1}
            onClick={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}>
            ← Anterior
          </button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>
            Página {currentPage} de {totalPages}
          </span>
          <button className="btn btn-sm btn-ghost"
            disabled={currentPage === totalPages}
            onClick={() => setOffset((p) => p + PAGE_SIZE)}>
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
