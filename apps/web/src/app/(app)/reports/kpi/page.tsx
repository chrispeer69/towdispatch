/**
 * /reports/kpi — tenant KPI dashboard (Session 53).
 *
 * Renders the caller's saved widget layout (or the generated default) as a
 * tile grid. Each tile is computed server-side via /reporting/kpi/widgets/:id.
 * A widget that errors or has no source data shows a dash rather than crashing
 * the board.
 *
 * TODO(i18n): the Session 14 reporting surface is English-only (no next-intl
 * here yet); these strings follow that existing convention. es/fr parity lands
 * when the reporting surface migrates to next-intl.
 */
import { fetchKpiLayout, fetchKpiWidget } from '@/lib/api/reporting-builder';
import { requireUser } from '@/lib/auth/session';
import type { KpiLayoutEntry, KpiValueDto, KpiWidgetId } from '@ustowdispatch/shared';
import Link from 'next/link';

export const metadata = { title: 'KPI Dashboard — TowCommand' };
export const dynamic = 'force-dynamic';

export default async function KpiDashboardPage(): Promise<JSX.Element> {
  await requireUser();
  const layoutDto = await fetchKpiLayout();
  const entries = layoutDto.layout;

  const tiles = await Promise.all(
    entries.map(async (entry): Promise<{ entry: KpiLayoutEntry; value: KpiValueDto | null }> => {
      try {
        const compareTo =
          typeof entry.config?.compare_to === 'string' ? entry.config.compare_to : undefined;
        return { entry, value: await fetchKpiWidget(entry.widgetId, compareTo) };
      } catch {
        return { entry, value: null };
      }
    }),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            KPI Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Live operational and financial signals for your tenant.
          </p>
        </div>
        <Link
          href="/reports"
          className="rounded-md border border-steel-border bg-steel-mid px-3 py-1.5 text-sm text-text-primary hover:bg-steel-light"
        >
          All reports
        </Link>
      </header>

      <section
        className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4"
        data-testid="kpi-grid"
      >
        {tiles.map(({ entry, value }) => (
          <KpiTileCard
            key={entry.widgetId}
            widgetId={entry.widgetId}
            value={value}
            wide={entry.w >= 8}
          />
        ))}
      </section>
    </div>
  );
}

function KpiTileCard({
  widgetId,
  value,
  wide,
}: {
  widgetId: KpiWidgetId;
  value: KpiValueDto | null;
  wide: boolean;
}): JSX.Element {
  return (
    <div
      className={`rounded-lg border border-steel-border bg-steel-mid/40 p-4 ${wide ? 'col-span-2' : ''}`}
      data-testid={`kpi-tile-${widgetId}`}
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">
        {value?.label ?? widgetId}
      </div>
      {value?.series ? (
        <ul className="mt-2 space-y-1">
          {value.series.length === 0 ? (
            <li className="text-xs text-text-muted">No data yet.</li>
          ) : (
            value.series.map((s) => (
              <li key={s.label} className="flex items-center justify-between text-xs">
                <span className="truncate text-text-secondary">{s.label}</span>
                <span className="font-mono text-text-primary">{formatMoneyCents(s.value)}</span>
              </li>
            ))
          )}
        </ul>
      ) : (
        <div className={`mt-1 font-condensed text-2xl font-extrabold ${tone(value?.tone)}`}>
          {formatValue(value)}
        </div>
      )}
      {value?.deltaPct != null ? (
        <div className={`mt-1 text-xs ${value.deltaPct >= 0 ? 'text-ok' : 'text-danger'}`}>
          {value.deltaPct >= 0 ? '▲' : '▼'} {Math.abs(value.deltaPct)}% vs prior
        </div>
      ) : null}
      {value?.note ? <div className="mt-1 text-[11px] text-text-muted">{value.note}</div> : null}
    </div>
  );
}

function formatValue(value: KpiValueDto | null): string {
  if (!value || value.value === null) return '—';
  if (value.unit === '$') return formatMoneyCents(Number(value.value));
  if (value.unit === '%') return `${value.value}%`;
  if (value.unit === 'min') return `${value.value} min`;
  return String(value.value);
}

function formatMoneyCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function tone(t: KpiValueDto['tone'] | undefined): string {
  switch (t) {
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
