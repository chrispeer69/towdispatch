import type { KpiTile } from '@ustowdispatch/shared';

/**
 * KpiRow — uniform 4-6 column tile strip used at the top of every report
 * detail page and on the index cards. Tone maps to the design-token color.
 */
export function KpiRow({ kpis }: { kpis: KpiTile[] }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-lg border border-steel-border bg-steel-mid/40 p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">{k.label}</div>
          <div
            className={`mt-1 font-condensed text-2xl font-extrabold ${toneClass(k.tone ?? 'neutral')}`}
          >
            {k.value ?? '—'}
          </div>
          {k.hint ? <div className="mt-1 text-xs text-text-secondary">{k.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

function toneClass(tone: 'ok' | 'warn' | 'danger' | 'neutral'): string {
  switch (tone) {
    case 'ok':
      return 'text-ok';
    case 'warn':
      return 'text-warn';
    case 'danger':
      return 'text-danger';
    default:
      return 'text-text-primary';
  }
}
