'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { type PaginatedTrucks, type TruckStatus, truckStatusValues } from '@towcommand/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

interface Props {
  initial: PaginatedTrucks;
  initialQuery: { q?: string; status?: string };
}

export function TruckListClient({ initial, initialQuery }: Props): JSX.Element {
  const [q, setQ] = useState(initialQuery.q ?? '');
  const [status, setStatus] = useState<TruckStatus | ''>(
    (initialQuery.status as TruckStatus) ?? '',
  );
  const [data, setData] = useState<PaginatedTrucks>(initial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      params.set('perPage', '50');
      // Guard against the BFF returning a 4xx/5xx error body. The /api/fleet/*
      // BFF returns `{ code, message, errors }` on failure — assigning that
      // shape to `data` would make the next render crash on `data.data.length`
      // and trip the error boundary with "Something went wrong". Mirrors the
      // CustomerListClient pattern.
      void fetch(`/api/fleet/trucks?${params.toString()}`)
        .then(async (r) => {
          if (!r.ok) return;
          const j = (await r.json()) as PaginatedTrucks;
          setData(j);
        })
        .catch(() => {});
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Input
          placeholder="Search by unit, VIN, plate, make/model"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="md:max-w-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={status === ''} onClick={() => setStatus('')}>
            All
          </FilterPill>
          {truckStatusValues.map((s) => (
            <FilterPill key={s} active={status === s} onClick={() => setStatus(s)}>
              {s.replace('_', ' ')}
            </FilterPill>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-steel-border bg-steel-mid">
        <table className="w-full text-sm" data-testid="trucks-table">
          <thead className="border-b border-steel-border text-left text-text-muted">
            <tr>
              <Th>Unit</Th>
              <Th>Type / Capacity</Th>
              <Th>VIN</Th>
              <Th>Status</Th>
              <Th className="text-right">Odometer</Th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-text-secondary">
                  No trucks match those filters.
                </td>
              </tr>
            ) : (
              data.data.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-steel-border last:border-b-0 hover:bg-steel-light/40"
                >
                  <Td>
                    <Link
                      href={`/fleet/trucks/${t.id}`}
                      className="font-semibold text-text-primary hover:text-orange-light"
                    >
                      {t.unitNumber}
                    </Link>
                    {t.make ? (
                      <p className="text-xs text-text-muted">
                        {t.year ?? ''} {t.make} {t.model ?? ''}
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
                      {t.truckType.replace('_', ' ')}
                    </span>
                    {t.capacityClass ? (
                      <span className="ml-1 text-text-muted">· {t.capacityClass}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="font-mono text-[11px] text-text-secondary">
                      {t.vin ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    <StatusBadge status={t.status} />
                  </Td>
                  <Td className="text-right font-mono text-[12px] text-text-secondary">
                    {t.currentOdometer !== null ? `${t.currentOdometer.toLocaleString()} mi` : '—'}
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

function StatusBadge({ status }: { status: TruckStatus }): JSX.Element {
  const palette: Record<TruckStatus, string> = {
    active: 'bg-emerald-500/15 text-emerald-300',
    in_maintenance: 'bg-amber-500/15 text-amber-300',
    out_of_service: 'bg-red-500/15 text-red-300',
    retired: 'bg-steel-light text-text-muted',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]',
        palette[status],
      )}
    >
      {status.replace('_', ' ')}
    </span>
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
