'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CustomerType, PaginatedCustomers } from '@ustowdispatch/shared';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

const TYPE_FILTERS: Array<{ value: CustomerType | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 'cash', label: 'Cash' },
  { value: 'account', label: 'Account' },
];

interface Props {
  initial: PaginatedCustomers;
  initialQ: string;
  initialType: CustomerType | null;
}

export function CustomerListClient({ initial, initialQ, initialType }: Props): JSX.Element {
  const [q, setQ] = useState(initialQ);
  const [type, setType] = useState<CustomerType | null>(initialType);
  const [data, setData] = useState<PaginatedCustomers>(initial);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Skip the first effect run: the server component already fetched with the
  // same q/type and seeded `initial`. Re-running the same query on mount is
  // wasted work, and worse — if the BFF flakes or its response shape ever
  // drifts, we'd overwrite a good SSR render with empty state. The effect
  // still fires on every subsequent change to q or type.
  const skipFirstRef = useRef(true);

  useEffect(() => {
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void refetch(q, type);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type]);

  async function refetch(query: string, filterType: CustomerType | null): Promise<void> {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (filterType) params.set('type', filterType);
      params.set('perPage', '50');
      const res = await fetch(`/api/customers?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      // Guard against the BFF returning a non-list shape (e.g. an error
      // envelope on an unexpected 200). Assigning that to data would crash
      // the next render on `data.data.length`.
      const json = (await res.json().catch(() => null)) as PaginatedCustomers | null;
      if (json && Array.isArray(json.data)) setData(json);
    } finally {
      setLoading(false);
    }
  }

  const empty = data.data.length === 0;
  const showHelpEmpty = useMemo(() => empty && q === '' && type === null, [empty, q, type]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-sm">
          <Input
            placeholder="Search by name, phone, email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setType(f.value)}
              className={cn(
                'rounded-[8px] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
                type === f.value
                  ? 'border-brand-primary/40 bg-brand-primary/15 text-brand-primary'
                  : 'border-divider bg-bg-surface-elevated/40 text-text-secondary-on-dark hover:text-text-primary-on-dark',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-divider bg-bg-surface">
        <table className="w-full text-sm" data-testid="customers-table">
          <thead className="border-b border-divider text-left text-text-secondary-on-dark-on-dark/60">
            <tr>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th>Type</Th>
              <Th>Email</Th>
              <Th className="text-right">Created</Th>
            </tr>
          </thead>
          <tbody>
            {showHelpEmpty ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
                    No customers yet.
                  </p>
                  <p className="mt-1 text-sm text-text-secondary-on-dark">
                    Add your first customer to start dispatching jobs.
                  </p>
                </td>
              </tr>
            ) : empty ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No customers match those filters.
                </td>
              </tr>
            ) : (
              data.data.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-divider last:border-0 hover:bg-bg-surface-elevated/30"
                >
                  <Td>
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium text-text-primary-on-dark"
                    >
                      {c.name}
                    </Link>
                  </Td>
                  <Td>
                    {c.phone ?? <span className="text-text-secondary-on-dark-on-dark/60">—</span>}
                  </Td>
                  <Td>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
                      {c.type}
                    </span>
                  </Td>
                  <Td>
                    {c.email ?? <span className="text-text-secondary-on-dark-on-dark/60">—</span>}
                  </Td>
                  <Td className="text-right font-mono text-[11px] text-text-secondary-on-dark-on-dark/60">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-text-secondary-on-dark-on-dark/60">
        <span>
          Showing {data.data.length} of {data.total}
          {loading ? ' - loading…' : ''}
        </span>
        <span className="font-mono">
          page {data.page} - {data.perPage}/page
        </span>
      </div>
    </div>
  );
}

function Th({
  children,
  className,
}: { children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <th className={cn('px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em]', className)}>
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: { children: React.ReactNode; className?: string }): JSX.Element {
  return <td className={cn('px-4 py-3', className)}>{children}</td>;
}
