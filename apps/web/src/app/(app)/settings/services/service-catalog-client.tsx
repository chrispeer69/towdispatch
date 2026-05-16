'use client';

/**
 * Client island for /settings/services. Owns the table, filter toolbar,
 * add/edit modal, deactivate flow, and empty-state seed action.
 *
 * Mutations talk to the BFF proxy at /api/service-catalog/* (which talks
 * to /service-catalog on the NestJS API). The proxy handles refresh-on-401
 * cookie rotation so the access token never reaches the browser bundle.
 *
 * Sort order: category -> sort_order -> name. Same ordering as the API,
 * applied client-side so optimistic edits don't briefly re-order rows.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  SERVICE_CALCULATION_UNIT_LABELS,
  SERVICE_CATEGORY_LABELS,
  type ServiceCatalogEntryDto,
  type ServiceCategory,
  serviceCategoryValues,
} from '@ustowdispatch/shared';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ServiceCatalogForm } from './service-catalog-form';

interface Props {
  initial: ServiceCatalogEntryDto[];
  initialCategory: ServiceCategory | null;
  initialActive: boolean | null;
  initialQ: string;
}

type EditState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; entry: ServiceCatalogEntryDto };

const ACTIVE_FILTERS: Array<{ value: boolean | null; label: string }> = [
  { value: null, label: 'All' },
  { value: true, label: 'Active' },
  { value: false, label: 'Inactive' },
];

export function ServiceCatalogClient({
  initial,
  initialCategory,
  initialActive,
  initialQ,
}: Props): JSX.Element {
  const [rows, setRows] = useState<ServiceCatalogEntryDto[]>(initial);
  const [category, setCategory] = useState<ServiceCategory | null>(initialCategory);
  const [active, setActive] = useState<boolean | null>(initialActive);
  const [q, setQ] = useState(initialQ);
  const [editing, setEditing] = useState<EditState>({ mode: 'closed' });
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (category && r.category !== category) return false;
      if (active !== null && r.isActive !== active) return false;
      if (needle) {
        if (!r.name.toLowerCase().includes(needle) && !r.code.toLowerCase().includes(needle)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, category, active, q]);

  const grouped = useMemo(() => {
    const map = new Map<ServiceCategory, ServiceCatalogEntryDto[]>();
    for (const cat of serviceCategoryValues) map.set(cat, []);
    for (const r of filtered) map.get(r.category)?.push(r);
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }
    return map;
  }, [filtered]);

  async function handleSave(payload: Record<string, unknown>, id: string | null): Promise<void> {
    setBusy(true);
    try {
      const url = id ? `/api/service-catalog/${id}` : '/api/service-catalog';
      const method = id ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        const msg = data?.message ?? 'Save failed';
        toast.error(msg);
        return;
      }
      const saved = (await res.json()) as ServiceCatalogEntryDto;
      setRows((prev) => {
        if (id) return prev.map((r) => (r.id === id ? saved : r));
        return [...prev, saved];
      });
      toast.success(id ? 'Service updated' : 'Service created');
      setEditing({ mode: 'closed' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate(entry: ServiceCatalogEntryDto): Promise<void> {
    if (
      !confirm(
        `Deactivate "${entry.name}"? It will be hidden from intake but kept for billing history.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/service-catalog/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(data?.message ?? 'Deactivate failed');
        return;
      }
      // Soft delete on the server flips is_active=false too; mirror that locally
      // so the row stays visible (and switches into the "inactive" cohort) until
      // the next list refresh proves it gone.
      setRows((prev) => prev.map((r) => (r.id === entry.id ? { ...r, isActive: false } : r)));
      toast.success('Service deactivated');
    } finally {
      setBusy(false);
    }
  }

  async function handleSeedDefaults(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch('/api/service-catalog/seed-defaults', { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(data?.message ?? 'Seed failed');
        return;
      }
      const body = (await res.json()) as { inserted: number };
      toast.success(`Seeded ${body.inserted} default services`);
      // Reload the row set so the seeded services appear immediately.
      const listRes = await fetch('/api/service-catalog');
      if (listRes.ok) {
        const list = (await listRes.json()) as ServiceCatalogEntryDto[];
        setRows(list);
      }
    } finally {
      setBusy(false);
    }
  }

  const isEmpty = rows.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="w-full md:w-64">
            <Input
              placeholder="Search by code or name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter by category"
            value={category ?? ''}
            onChange={(e) => setCategory((e.target.value || null) as ServiceCategory | null)}
            className="h-11 rounded-[10px] border border-divider bg-bg-surface px-3 text-sm text-text-primary-on-dark"
          >
            <option value="">All categories</option>
            {serviceCategoryValues.map((c) => (
              <option key={c} value={c}>
                {SERVICE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1.5">
            {ACTIVE_FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setActive(f.value)}
                className={cn(
                  'rounded-[8px] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
                  active === f.value
                    ? 'border-brand-primary/40 bg-brand-primary/15 text-brand-primary'
                    : 'border-divider bg-bg-surface-elevated/40 text-text-secondary-on-dark hover:text-text-primary-on-dark',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={() => setEditing({ mode: 'create' })} disabled={busy}>
          + Add service
        </Button>
      </div>

      {isEmpty ? (
        <div className="rounded-[14px] border border-divider bg-bg-surface p-6 text-center">
          <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            No services yet
          </p>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Seed the 45-row default catalog to get started.
          </p>
          <div className="mt-4 flex justify-center">
            <Button onClick={handleSeedDefaults} disabled={busy}>
              {busy ? 'Seeding…' : 'Seed default services'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([cat, list]) => {
            if (list.length === 0) return null;
            return (
              <section
                key={cat}
                className="overflow-hidden rounded-[14px] border border-divider bg-bg-surface"
              >
                <header className="flex items-center justify-between border-b border-divider px-4 py-2.5">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                    {SERVICE_CATEGORY_LABELS[cat]}
                  </h2>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
                    {list.length}
                  </span>
                </header>
                <table className="w-full table-fixed text-sm" data-testid="service-catalog-table">
                  <colgroup>
                    {/* Fixed-width <colgroup> so every category section
                        aligns column-for-column — fixes the Build 1 width
                        drift caused by per-section auto-layout. */}
                    <col className="w-[14%]" />
                    <col className="w-[22%]" />
                    <col className="w-[14%]" />
                    <col className="w-[20%]" />
                    <col className="w-[7%]" />
                    <col className="w-[8%]" />
                    <col className="w-[6%]" />
                    <col className="w-[9%]" />
                  </colgroup>
                  <thead className="border-b border-divider text-left text-text-secondary-on-dark/60">
                    <tr>
                      <Th>Code</Th>
                      <Th>Name</Th>
                      <Th>Calc unit</Th>
                      <Th>Vehicle classes</Th>
                      <Th>Quoted</Th>
                      <Th>Commission</Th>
                      <Th>Active</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-divider last:border-0 hover:bg-bg-surface-elevated/30"
                      >
                        <Td className="font-mono text-[12px] text-text-primary-on-dark">
                          {r.code}
                        </Td>
                        <Td className="font-medium text-text-primary-on-dark">{r.name}</Td>
                        <Td className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark">
                          {SERVICE_CALCULATION_UNIT_LABELS[r.calculationUnit]}
                          {r.supportsPerResourceMultiplier ? (
                            <span className="ml-1 rounded bg-violet/15 px-1.5 py-0.5 text-[9px] text-violet">
                              ×N
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          {r.applicableVehicleClasses.length === 0 ? (
                            <span className="text-text-secondary-on-dark/60 text-xs">any</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {r.applicableVehicleClasses.map((vc) => (
                                <span
                                  key={vc}
                                  className="rounded bg-bg-surface-elevated/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-secondary-on-dark"
                                >
                                  {vc.replace('_', ' ')}
                                </span>
                              ))}
                            </div>
                          )}
                        </Td>
                        <Td>
                          {r.isQuoted ? (
                            <span className="rounded bg-amber/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-amber">
                              quoted
                            </span>
                          ) : (
                            <span className="text-text-secondary-on-dark/60">—</span>
                          )}
                        </Td>
                        <Td className="font-mono text-[12px]">
                          {r.defaultCommissionPctOverride ? (
                            `${r.defaultCommissionPctOverride}%`
                          ) : (
                            <span className="text-text-secondary-on-dark/60">driver dflt</span>
                          )}
                        </Td>
                        <Td>
                          <span
                            className={cn(
                              'rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]',
                              r.isActive ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger',
                            )}
                          >
                            {r.isActive ? 'yes' : 'no'}
                          </span>
                        </Td>
                        <Td className="px-2 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditing({ mode: 'edit', entry: r })}
                              className="rounded-[6px] border border-divider px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark hover:border-divider-strong hover:text-text-primary-on-dark"
                              disabled={busy}
                            >
                              Edit
                            </button>
                            {r.isActive ? (
                              <button
                                type="button"
                                onClick={() => handleDeactivate(r)}
                                className="whitespace-nowrap rounded-[6px] border border-danger/30 px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-danger hover:bg-danger/10"
                                disabled={busy}
                              >
                                Deactivate
                              </button>
                            ) : null}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}

      {editing.mode !== 'closed' ? (
        <ServiceCatalogForm
          mode={editing.mode}
          initial={editing.mode === 'edit' ? editing.entry : undefined}
          busy={busy}
          onSubmit={(payload) =>
            handleSave(payload, editing.mode === 'edit' ? editing.entry.id : null)
          }
          onClose={() => setEditing({ mode: 'closed' })}
        />
      ) : null}
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
  return <td className={cn('px-4 py-3 align-middle', className)}>{children}</td>;
}
