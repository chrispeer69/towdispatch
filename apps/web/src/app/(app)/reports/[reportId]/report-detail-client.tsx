'use client';
/**
 * ReportDetailClient — the per-report detail screen.
 *
 * Server fetches the initial /summary + /list payload; this client handles:
 *   - filter changes (date range, granularity, comparison)
 *   - chart rendering (Recharts)
 *   - sortable data table
 *   - CSV / PDF export (POST /reporting/{id}/export -> download link)
 *   - save-and-schedule dialog (POST /reporting/saved + .../schedule)
 *
 * Data shape per-report: each report has a different row schema. We branch
 * on `reportId` inside the renderers; that's verbose but type-safe.
 */
import {
  ReportBarChart,
  ReportLineChart,
  ReportPieChart,
} from '@/components/reports/charts';
import { ReportDataTable, type DataTableColumn } from '@/components/reports/data-table';
import { DEFAULT_FILTERS, type FilterState, FilterSidebar } from '@/components/reports/filter-sidebar';
import { Stat } from '@/components/reports/stat';
import type {
  CommissionLineRow,
  ComplianceRow,
  DispatchPerformanceRow,
  DriverPerformanceRow,
  ExportResponse,
  PnlRow,
  ReportExportFormat,
  ReportId,
  ReportPage,
  ReportSummary,
  RevenueRow,
  StorageRow,
  TaxRow,
} from '@towcommand/shared';
import type { JSX } from 'react';
import { useCallback, useMemo, useState } from 'react';

interface Props {
  reportId: ReportId;
  initialSummary: ReportSummary | null;
  initialPage: ReportPage<unknown> | null;
}

interface SaveDialogState {
  open: boolean;
  name: string;
  description: string;
  recipients: string;
  cadence: 'daily' | 'weekly' | 'monthly';
  format: 'pdf' | 'csv';
  hourUtc: number;
}

const TITLE: Record<ReportId, string> = {
  dispatch: 'Dispatch performance',
  driver: 'Driver performance',
  revenue: 'Revenue',
  storage: 'Storage & impound',
  pnl: 'Profit & loss',
  commission: 'Commission',
  tax: 'Tax',
  compliance: 'Compliance',
};

function buildQuery(state: FilterState): string {
  const u = new URLSearchParams();
  u.set('from', new Date(`${state.from}T00:00:00Z`).toISOString());
  u.set('to', new Date(`${state.to}T23:59:59Z`).toISOString());
  u.set('granularity', state.granularity);
  u.set('comparison', state.comparison);
  return u.toString();
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function ReportDetailClient({ reportId, initialSummary, initialPage }: Props): JSX.Element {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [summary, setSummary] = useState<ReportSummary | null>(initialSummary);
  const [page, setPage] = useState<ReportPage<unknown> | null>(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState<ExportResponse | null>(null);
  const [save, setSave] = useState<SaveDialogState>({
    open: false,
    name: `${TITLE[reportId]} — ${new Date().toLocaleDateString()}`,
    description: '',
    recipients: '',
    cadence: 'weekly',
    format: 'pdf',
    hourUtc: 13,
  });

  const refresh = useCallback(
    async (state: FilterState): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const q = buildQuery(state);
        const [s, p] = await Promise.all([
          api<ReportSummary>(`/reporting/${reportId}/summary?${q}`),
          api<ReportPage<unknown>>(`/reporting/${reportId}?${q}`),
        ]);
        setSummary(s);
        setPage(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [reportId],
  );

  const onExport = useCallback(
    async (state: FilterState, format: ReportExportFormat): Promise<void> => {
      try {
        const q = buildQuery(state);
        const u = new URLSearchParams(q);
        const filterObj: Record<string, unknown> = {};
        for (const [k, v] of u.entries()) filterObj[k] = v;
        const result = await api<ExportResponse>(`/reporting/${reportId}/export`, {
          method: 'POST',
          body: JSON.stringify({ format, filters: filterObj }),
        });
        setExportInfo(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [reportId],
  );

  const onSave = useCallback((state: FilterState): void => {
    setFilters(state);
    setSave((s) => ({ ...s, open: true }));
  }, []);

  const submitSave = useCallback(async (): Promise<void> => {
    try {
      const q = buildQuery(filters);
      const u = new URLSearchParams(q);
      const filterObj: Record<string, unknown> = {};
      for (const [k, v] of u.entries()) filterObj[k] = v;
      const saved = await api<{ id: string }>(`/reporting/saved`, {
        method: 'POST',
        body: JSON.stringify({
          name: save.name,
          reportId,
          filters: filterObj,
          description: save.description || null,
        }),
      });
      const recipients = save.recipients
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      if (recipients.length > 0) {
        await api(`/reporting/saved/${saved.id}/schedule`, {
          method: 'POST',
          body: JSON.stringify({
            cadence: save.cadence,
            hourUtc: save.hourUtc,
            format: save.format,
            recipients,
          }),
        });
      }
      setSave((s) => ({ ...s, open: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [filters, reportId, save]);

  return (
    <div className="space-y-6" data-testid={`report-${reportId}`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
            {TITLE[reportId]}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {summary
              ? `${summary.windowFrom.slice(0, 10)} → ${summary.windowTo.slice(0, 10)}`
              : 'Adjust filters and apply to load data.'}
          </p>
        </div>
        {loading ? (
          <span className="text-xs text-text-muted">Loading…</span>
        ) : error ? (
          <span className="text-xs text-danger" data-testid="error-state">
            {error}
          </span>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
        <FilterSidebar
          initial={filters}
          onApply={(s) => {
            setFilters(s);
            refresh(s);
          }}
          onExportCsv={(s) => onExport(s, 'csv')}
          onExportPdf={(s) => onExport(s, 'pdf')}
          onSave={(s) => onSave(s)}
        />

        <div className="space-y-6">
          {summary ? (
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {summary.kpis.map((k) => (
                <Stat
                  key={k.label}
                  label={k.label}
                  value={k.value}
                  trend={k.trend ?? null}
                  changePct={k.changePct ?? null}
                />
              ))}
            </section>
          ) : (
            <section className="rounded-md border border-steel-border bg-steel-mid/40 p-8 text-center text-sm text-text-secondary">
              {loading ? 'Loading KPIs…' : 'No data — adjust the filter window.'}
            </section>
          )}

          {page ? (
            <ReportBody reportId={reportId} page={page} />
          ) : (
            <section className="rounded-md border border-steel-border bg-steel-mid/40 p-8 text-center text-sm text-text-muted">
              {loading ? 'Loading…' : 'No rows to display.'}
            </section>
          )}

          {exportInfo ? (
            <div
              className="rounded-md border border-orange/40 bg-orange-glow p-4 text-sm"
              data-testid="export-result"
            >
              <p>
                <strong>Export ready.</strong> {exportInfo.filename} ({exportInfo.bytes} bytes)
              </p>
              <p className="mt-1">
                <a
                  href={exportInfo.url}
                  className="text-orange-light underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Download {exportInfo.format.toUpperCase()}
                </a>
                {' '}— expires {new Date(exportInfo.expiresAt).toLocaleTimeString()}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {save.open ? (
        <SaveDialog
          state={save}
          onCancel={() => setSave((s) => ({ ...s, open: false }))}
          onChange={(patch) => setSave((s) => ({ ...s, ...patch }))}
          onSubmit={() => submitSave()}
        />
      ) : null}
    </div>
  );
}

function ReportBody({
  reportId,
  page,
}: {
  reportId: ReportId;
  page: ReportPage<unknown>;
}): JSX.Element {
  switch (reportId) {
    case 'dispatch':
      return <DispatchBody page={page as ReportPage<DispatchPerformanceRow>} />;
    case 'driver':
      return <DriverBody page={page as ReportPage<DriverPerformanceRow>} />;
    case 'revenue':
      return <RevenueBody page={page as ReportPage<RevenueRow> & { timeSeries?: unknown }} />;
    case 'storage':
      return <StorageBody page={page as ReportPage<StorageRow>} />;
    case 'pnl':
      return <PnlBody page={page as ReportPage<PnlRow>} />;
    case 'commission':
      return <CommissionBody page={page as ReportPage<CommissionLineRow>} />;
    case 'tax':
      return <TaxBody page={page as ReportPage<TaxRow>} />;
    case 'compliance':
      return <ComplianceBody page={page as ReportPage<ComplianceRow>} />;
  }
}

function DispatchBody({ page }: { page: ReportPage<DispatchPerformanceRow> }): JSX.Element {
  const cols: DataTableColumn<DispatchPerformanceRow>[] = [
    { key: 'dispatcherName', header: 'Dispatcher' },
    { key: 'jobsTotal', header: 'Jobs', align: 'right' },
    { key: 'goaCount', header: 'GOA', align: 'right' },
    { key: 'goaRate', header: 'GOA rate', align: 'right', format: (r) => `${(r.goaRate * 100).toFixed(1)}%` },
    {
      key: 'avgCallToDispatchSec',
      header: 'Avg call→dispatch',
      align: 'right',
      format: (r) => (r.avgCallToDispatchSec == null ? '—' : `${Math.round(r.avgCallToDispatchSec / 60)} m`),
    },
    {
      key: 'avgOnSceneSec',
      header: 'Avg on-scene',
      align: 'right',
      format: (r) => (r.avgOnSceneSec == null ? '—' : `${Math.round(r.avgOnSceneSec / 60)} m`),
    },
  ];
  const top = page.rows.slice(0, 8).map((r) => ({ label: r.dispatcherName, value: r.jobsTotal }));
  return (
    <>
      <ReportBarChart data={top} title="Jobs by dispatcher" />
      <ReportDataTable rows={page.rows as unknown as Record<string, unknown>[]} columns={cols as unknown as DataTableColumn<Record<string, unknown>>[]} />
    </>
  );
}

function DriverBody({ page }: { page: ReportPage<DriverPerformanceRow> }): JSX.Element {
  const cols: DataTableColumn<DriverPerformanceRow>[] = [
    { key: 'driverName', header: 'Driver' },
    { key: 'jobsCompleted', header: 'Jobs', align: 'right' },
    {
      key: 'revenueCents',
      header: 'Revenue',
      align: 'right',
      format: (r) => `$${(r.revenueCents / 100).toLocaleString()}`,
    },
    {
      key: 'onTimePct',
      header: 'On-time %',
      align: 'right',
      format: (r) => (r.onTimePct == null ? '—' : `${(r.onTimePct * 100).toFixed(0)}%`),
    },
    {
      key: 'avgRating',
      header: 'Rating',
      align: 'right',
      format: (r) => (r.avgRating == null ? '—' : `${r.avgRating.toFixed(2)} ★`),
    },
    {
      key: 'goaRate',
      header: 'GOA',
      align: 'right',
      format: (r) => `${(r.goaRate * 100).toFixed(1)}%`,
    },
  ];
  const top = page.rows
    .slice(0, 8)
    .map((r) => ({ label: r.driverName, value: r.revenueCents }));
  return (
    <>
      <ReportBarChart data={top} title="Revenue by driver" unit="cents" />
      <ReportDataTable rows={page.rows as unknown as Record<string, unknown>[]} columns={cols as unknown as DataTableColumn<Record<string, unknown>>[]} />
    </>
  );
}

function RevenueBody({ page }: { page: ReportPage<RevenueRow> & { timeSeries?: unknown } }): JSX.Element {
  const cols: DataTableColumn<RevenueRow>[] = [
    { key: 'label', header: 'Label' },
    {
      key: 'revenueCents',
      header: 'Revenue',
      align: 'right',
      format: (r) => `$${(r.revenueCents / 100).toLocaleString()}`,
    },
    { key: 'jobs', header: 'Invoices', align: 'right' },
    {
      key: 'priorRevenueCents',
      header: 'Prior',
      align: 'right',
      format: (r) => (r.priorRevenueCents == null ? '—' : `$${(r.priorRevenueCents / 100).toLocaleString()}`),
    },
  ];
  const top = page.rows.slice(0, 6).map((r) => ({ label: r.label, value: r.revenueCents }));
  const ts = (page.timeSeries ?? []) as { bucket: string; value: number; priorValue?: number | null }[];
  return (
    <>
      <ReportLineChart data={ts} title="Revenue over time" unit="cents" />
      <ReportPieChart data={top} title="Revenue share — top 6" />
      <ReportDataTable rows={page.rows as unknown as Record<string, unknown>[]} columns={cols as unknown as DataTableColumn<Record<string, unknown>>[]} />
    </>
  );
}

function StorageBody({ page }: { page: ReportPage<StorageRow> }): JSX.Element {
  const cols: DataTableColumn<StorageRow>[] = [
    { key: 'vehicleLabel', header: 'Vehicle' },
    { key: 'jobNumber', header: 'Job #' },
    { key: 'daysInYard', header: 'Days', align: 'right' },
    {
      key: 'accruedFeesCents',
      header: 'Accrued',
      align: 'right',
      format: (r) => `$${(r.accruedFeesCents / 100).toLocaleString()}`,
    },
    {
      key: 'invoicedFeesCents',
      header: 'Invoiced',
      align: 'right',
      format: (r) => `$${(r.invoicedFeesCents / 100).toLocaleString()}`,
    },
    {
      key: 'outstandingCents',
      header: 'Outstanding',
      align: 'right',
      format: (r) => `$${(r.outstandingCents / 100).toLocaleString()}`,
    },
  ];
  const histogram = useMemo(() => {
    const buckets: { label: string; value: number }[] = [
      { label: '0–7', value: 0 },
      { label: '8–14', value: 0 },
      { label: '15–30', value: 0 },
      { label: '31–60', value: 0 },
      { label: '60+', value: 0 },
    ];
    for (const r of page.rows) {
      const d = r.daysInYard;
      if (d <= 7) buckets[0].value += 1;
      else if (d <= 14) buckets[1].value += 1;
      else if (d <= 30) buckets[2].value += 1;
      else if (d <= 60) buckets[3].value += 1;
      else buckets[4].value += 1;
    }
    return buckets;
  }, [page.rows]);
  return (
    <>
      <ReportBarChart data={histogram} title="Days-in-yard distribution" />
      <ReportDataTable rows={page.rows as unknown as Record<string, unknown>[]} columns={cols as unknown as DataTableColumn<Record<string, unknown>>[]} />
    </>
  );
}

function PnlBody({ page }: { page: ReportPage<PnlRow> }): JSX.Element {
  const cols: DataTableColumn<PnlRow>[] = [
    { key: 'label', header: 'Dimension' },
    {
      key: 'revenueCents',
      header: 'Revenue',
      align: 'right',
      format: (r) => `$${(r.revenueCents / 100).toLocaleString()}`,
    },
    {
      key: 'driverCommissionCents',
      header: 'Commission',
      align: 'right',
      format: (r) => `$${(r.driverCommissionCents / 100).toLocaleString()}`,
    },
    {
      key: 'fuelCostCents',
      header: 'Fuel',
      align: 'right',
      format: (r) => `$${(r.fuelCostCents / 100).toLocaleString()}`,
    },
    {
      key: 'truckDepreciationCents',
      header: 'Deprec.',
      align: 'right',
      format: (r) => `$${(r.truckDepreciationCents / 100).toLocaleString()}`,
    },
    {
      key: 'motorClubFeesCents',
      header: 'MC fees',
      align: 'right',
      format: (r) => `$${(r.motorClubFeesCents / 100).toLocaleString()}`,
    },
    {
      key: 'netCents',
      header: 'Net',
      align: 'right',
      format: (r) => `$${(r.netCents / 100).toLocaleString()}`,
    },
  ];
  const top = page.rows.slice(0, 8).map((r) => ({ label: r.label, value: r.netCents }));
  return (
    <>
      <ReportBarChart data={top} title="Net profit (top items)" unit="cents" />
      <ReportDataTable rows={page.rows as unknown as Record<string, unknown>[]} columns={cols as unknown as DataTableColumn<Record<string, unknown>>[]} />
    </>
  );
}

function CommissionBody({ page }: { page: ReportPage<CommissionLineRow> }): JSX.Element {
  const cols: DataTableColumn<CommissionLineRow>[] = [
    { key: 'driverName', header: 'Driver' },
    { key: 'payPeriodKey', header: 'Pay period' },
    { key: 'jobsCount', header: 'Jobs', align: 'right' },
    {
      key: 'grossRevenueCents',
      header: 'Gross',
      align: 'right',
      format: (r) => `$${(r.grossRevenueCents / 100).toLocaleString()}`,
    },
    {
      key: 'netCents',
      header: 'Commission',
      align: 'right',
      format: (r) => `$${(r.netCents / 100).toLocaleString()}`,
    },
  ];
  const byDriver = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of page.rows) m.set(r.driverName, (m.get(r.driverName) ?? 0) + r.netCents);
    return Array.from(m.entries()).map(([label, value]) => ({ label, value }));
  }, [page.rows]);
  return (
    <>
      <ReportBarChart data={byDriver.slice(0, 8)} title="Commission by driver" unit="cents" />
      <ReportDataTable rows={page.rows as unknown as Record<string, unknown>[]} columns={cols as unknown as DataTableColumn<Record<string, unknown>>[]} />
    </>
  );
}

function TaxBody({ page }: { page: ReportPage<TaxRow> }): JSX.Element {
  const cols: DataTableColumn<TaxRow>[] = [
    { key: 'jurisdiction', header: 'Jurisdiction' },
    { key: 'taxName', header: 'Tax' },
    {
      key: 'taxableSalesCents',
      header: 'Taxable',
      align: 'right',
      format: (r) => `$${(r.taxableSalesCents / 100).toLocaleString()}`,
    },
    {
      key: 'taxCollectedCents',
      header: 'Collected',
      align: 'right',
      format: (r) => `$${(r.taxCollectedCents / 100).toLocaleString()}`,
    },
    {
      key: 'exemptSalesCents',
      header: 'Exempt',
      align: 'right',
      format: (r) => `$${(r.exemptSalesCents / 100).toLocaleString()}`,
    },
    { key: 'invoiceCount', header: 'Invoices', align: 'right' },
  ];
  const top = page.rows.slice(0, 8).map((r) => ({ label: r.jurisdiction, value: r.taxCollectedCents }));
  return (
    <>
      <ReportPieChart data={top} title="Tax collected by jurisdiction" />
      <ReportDataTable rows={page.rows as unknown as Record<string, unknown>[]} columns={cols as unknown as DataTableColumn<Record<string, unknown>>[]} />
    </>
  );
}

function ComplianceBody({ page }: { page: ReportPage<ComplianceRow> }): JSX.Element {
  const cols: DataTableColumn<ComplianceRow>[] = [
    { key: 'category', header: 'Category' },
    { key: 'subject', header: 'Subject' },
    { key: 'detail', header: 'Detail' },
    { key: 'daysToBreach', header: 'Days', align: 'right' },
    { key: 'severity', header: 'Severity' },
  ];
  const histogram = useMemo(() => {
    const m: Record<string, number> = { critical: 0, warn: 0, info: 0 };
    for (const r of page.rows) m[r.severity] += 1;
    return Object.entries(m).map(([label, value]) => ({ label, value }));
  }, [page.rows]);
  return (
    <>
      <ReportBarChart data={histogram} title="Issues by severity" />
      <ReportDataTable rows={page.rows as unknown as Record<string, unknown>[]} columns={cols as unknown as DataTableColumn<Record<string, unknown>>[]} />
    </>
  );
}

function SaveDialog({
  state,
  onCancel,
  onChange,
  onSubmit,
}: {
  state: SaveDialogState;
  onCancel: () => void;
  onChange: (patch: Partial<SaveDialogState>) => void;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      data-testid="save-dialog"
    >
      <div className="w-full max-w-md rounded-md border border-steel-border bg-steel-mid p-6">
        <h2 className="mb-3 font-condensed text-lg font-bold uppercase tracking-wide">
          Save & schedule report
        </h2>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-text-secondary">Name</span>
            <input
              value={state.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-text-secondary">Description</span>
            <input
              value={state.description}
              onChange={(e) => onChange({ description: e.target.value })}
              className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-text-secondary">Email recipients (comma-separated)</span>
            <input
              value={state.recipients}
              onChange={(e) => onChange({ recipients: e.target.value })}
              placeholder="ops@example.com, finance@example.com"
              className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-text-secondary">Cadence</span>
              <select
                value={state.cadence}
                onChange={(e) => onChange({ cadence: e.target.value as SaveDialogState['cadence'] })}
                className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="block">
              <span className="text-text-secondary">Hour (UTC)</span>
              <input
                type="number"
                min={0}
                max={23}
                value={state.hourUtc}
                onChange={(e) => onChange({ hourUtc: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="text-text-secondary">Format</span>
              <select
                value={state.format}
                onChange={(e) => onChange({ format: e.target.value as SaveDialogState['format'] })}
                className="mt-1 w-full rounded-md border border-steel-border bg-steel-light/40 px-2 py-1"
              >
                <option value="pdf">PDF</option>
                <option value="csv">CSV</option>
              </select>
            </label>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-steel-border px-3 py-1.5 text-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-orange px-3 py-1.5 text-sm font-bold text-white hover:bg-orange-light"
            onClick={onSubmit}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
