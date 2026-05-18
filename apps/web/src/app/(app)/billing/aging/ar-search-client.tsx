'use client';

/**
 * A/R search workspace — client island. Renders the filter bar, the
 * results table (with sortable headers + row selection for bulk
 * actions), and the sticky summary footer.
 *
 * Filter state lives in the URL so a browser refresh / share-the-link
 * yields the same view. Sorting, pagination, and bulk actions trigger
 * router.replace so the URL updates without a full page reload.
 *
 * "Past due" is rendered in red across status chip + balance column.
 * Bulk actions defer to existing /api/billing endpoints (reminder
 * email, mark sent) — the workspace itself is read-mostly.
 */
import { Button } from '@/components/ui/button';
import { CustomerLink, InvoiceLink, JobLink } from '@/components/ui/entity-link';
import { Input } from '@/components/ui/input';
import {
  type ArSearchResponse,
  type ArSearchRow,
  type ArStatusFilter,
  arStatusFilterValues,
} from '@ustowdispatch/shared';
import { AlertTriangle, FileSpreadsheet, Printer, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type JSX, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  initial: ArSearchResponse;
  initialFilters: {
    statuses: string;
    dateField: 'issued_at' | 'due_at' | 'created_at' | 'paid_at';
    dateFrom: string;
    dateTo: string;
    q: string;
    accountIds: string;
    minAmountCents: string;
    maxAmountCents: string;
  };
  accounts: Array<{ id: string; name: string; isMotorClub: boolean }>;
  errorMessage: string | null;
}

const STATUS_LABELS: Record<ArStatusFilter, string> = {
  draft: 'Draft',
  issued: 'Posted',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  past_due: 'Past due',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Voided',
  refunded: 'Refunded',
};

const DATE_FIELDS: Array<{
  value: 'issued_at' | 'due_at' | 'created_at' | 'paid_at';
  label: string;
}> = [
  { value: 'issued_at', label: 'Posted date' },
  { value: 'due_at', label: 'Due date' },
  { value: 'created_at', label: 'Created date' },
  { value: 'paid_at', label: 'Paid date' },
];

const DEFAULT_ACTIVE: ArStatusFilter[] = [
  'issued',
  'sent',
  'partially_paid',
  'past_due',
  'overdue',
];

export function ArSearchClient({
  initial,
  initialFilters,
  accounts,
  errorMessage,
}: Props): JSX.Element {
  const router = useRouter();
  const sp = useSearchParams();

  const [statuses, setStatuses] = useState<ArStatusFilter[]>(() =>
    initialFilters.statuses
      ? (initialFilters.statuses
          .split(',')
          .filter((s) =>
            (arStatusFilterValues as readonly string[]).includes(s),
          ) as ArStatusFilter[])
      : DEFAULT_ACTIVE,
  );
  const [dateField, setDateField] = useState(initialFilters.dateField);
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom);
  const [dateTo, setDateTo] = useState(initialFilters.dateTo);
  const [q, setQ] = useState(initialFilters.q);
  const [accountIds, setAccountIds] = useState<string[]>(() =>
    initialFilters.accountIds ? initialFilters.accountIds.split(',') : [],
  );
  const [minAmount, setMinAmount] = useState(initialFilters.minAmountCents);
  const [maxAmount, setMaxAmount] = useState(initialFilters.maxAmountCents);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyBulk, setBusyBulk] = useState(false);

  const offset = Number(sp.get('offset') ?? '0');
  const limit = Number(sp.get('limit') ?? '50');

  const applyFilters = (overrides: Partial<typeof initialFilters> = {}): void => {
    const params = new URLSearchParams();
    const merged = {
      statuses: statuses.join(','),
      dateField,
      dateFrom,
      dateTo,
      q,
      accountIds: accountIds.join(','),
      minAmountCents: minAmount,
      maxAmountCents: maxAmount,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && String(v).length > 0) params.set(k, String(v));
    }
    // Reset pagination on filter change unless the caller is paginating.
    if (!('limit' in overrides) && !('offset' in overrides)) {
      params.delete('offset');
    }
    router.replace(`?${params.toString()}`);
  };

  const resetFilters = (): void => {
    setStatuses(DEFAULT_ACTIVE);
    setDateField('issued_at');
    setDateFrom('');
    setDateTo('');
    setQ('');
    setAccountIds([]);
    setMinAmount('');
    setMaxAmount('');
    router.replace('?');
  };

  const toggleStatus = (s: ArStatusFilter): void => {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllOnPage = (): void => {
    setSelected(new Set(initial.rows.map((r) => r.id)));
  };
  const clearSelection = (): void => setSelected(new Set());

  const sortableHeaders: Array<{
    key: 'issued_at' | 'invoice_number' | 'total_cents' | 'balance_cents' | 'due_at';
    label: string;
    align?: 'right';
  }> = [
    { key: 'invoice_number', label: 'Invoice #' },
    { key: 'issued_at', label: 'Date' },
    { key: 'due_at', label: 'Due' },
    { key: 'total_cents', label: 'Total', align: 'right' },
    { key: 'balance_cents', label: 'Balance', align: 'right' },
  ];

  const sortBy = sp.get('sortBy') ?? 'issued_at';
  const sortDir = sp.get('sortDir') ?? 'desc';
  const onSort = (key: string): void => {
    const nextDir = sortBy === key && sortDir === 'desc' ? 'asc' : 'desc';
    const params = new URLSearchParams(sp.toString());
    params.set('sortBy', key);
    params.set('sortDir', nextDir);
    router.replace(`?${params.toString()}`);
  };

  const onlyOneAccount = useMemo((): string | null => {
    const set = new Set<string>();
    for (const r of initial.rows) if (r.accountId) set.add(r.accountId);
    return set.size === 1 ? (Array.from(set)[0] ?? null) : null;
  }, [initial.rows]);

  const bulkReminder = async (): Promise<void> => {
    if (selected.size === 0) return;
    setBusyBulk(true);
    try {
      const ids = Array.from(selected);
      const res = await fetch('/api/ar/bulk-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_reminder', invoiceIds: ids }),
      });
      if (!res.ok) {
        toast.error(`Reminder send failed (${res.status})`);
        return;
      }
      toast.success(`Reminder queued for ${ids.length} invoices`);
      clearSelection();
    } finally {
      setBusyBulk(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-condensed text-xl font-extrabold uppercase tracking-tight">
            A/R workspace
          </h1>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Search, triage, and act on invoices. {initial.summary.invoiceCount} of {initial.total}{' '}
            match these filters.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/billing/aging/reports"
            className="rounded-md border border-divider bg-bg-surface-elevated px-3 py-1.5 text-sm hover:bg-divider"
          >
            Reports →
          </a>
          <a
            href="/billing/statements"
            className="rounded-md border border-divider bg-bg-surface-elevated px-3 py-1.5 text-sm hover:bg-divider"
          >
            Statements →
          </a>
        </div>
      </header>

      {errorMessage ? (
        <div className="flex items-start gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
          <p className="text-text-secondary-on-dark">{errorMessage}</p>
        </div>
      ) : null}

      {/* Filter bar */}
      <div className="sticky top-0 z-10 -mx-2 space-y-3 rounded-lg border border-divider bg-bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
            Status
          </span>
          {arStatusFilterValues.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => toggleStatus(s)}
              className={`rounded-full px-2.5 py-0.5 text-xs uppercase tracking-wider transition ${
                statuses.includes(s)
                  ? s === 'past_due'
                    ? 'bg-danger text-white'
                    : 'bg-bg-surface-elevated text-text-primary-on-dark'
                  : 'bg-bg-base text-text-secondary-on-dark hover:bg-bg-surface-elevated'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Date field
            </span>
            <select
              value={dateField}
              onChange={(e) => setDateField(e.target.value as typeof dateField)}
              className="w-full rounded-md border border-divider bg-bg-base px-2 py-1.5 text-sm"
            >
              {DATE_FIELDS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              From
            </span>
            <Input
              type="date"
              value={dateFrom.slice(0, 10)}
              onChange={(e) => setDateFrom(e.target.value ? `${e.target.value}T00:00:00Z` : '')}
            />
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              To
            </span>
            <Input
              type="date"
              value={dateTo.slice(0, 10)}
              onChange={(e) => setDateTo(e.target.value ? `${e.target.value}T23:59:59Z` : '')}
            />
          </div>
          <div className="md:col-span-2">
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Search (invoice #, customer, account)
            </span>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Acme, INV-2026-…"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <div className="md:col-span-2">
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Account
            </span>
            <select
              multiple
              value={accountIds}
              onChange={(e) =>
                setAccountIds(Array.from(e.target.selectedOptions, (o) => o.value).filter(Boolean))
              }
              className="h-20 w-full rounded-md border border-divider bg-bg-base px-2 py-1.5 text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.isMotorClub ? '(MC)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Min $
            </span>
            <Input
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
              Max $
            </span>
            <Input
              type="number"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder="∞"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => applyFilters()} className="">
            Apply
          </Button>
          <Button onClick={resetFilters} variant="ghost">
            Reset
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Print
            </Button>
            <button
              type="button"
              onClick={() => toast.info('Use Reports → Export for filtered Excel')}
              className="inline-flex items-center rounded-md border border-divider bg-bg-surface-elevated px-3 py-1.5 text-sm hover:bg-divider"
            >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel
            </button>
            {onlyOneAccount ? (
              <a
                href={`/billing/statements?accountId=${onlyOneAccount}`}
                className="inline-flex items-center rounded-md border border-divider bg-orange/20 px-3 py-1.5 text-sm text-orange hover:bg-orange/30"
              >
                <Send className="mr-1.5 h-4 w-4" /> Generate statement
              </a>
            ) : (
              <button
                type="button"
                onClick={() => toast.info('Filter to a single account first.')}
                className="inline-flex cursor-not-allowed items-center rounded-md border border-divider bg-bg-surface-elevated px-3 py-1.5 text-sm text-text-secondary-on-dark"
              >
                <Send className="mr-1.5 h-4 w-4" /> Generate statement
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-orange/40 bg-orange/10 px-3 py-2 text-sm">
          <span>{selected.size} selected — bulk:</span>
          <div className="flex gap-2">
            <Button onClick={bulkReminder} disabled={busyBulk}>
              Send reminder email
            </Button>
            <Button onClick={clearSelection} variant="ghost">
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {/* Results table */}
      <div className="overflow-x-auto rounded-lg border border-divider">
        <table className="w-full text-sm" data-testid="ar-search-table">
          <thead className="bg-bg-surface/60 text-left">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.size === initial.rows.length && initial.rows.length > 0}
                  onChange={(e) => (e.target.checked ? selectAllOnPage() : clearSelection())}
                />
              </th>
              {sortableHeaders.map((h) => (
                <th
                  key={h.key}
                  className={`px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark ${
                    h.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(h.key)}
                    className={`cursor-pointer uppercase tracking-wider ${
                      h.align === 'right' ? 'w-full text-right' : 'w-full text-left'
                    }`}
                  >
                    {h.label}
                    {sortBy === h.key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark">
                Account
              </th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark">
                Status
              </th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark text-right">
                Days
              </th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-secondary-on-dark">
                Driver / Job
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {initial.rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-12 text-center text-text-secondary-on-dark">
                  No invoices match these filters.{' '}
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="underline hover:text-orange"
                  >
                    Reset filters
                  </button>
                  .
                </td>
              </tr>
            ) : (
              initial.rows.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  selected={selected.has(r.id)}
                  onToggle={() => toggleSelected(r.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-text-secondary-on-dark">
        <span>
          Showing {Math.min(initial.rows.length, limit)} of {initial.total} · offset {offset}
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={offset <= 0}
            onClick={() => {
              const params = new URLSearchParams(sp.toString());
              params.set('offset', String(Math.max(0, offset - limit)));
              router.replace(`?${params.toString()}`);
            }}
          >
            Prev
          </Button>
          <Button
            variant="ghost"
            disabled={offset + limit >= initial.total}
            onClick={() => {
              const params = new URLSearchParams(sp.toString());
              params.set('offset', String(offset + limit));
              router.replace(`?${params.toString()}`);
            }}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Summary footer */}
      <div className="sticky bottom-2 grid grid-cols-2 gap-2 rounded-lg border border-divider bg-bg-surface p-3 text-sm md:grid-cols-5">
        <Tile label="Invoices" value={initial.summary.invoiceCount.toString()} />
        <Tile label="Billed" value={formatMoney(initial.summary.totalBilledCents)} />
        <Tile label="Paid" value={formatMoney(initial.summary.totalPaidCents)} />
        <Tile label="Outstanding" value={formatMoney(initial.summary.totalOutstandingCents)} />
        <Tile
          label="Past due"
          value={formatMoney(initial.summary.totalPastDueCents)}
          danger={initial.summary.totalPastDueCents > 0}
        />
      </div>
    </div>
  );
}

function Row({
  row,
  selected,
  onToggle,
}: {
  row: ArSearchRow;
  selected: boolean;
  onToggle: () => void;
}): JSX.Element {
  const past = row.isPastDue;
  return (
    <tr className={past ? 'bg-danger/5' : undefined}>
      <td className="px-3 py-2">
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </td>
      <td className="px-3 py-2 font-mono">
        <InvoiceLink invoiceId={row.id} className="text-orange hover:underline">
          {row.invoiceNumber}
        </InvoiceLink>
      </td>
      <td className="px-3 py-2">{row.issuedAt ? row.issuedAt.slice(0, 10) : '—'}</td>
      <td className="px-3 py-2">{row.dueAt ? row.dueAt.slice(0, 10) : '—'}</td>
      <td className="px-3 py-2 text-right font-mono">{formatMoney(row.totalCents)}</td>
      <td className={`px-3 py-2 text-right font-mono ${past ? 'font-bold text-danger' : ''}`}>
        {formatMoney(row.balanceCents)}
      </td>
      <td className="px-3 py-2">
        <span className="block text-sm">
          {row.accountId && row.accountName ? (
            <Link href={`/accounts/${row.accountId}`} className="hover:text-brand-primary hover:underline underline-offset-2 transition-colors">
              {row.accountName}
            </Link>
          ) : row.customerId && row.customerName ? (
            <CustomerLink customerId={row.customerId}>{row.customerName}</CustomerLink>
          ) : (
            <span>{row.customerName ?? 'Cash'}</span>
          )}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-text-secondary-on-dark">
          {row.customerType.replace('_', ' ')}
        </span>
      </td>
      <td className="px-3 py-2">
        <StatusChip status={row.status} pastDue={past} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {past ? `+${row.daysOverdue}d` : '—'}
      </td>
      <td className="px-3 py-2 text-xs">
        {row.driverNames.join(', ') || '—'}
        {row.jobId && row.jobNumber ? (
          <JobLink jobId={row.jobId} className="ml-1 text-orange hover:underline">
            #{row.jobNumber}
          </JobLink>
        ) : null}
      </td>
    </tr>
  );
}

function StatusChip({ status, pastDue }: { status: string; pastDue: boolean }): JSX.Element {
  if (pastDue) {
    return (
      <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
        Past due
      </span>
    );
  }
  const color =
    status === 'paid'
      ? 'bg-green-700 text-white'
      : status === 'void' || status === 'refunded'
        ? 'bg-bg-surface-elevated text-text-secondary-on-dark'
        : status === 'overdue'
          ? 'bg-danger text-white'
          : 'bg-bg-surface-elevated text-text-primary-on-dark';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${color}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function Tile({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}): JSX.Element {
  return (
    <div className="rounded border border-divider p-2">
      <p className="text-[10px] uppercase tracking-wider text-text-secondary-on-dark">{label}</p>
      <p className={`mt-0.5 font-mono text-lg ${danger ? 'font-bold text-danger' : ''}`}>{value}</p>
    </div>
  );
}

function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
}
