'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CustomerType, PaginatedCustomers } from '@towcommand/shared';
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

  useEffect(() => {
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
      if (res.ok) {
        const json = (await res.json()) as PaginatedCustomers;
        setData(json);
      }
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
                  ? 'border-orange/40 bg-orange/15 text-orange-light'
                  : 'border-steel-border bg-steel-light/40 text-text-secondary hover:text-text-primary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-steel-border bg-steel-mid">
        <table className="w-full text-sm" data-testid="customers-table">
          <thead className="border-b border-steel-border text-left text-text-muted">
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
                  <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary">
                    No customers yet.
                  </p>
                  <p className="mt-1 text-sm text-text-secondary">
                    Add your first customer to start dispatching jobs.
                  </p>
                </td>
              </tr>
            ) : empty ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-text-secondary">
                  No customers match those filters.
                </td>
              </tr>
            ) : (
              data.data.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-steel-border last:border-0 hover:bg-steel-light/30"
                >
                  <Td>
                    <Link href={`/customers/${c.id}`} className="font-medium text-text-primary">
                      {c.name}
                    </Link>
                  </Td>
                  <Td>{c.phone ?? <span className="text-text-muted">—</span>}</Td>
                  <Td>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                      {c.type}
                    </span>
                  </Td>
                  <Td>{c.email ?? <span className="text-text-muted">—</span>}</Td>
                  <Td className="text-right font-mono text-[11px] text-text-muted">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>
          Showing {data.data.length} of {data.total}
          {loading ? ' · loading…' : ''}
        </span>
        <span className="font-mono">
          page {data.page} · {data.perPage}/page
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
