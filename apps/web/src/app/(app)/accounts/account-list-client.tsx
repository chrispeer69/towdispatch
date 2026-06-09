'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { PaginatedAccounts } from '@towdispatch/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const MOTOR_CLUB_FILTERS: Array<{ value: boolean | null; label: string }> = [
  { value: null, label: 'All' },
  { value: false, label: 'Commercial' },
  { value: true, label: 'Motor club' },
];

interface Props {
  initial: PaginatedAccounts;
  initialQ: string;
  initialIsMotorClub: boolean | null;
}

export function AccountListClient({ initial, initialQ, initialIsMotorClub }: Props): JSX.Element {
  const [q, setQ] = useState(initialQ);
  const [isMotorClub, setIsMotorClub] = useState<boolean | null>(initialIsMotorClub);
  const [data, setData] = useState<PaginatedAccounts>(initial);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Skip the first effect run — SSR already seeded `initial` with this same
  // query. Mirrors CustomerListClient; same rationale.
  const skipFirstRef = useRef(true);

  useEffect(() => {
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void refetch(q, isMotorClub);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, isMotorClub]);

  async function refetch(query: string, mc: boolean | null): Promise<void> {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (mc !== null) params.set('isMotorClub', String(mc));
      params.set('perPage', '50');
      const res = await fetch(`/api/accounts?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const json = (await res.json().catch(() => null)) as PaginatedAccounts | null;
      if (json && Array.isArray(json.data)) setData(json);
    } finally {
      setLoading(false);
    }
  }

  const empty = data.data.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-sm">
          <Input
            placeholder="Search by account name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MOTOR_CLUB_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setIsMotorClub(f.value)}
              className={cn(
                'rounded-[8px] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
                isMotorClub === f.value
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
        <table className="w-full text-sm" data-testid="accounts-table">
          <thead className="border-b border-divider text-left text-text-secondary-on-dark-on-dark/60">
            <tr>
              <Th>Name</Th>
              <Th>Terms</Th>
              <Th>Credit</Th>
              <Th>Active</Th>
              <Th>Motor club</Th>
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
                    No accounts yet.
                  </p>
                  <p className="mt-1 text-sm text-text-secondary-on-dark">
                    Add your first account so commercial jobs can be billed properly.
                  </p>
                </td>
              </tr>
            ) : (
              data.data.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-divider last:border-0 hover:bg-bg-surface-elevated/30"
                >
                  <Td>
                    <Link
                      href={`/accounts/${a.id}`}
                      className="font-medium text-text-primary-on-dark"
                    >
                      {a.name}
                    </Link>
                  </Td>
                  <Td className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark-on-dark/60">
                    {a.billingTerms}
                  </Td>
                  <Td>
                    <span className="font-mono text-[12px]">
                      ${a.creditUsed} / {a.creditLimit ? `$${a.creditLimit}` : '∞'}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        'rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]',
                        a.active ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger',
                      )}
                    >
                      {a.active ? 'yes' : 'no'}
                    </span>
                  </Td>
                  <Td>
                    {a.isMotorClub ? (
                      <span className="rounded bg-violet/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-violet">
                        {a.motorClubNetworkCode ?? 'club'}
                      </span>
                    ) : (
                      <span className="text-text-secondary-on-dark-on-dark/60">—</span>
                    )}
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
