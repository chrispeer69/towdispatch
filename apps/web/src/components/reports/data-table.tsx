'use client';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

export interface DataTableColumn<TRow> {
  key: keyof TRow & string;
  header: string;
  align?: 'left' | 'right';
  format?: (row: TRow) => string;
}

export function ReportDataTable<TRow extends Record<string, unknown>>({
  rows,
  columns,
}: {
  rows: TRow[];
  columns: DataTableColumn<TRow>[];
}): JSX.Element {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  return (
    <div
      className="overflow-x-auto rounded-md border border-steel-border bg-steel-mid/40"
      data-testid="report-table"
    >
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-text-secondary">
            {columns.map((c) => {
              const active = sortKey === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`cursor-pointer select-none border-b border-steel-border px-3 py-2 ${c.align === 'right' ? 'text-right' : ''}`}
                  onClick={() => {
                    if (sortKey === c.key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                    else {
                      setSortKey(c.key);
                      setSortDir('desc');
                    }
                  }}
                >
                  {c.header}
                  {active ? <span className="ml-1 text-orange">{sortDir === 'asc' ? '▲' : '▼'}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-xs text-text-muted"
              >
                No data in this range.
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr
                key={String((row as { id?: string }).id ?? i)}
                className="border-b border-steel-border/40 hover:bg-steel-light/30"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : ''}`}
                  >
                    {c.format ? c.format(row) : String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
