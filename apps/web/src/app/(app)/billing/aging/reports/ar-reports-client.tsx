'use client';

/**
 * A/R Reports client. Pick a template + date range, hit Run, then
 * Excel / PDF / Print the result. The five templates share a single
 * columns/rows/totals contract on the wire so the table renderer is
 * one component for all of them.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientRunReport, reportDownloadUrl } from '@/lib/api/ar';
import { type ArReportId, type ArReportResponse } from '@ustowdispatch/shared';
import { FileSpreadsheet, FileText, Play, Printer } from 'lucide-react';
import { type JSX, useState } from 'react';
import { toast } from 'sonner';

const TEMPLATES: Array<{
  id: ArReportId;
  label: string;
  description: string;
  groupByOptions: Array<'account' | 'customer' | 'driver' | 'tenant'>;
  adminOnly?: boolean;
}> = [
  {
    id: 'aging_summary',
    label: 'A/R Aging Summary',
    description: 'Current / 1-30 / 31-60 / 61-90 / 90+ buckets, by your chosen grouping.',
    groupByOptions: ['account', 'customer', 'tenant'],
  },
  {
    id: 'past_due_by_account',
    label: 'Past Due by Account',
    description: 'Past-due invoices grouped by account, sorted by balance.',
    groupByOptions: [],
  },
  {
    id: 'revenue_summary',
    label: 'Revenue Summary',
    description: 'Billed / paid / outstanding / voided / refunded, by grouping.',
    groupByOptions: ['account', 'tenant'],
  },
  {
    id: 'payment_activity',
    label: 'Payment Activity',
    description: 'Payments in date range, grouped by method or account.',
    groupByOptions: ['account', 'tenant'],
  },
  {
    id: 'driver_commissions',
    label: 'Driver Commission Earnings',
    description: 'Per-driver commission, count of invoices, average per invoice. Admin only.',
    groupByOptions: [],
    adminOnly: true,
  },
];

export function ArReportsClient(): JSX.Element {
  const [selectedId, setSelectedId] = useState<ArReportId>('aging_summary');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<'account' | 'customer' | 'driver' | 'tenant'>('account');
  const [data, setData] = useState<ArReportResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const template = TEMPLATES.find((t) => t.id === selectedId);

  const filters = {
    ...(dateFrom ? { dateFrom: new Date(dateFrom).toISOString() } : {}),
    ...(dateTo ? { dateTo: new Date(dateTo).toISOString() } : {}),
    ...(template?.groupByOptions.includes(groupBy) ? { groupBy } : {}),
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await clientRunReport(selectedId, { ...filters, format: 'json' });
      setData(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Report failed');
    } finally {
      setBusy(false);
    }
  };

  const xlsxUrl = reportDownloadUrl(selectedId, 'xlsx', filters);
  const pdfUrl = reportDownloadUrl(selectedId, 'pdf', filters);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
          A/R reports
        </h1>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Run, export, and print A/R reports across five built-in templates.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            Templates
          </p>
          <div className="space-y-1">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                  selectedId === t.id
                    ? 'border-orange bg-orange/10 text-text-primary-on-dark'
                    : 'border-divider bg-bg-surface hover:border-orange/30'
                }`}
              >
                <span className="block font-semibold">
                  {t.label}{' '}
                  {t.adminOnly ? (
                    <span className="ml-1 rounded bg-bg-surface-elevated px-1 text-[10px] uppercase">
                      Admin
                    </span>
                  ) : null}
                </span>
                <span className="block text-[11px] text-text-secondary-on-dark">
                  {t.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="md:col-span-2 space-y-3">
          <div className="rounded-lg border border-divider bg-bg-surface p-4">
            <h2 className="font-condensed text-lg font-bold uppercase">{template?.label}</h2>
            <p className="mt-1 text-sm text-text-secondary-on-dark">{template?.description}</p>

            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
              <div>
                <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                  From
                </span>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                  To
                </span>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              {template && template.groupByOptions.length > 0 ? (
                <div>
                  <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                    Group by
                  </span>
                  <select
                    value={groupBy}
                    onChange={(e) =>
                      setGroupBy(e.target.value as 'account' | 'customer' | 'driver' | 'tenant')
                    }
                    className="w-full rounded-md border border-divider bg-bg-base px-2 py-1.5 text-sm"
                  >
                    {template.groupByOptions.map((g) => (
                      <option key={g} value={g}>
                        {g[0]?.toUpperCase() ?? ''}
                        {g.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={run} disabled={busy}>
                <Play className="mr-1.5 h-4 w-4" /> {busy ? 'Running…' : 'Run Report'}
              </Button>
              <a
                href={xlsxUrl}
                className="inline-flex items-center rounded-md border border-divider bg-bg-surface-elevated px-3 py-1.5 text-sm hover:bg-divider"
              >
                <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel
              </a>
              <a
                href={pdfUrl}
                className="inline-flex items-center rounded-md border border-divider bg-bg-surface-elevated px-3 py-1.5 text-sm hover:bg-divider"
              >
                <FileText className="mr-1.5 h-4 w-4" /> PDF
              </a>
              <Button variant="ghost" onClick={() => window.print()}>
                <Printer className="mr-1.5 h-4 w-4" /> Print
              </Button>
            </div>
          </div>

          {data ? <ReportTable data={data} /> : null}
        </div>
      </div>
    </div>
  );
}

function ReportTable({ data }: { data: ArReportResponse }): JSX.Element {
  const currencyKeys = new Set([
    'totalCents',
    'subtotalCents',
    'taxCents',
    'balanceCents',
    'paidCents',
    'current',
    'bucket1To30',
    'bucket31To60',
    'bucket61To90',
    'bucket91Plus',
    'total',
    'totalBalance',
    'billed',
    'paid',
    'outstanding',
    'voided',
    'refunded',
    'amount',
    'fees',
    'netAmount',
    'totalRevenue',
    'commission',
    'avgCommission',
  ]);

  const fmt = (k: string, v: unknown): string => {
    if (v == null) return '—';
    if (typeof v === 'number' && currencyKeys.has(k)) {
      const sign = v < 0 ? '-' : '';
      const abs = Math.abs(v);
      const d = Math.floor(abs / 100);
      const c = abs % 100;
      return `${sign}$${d.toLocaleString('en-US')}.${String(c).padStart(2, '0')}`;
    }
    if (typeof v === 'number') return v.toLocaleString('en-US');
    return String(v);
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-divider">
      <table className="w-full text-sm">
        <thead className="bg-bg-surface/60">
          <tr>
            {data.columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {data.rows.length === 0 ? (
            <tr>
              <td
                colSpan={data.columns.length}
                className="px-3 py-12 text-center text-text-secondary-on-dark"
              >
                No data for these filters.
              </td>
            </tr>
          ) : (
            data.rows.map((r, i) => (
              <tr key={`${r.groupId ?? i}`}>
                {data.columns.map((c) => {
                  const raw = c.key === 'groupLabel' ? r.groupLabel : r.values[c.key];
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 ${c.align === 'right' ? 'text-right font-mono' : ''}`}
                    >
                      {fmt(c.key, raw)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
        {data.totals ? (
          <tfoot className="bg-bg-surface/60 font-bold">
            <tr>
              {data.columns.map((c) => {
                const raw = c.key === 'groupLabel' ? 'TOTAL' : data.totals?.[c.key];
                return (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${c.align === 'right' ? 'text-right font-mono' : ''}`}
                  >
                    {fmt(c.key, raw ?? null)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
