'use client';

import { useMemo, useState } from 'react';

type Row = Record<string, string | number | boolean | null>;

/**
 * Lightweight sortable table used by every report detail page. Column toggle
 * + ascending/descending click — no virtualization; page-side pagination is
 * 50 rows by default so this stays within DOM tractable limits without
 * pulling in a heavier table lib.
 *
 * We deliberately do NOT use TanStack Table here — the existing web app does
 * not yet depend on it, and the small surface this report module needs
 * doesn't justify the dependency. Documented as a deviation in the final
 * report.
 */
export function ReportDataTable({
  rows,
  columnLabels = {},
  emptyMessage = 'No rows match the current filters.',
}: {
  rows: Row[];
  columnLabels?: Record<string, string>;
  emptyMessage?: string;
}): JSX.Element {
  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    return Object.keys(rows[0] ?? {});
  }, [rows]);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const k = sortKey;
    return [...rows].sort((a, b) => {
      const av = a[k] ?? '';
      const bv = b[k] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const an = String(av).toLowerCase();
      const bn = String(bv).toLowerCase();
      if (an === bn) return 0;
      return sortDir === 'asc' ? (an < bn ? -1 : 1) : an < bn ? 1 : -1;
    });
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-steel-border p-6 text-center text-sm text-text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <details className="rounded-md border border-steel-border bg-steel-mid/30 px-3 py-2 text-xs">
        <summary className="cursor-pointer select-none text-text-secondary">Columns</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {columns.map((c) => (
            <label key={c} className="flex items-center gap-1 text-text-secondary">
              <input
                type="checkbox"
                checked={!hidden.has(c)}
                onChange={() => {
                  const next = new Set(hidden);
                  if (next.has(c)) next.delete(c);
                  else next.add(c);
                  setHidden(next);
                }}
              />
              {columnLabels[c] ?? c}
            </label>
          ))}
        </div>
      </details>
      <div className="overflow-x-auto rounded-lg border border-steel-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-steel-mid">
            <tr>
              {columns
                .filter((c) => !hidden.has(c))
                .map((c) => {
                  const toggleSort = (): void => {
                    if (sortKey === c) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                    else {
                      setSortKey(c);
                      setSortDir('desc');
                    }
                  };
                  return (
                    <th
                      key={c}
                      scope="col"
                      className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted"
                    >
                      <button
                        type="button"
                        onClick={toggleSort}
                        className="cursor-pointer text-left font-mono uppercase tracking-[0.18em] text-text-muted hover:text-text-primary"
                      >
                        {columnLabels[c] ?? c}
                        {sortKey === c ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  );
                })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={rowKey(r, i)}
                className="border-t border-steel-border/40 hover:bg-steel-mid/40"
              >
                {columns
                  .filter((c) => !hidden.has(c))
                  .map((c) => (
                    <td key={c} className="px-3 py-2 text-text-primary">
                      {formatCell(r[c] ?? null)}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function rowKey(r: Row, i: number): string {
  for (const k of ['id', 'jobId', 'driverId', 'truckId', 'accountId']) {
    const v = r[k];
    if (typeof v === 'string' && v.length > 0) return `${k}:${v}`;
  }
  return `row:${i}`;
}

function formatCell(v: string | number | boolean | null): string {
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString('en-US');
  return v;
}
