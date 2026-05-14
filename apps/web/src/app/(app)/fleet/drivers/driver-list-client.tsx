'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  type DriverEmploymentStatus,
  type PaginatedDrivers,
  driverEmploymentStatusValues,
} from '@towcommand/shared';
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

  // [FLEET_DEBUG] — temporary diagnostic. Revert after the fleet bounce is fixed.
  useEffect(() => {
    console.error(
      `[FLEET_DEBUG] DriverListClient mount initialTotal=${initial.total} href=${typeof window !== 'undefined' ? window.location.href : 'n/a'}`,
    );
  }, [initial.total]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (empStatus) params.set('employmentStatus', empStatus);
      params.set('perPage', '50');
      console.error(
        `[FLEET_DEBUG] DriverListClient debounce-fetch /api/fleet/drivers?${params.toString()}`,
      );
      void fetch(`/api/fleet/drivers?${params.toString()}`)
        .then((r) => {
          console.error(
            `[FLEET_DEBUG] DriverListClient debounce-fetch status=${r.status} ok=${r.ok}`,
          );
          return r.json();
        })
        .then((j: PaginatedDrivers) => setData(j))
        .catch((err) => {
          console.error('[FLEET_DEBUG] DriverListClient debounce-fetch err', err);
        });
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

      <div className="overflow-hidden rounded-[14px] border border-steel-border bg-steel-mid">
        <table className="w-full text-sm" data-testid="drivers-table">
          <thead className="border-b border-steel-border text-left text-text-muted">
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
                <td colSpan={5} className="px-4 py-12 text-center text-text-secondary">
                  No drivers match those filters.
                </td>
              </tr>
            ) : (
              data.data.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-steel-border last:border-b-0 hover:bg-steel-light/40"
                >
                  <Td>
                    <Link
                      href={`/fleet/drivers/${d.id}`}
                      className="font-semibold text-text-primary hover:text-orange-light"
                    >
                      {d.preferredName ?? d.firstName} {d.lastName}
                    </Link>
                    {d.email ? <p className="text-xs text-text-muted">{d.email}</p> : null}
                  </Td>
                  <Td>
                    <span className="font-mono text-[12px] text-text-secondary">
                      {d.phone ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
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
                            : 'bg-steel-light text-text-muted',
                      )}
                    >
                      {d.employmentStatus.replace('_', ' ')}
                    </span>
                  </Td>
                  <Td className="text-right font-mono text-[12px] text-text-muted">
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
          ? 'border-orange/40 bg-orange/15 text-orange-light'
          : 'border-steel-border bg-steel-light/40 text-text-secondary hover:text-text-primary',
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
