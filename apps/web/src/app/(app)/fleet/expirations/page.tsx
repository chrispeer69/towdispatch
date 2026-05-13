import { tryFetch } from '@/lib/api/client';
import { fetchExpirations } from '@/lib/api/fleet';
import { cn } from '@/lib/utils';
import type { ExpirationRow, ExpirationsResponse } from '@towcommand/shared';

interface SearchParams {
  windowDays?: string;
  kind?: string;
  entityType?: string;
}

function emptyExpirations(windowDays: number): ExpirationsResponse {
  return { windowDays, expired: [], critical: [], warning: [] };
}

export default async function ExpirationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const windowDays = Number(params.windowDays ?? '30');
  const result = await tryFetch(() =>
    fetchExpirations({
      windowDays: params.windowDays ?? '30',
      kind: params.kind,
      entityType: params.entityType,
    }),
  );
  const data = result.data ?? emptyExpirations(Number.isFinite(windowDays) ? windowDays : 30);
  return (
    <div className="space-y-6">
      <p className="text-sm text-text-secondary">
        Anything expiring within {data.windowDays} days, plus already-expired items.
      </p>
      <Bucket title="Expired" rows={data.expired} tone="expired" />
      <Bucket title="Critical (≤ 7 days)" rows={data.critical} tone="critical" />
      <Bucket title={`Warning (≤ ${data.windowDays} days)`} rows={data.warning} tone="warning" />
    </div>
  );
}

function Bucket({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: ExpirationRow[];
  tone: 'expired' | 'critical' | 'warning';
}): JSX.Element {
  const palette = {
    expired: 'border-red-500/30 bg-red-500/5',
    critical: 'border-amber-500/30 bg-amber-500/5',
    warning: 'border-steel-border bg-steel-mid',
  } as const;
  const labelPalette = {
    expired: 'text-red-300',
    critical: 'text-amber-300',
    warning: 'text-text-secondary',
  } as const;
  return (
    <section
      className={cn('rounded-[14px] border p-4', palette[tone])}
      data-testid={`expirations-${tone}`}
    >
      <h3 className={cn('font-mono text-[10px] uppercase tracking-[0.22em]', labelPalette[tone])}>
        {title} · {rows.length}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">Nothing here.</p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm">
          {rows.map((r, i) => (
            <li
              key={`${r.kind}-${r.entityId}-${r.documentId ?? i}`}
              className="flex items-center justify-between"
            >
              <span>{r.label}</span>
              <span className="font-mono text-xs text-text-muted">
                {r.daysUntilExpiry <= 0
                  ? `expired ${Math.abs(r.daysUntilExpiry)}d ago`
                  : `${r.daysUntilExpiry}d left`}
                {' · '}
                {r.expiresAt}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
