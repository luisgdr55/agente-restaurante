interface StatsCardProps {
  label: string;
  value: string | number;
  emoji: string;
  color?: string;
}

export default function StatsCard({ label, value, emoji, color }: StatsCardProps) {
  return (
    <div className="card" style={{ borderLeft: `4px solid ${color ?? 'var(--accent)'}` }}>
      <div style={{ fontSize: '2rem' }}>{emoji}</div>
      <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.5rem', color: color ?? 'var(--text)' }}>{value}</div>
      <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>{label}</div>
    </div>
  );
}
