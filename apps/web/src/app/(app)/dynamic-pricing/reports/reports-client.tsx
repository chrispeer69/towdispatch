'use client';
/**
 * Dynamic-pricing reports client. Three reports + date-range pickers +
 * Excel / CSV / Print buttons.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileSpreadsheet, FileText, Play, Printer } from 'lucide-react';
import { type JSX, useState } from 'react';
import { toast } from 'sonner';

type ReportId = 'tier-history' | 'tier-performance' | 'overrides';

const REPORTS: Array<{ id: ReportId; label: string; description: string }> = [
  {
    id: 'tier-history',
    label: 'Tier History',
    description: 'Every tier activation and deactivation, with who, when, and duration.',
  },
  {
    id: 'tier-performance',
    label: 'Tier Performance',
    description:
      'Per-tier revenue contribution, accepted-quote count, decline rate, and average multiplier.',
  },
  {
    id: 'overrides',
    label: 'Override Report',
    description: 'Operator manual price overrides aggregated by reason code, with $ delta.',
  },
];

export function ReportsClient(): JSX.Element {
  const [selected, setSelected] = useState<ReportId>('tier-history');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<unknown[]>([]);
  const [busy, setBusy] = useState(false);

  function buildQuery(format: 'json' | 'csv' | 'xlsx'): string {
    const qs = new URLSearchParams();
    qs.set('format', format);
    if (from) qs.set('from', new Date(from).toISOString());
    if (to) qs.set('to', new Date(to).toISOString());
    return qs.toString();
  }

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/dynamic-pricing/reports/${selected}?${buildQuery('json')}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Run failed (${res.status})`);
      }
      setData((await res.json()) as unknown[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  const xlsxUrl = `/api/dynamic-pricing/reports/${selected}?${buildQuery('xlsx')}`;
  const csvUrl = `/api/dynamic-pricing/reports/${selected}?${buildQuery('csv')}`;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
          Reports
        </p>
        <div className="space-y-1">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                selected === r.id
                  ? 'border-orange bg-orange/10 text-text-primary-on-dark'
                  : 'border-divider bg-bg-surface hover:border-orange/30'
              }`}
            >
              <span className="block font-semibold">{r.label}</span>
              <span className="block text-[11px] text-text-secondary-on-dark">{r.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="md:col-span-2 space-y-3">
        <div className="rounded-lg border border-divider bg-bg-surface p-4">
          <h2 className="font-condensed text-lg font-bold uppercase">{REPORTS.find((r) => r.id === selected)?.label}</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                From
              </span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                To
              </span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
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
              href={csvUrl}
              className="inline-flex items-center rounded-md border border-divider bg-bg-surface-elevated px-3 py-1.5 text-sm hover:bg-divider"
            >
              <FileText className="mr-1.5 h-4 w-4" /> CSV
            </a>
            <Button variant="ghost" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Print
            </Button>
          </div>
        </div>
        {data.length > 0 ? <ReportTable rows={data as Array<Record<string, unknown>>} /> : null}
      </div>
    </div>
  );
}

function ReportTable({ rows }: { rows: Array<Record<string, unknown>> }): JSX.Element {
  if (rows.length === 0) return <p className="text-sm text-text-secondary-on-dark">No rows.</p>;
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  return (
    <div className="overflow-x-auto rounded-lg border border-divider">
      <table className="w-full text-sm">
        <thead className="bg-bg-surface/60">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark text-left"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {rows.map((r, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td key={h} className="px-3 py-2">
                  {String((r as Record<string, unknown>)[h] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
