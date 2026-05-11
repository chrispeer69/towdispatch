import type { JSX } from 'react';

export type StatTrend = 'good' | 'bad' | 'neutral' | null;

export function Stat({
  label,
  value,
  trend,
  changePct,
}: {
  label: string;
  value: string;
  trend?: StatTrend;
  changePct?: number | null;
}): JSX.Element {
  const tone =
    trend === 'good' ? 'text-ok' : trend === 'bad' ? 'text-danger' : 'text-text-primary';
  return (
    <div className="rounded-md bg-steel/60 p-3" data-testid="kpi-stat">
      <div className="text-[10px] uppercase tracking-wider text-text-secondary">{label}</div>
      <div className={`mt-1 font-condensed text-xl font-extrabold leading-none ${tone}`}>
        {value}
      </div>
      {changePct != null ? (
        <div className="mt-1 text-[10px] text-text-muted">
          {changePct >= 0 ? '▲' : '▼'} {(Math.abs(changePct) * 100).toFixed(1)}%
        </div>
      ) : null}
    </div>
  );
}
