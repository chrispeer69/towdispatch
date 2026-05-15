'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  type DriverEmploymentStatus,
  type PaginatedDrivers,
  driverEmploymentStatusValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

interface Props {
  initial: PaginatedDrivers;
  initialQuery: { q?: string; employmentStatus?: string };
}

export function DriverListClient({ initial, initialQuery }: Props): JSX.Element {
  const [q, setQ] = useState(initialQuery.q ?? '');
  const [empStatus, setEmpStatus] = useState<DriverEmploymentStatus | ''>(
    (initialQuery.employmentStatus as DriverEmploymentStatus) ?? '',
  );
  const [data, setData] = useState<PaginatedDrivers>(initial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Skip first effect — SSR already seeded `initial` with this same query.
  const skipFirstRef = useRef(true);

  useEffect(() => {
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (empStatus) params.set('employmentStatus', empStatus);
      params.set('perPage', '50');
      // Guard against the BFF returning a 4xx/5xx error body. The /api/fleet/*
      // BFF returns `{ code, message, errors }` on failure — assigning that
      // shape to `data` would make the next render crash on `data.data.length`
      // and trip the error boundary with "Something went wrong". Mirrors the
      // CustomerListClient pattern.
      void fetch(`/api/fleet/drivers?${params.toString()}`)
        .then(async (r) => {
          if (!r.ok) return;
          const j = (await r.json().catch(() => null)) as PaginatedDrivers | null;
          if (j && Array.isArray(j.data)) setData(j);
        })
        .catch(() => {});
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, empStatus]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Input
          placeholder="Search by name, email, phone, employee #"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="md:max-w-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={empStatus === ''} onClick={() => setEmpStatus('')}>
            All
          </FilterPill>
          {driverEmploymentStatusValues.map((s) => (
            <FilterPill key={s} active={empStatus === s} onClick={() => setEmpStatus(s)}>
              {s.replace('_', ' ')}
            </FilterPill>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-divider bg-bg-surface">
        <table className="w-full text-sm" data-testid="drivers-table">
          <thead className="border-b border-divider text-left text-text-secondary-on-dark-on-dark/60">
            <tr>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th>CDL</Th>
              <Th>Status</Th>
              <Th className="text-right">Hired</Th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-text-secondary-on-dark">
                  No drivers match those filters.
                </td>
              </tr>
            ) : (
              data.data.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-divider last:border-b-0 hover:bg-bg-surface-elevated/40"
                >
                  <Td>
                    <Link
                      href={`/fleet/drivers/${d.id}`}
                      className="font-semibold text-text-primary-on-dark hover:text-brand-primary"
                    >
                      {d.preferredName ?? d.firstName} {d.lastName}
                    </Link>
                    {d.email ? (
                      <p className="text-xs text-text-secondary-on-dark-on-dark/60">{d.email}</p>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="font-mono text-[12px] text-text-secondary-on-dark">
                      {d.phone ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                      {d.cdlClass}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]',
                        d.employmentStatus === 'active'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : d.employmentStatus === 'on_leave'
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-bg-surface-elevated text-text-secondary-on-dark-on-dark/60',
                      )}
                    >
                      {d.employmentStatus.replace('_', ' ')}
                    </span>
                  </Td>
                  <Td className="text-right font-mono text-[12px] text-text-secondary-on-dark-on-dark/60">
                    {d.hiredAt ?? '—'}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[8px] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
        active
          ? 'border-brand-primary/40 bg-brand-primary/15 text-brand-primary'
          : 'border-divider bg-bg-surface-elevated/40 text-text-secondary-on-dark hover:text-text-primary-on-dark',
      )}
    >
      {children}
    </button>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <th
      className={cn(
        'px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] font-medium',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return <td className={cn('px-4 py-3', className)}>{children}</td>;
}
