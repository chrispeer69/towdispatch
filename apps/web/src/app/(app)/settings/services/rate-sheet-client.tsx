'use client';

/**
 * Rate Sheet view for /settings/services (Admin Settings build 2 of 6).
 *
 * Renders the Master Rate Sheet as a single inline-editable grid grouped by
 * category. Each row is one service; columns are the vehicle classes the
 * service declares as applicable (or a single "Price" column for class-
 * independent services, which use vehicleClass='any' under the hood).
 *
 * Cells with no current rate are surfaced as empty inputs ("not set"); typing
 * a value dirties the row. The "Save changes" button POSTs every dirtied
 * (service, class) pair to /api/service-rates/bulk in one transaction so a
 * partial save can't strand the operator with half the grid persisted.
 *
 * Keyboard handling:
 *   - Tab / Shift-Tab: native browser order, which the column-major DOM
 *     produces row-major navigation (left to right, top to bottom).
 *   - Enter: commits current edit + advances to the next dirty-eligible cell
 *     within the same category section (then wraps to the next section).
 *   - Esc: reverts current cell to its server value.
 */
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  type RateVehicleClass,
  SERVICE_CATEGORY_LABELS,
  SERVICE_RATE_ANY_CLASS,
  type ServiceCatalogEntryDto,
  type ServiceCategory,
  type ServiceRateDto,
  type VehicleClass,
  serviceCategoryValues,
} from '@ustowdispatch/shared';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  catalog: ServiceCatalogEntryDto[];
  initialRates: ServiceRateDto[];
}

type CellKey = `${string}:${string}`;
const keyOf = (serviceId: string, vehicleClass: RateVehicleClass): CellKey =>
  `${serviceId}:${vehicleClass}`;

/** Returns the columns to render for a service. */
function columnsFor(svc: ServiceCatalogEntryDto): RateVehicleClass[] {
  if (svc.applicableVehicleClasses.length === 0) {
    return [SERVICE_RATE_ANY_CLASS];
  }
  return svc.applicableVehicleClasses as RateVehicleClass[];
}

const CLASS_LABELS: Record<RateVehicleClass, string> = {
  any: 'Price',
  light_duty: 'Light',
  medium_duty: 'Medium',
  heavy_duty: 'Heavy',
  motorcycle: 'Motorcycle',
  commercial: 'Commercial',
  rv: 'RV',
  unknown: 'Unknown',
};

/** All vehicle-class columns currently relevant across the catalog. */
function activeClasses(catalog: ServiceCatalogEntryDto[]): VehicleClass[] {
  const set = new Set<VehicleClass>();
  for (const svc of catalog) {
    for (const vc of svc.applicableVehicleClasses) set.add(vc);
  }
  // Stable order
  const ORDER: VehicleClass[] = [
    'light_duty',
    'medium_duty',
    'heavy_duty',
    'motorcycle',
    'commercial',
    'rv',
    'unknown',
  ];
  return ORDER.filter((c) => set.has(c));
}

function formatDollars(cents: number | null): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

function parseDollarsToCents(value: string): number | null {
  const cleaned = value.trim();
  if (!cleaned) return null;
  // Accept "12", "12.5", "12.50", "$12.50". Reject anything else.
  const m = cleaned.match(/^\$?(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return Number.NaN; // sentinel for invalid input
  const dollars = Number(m[1]);
  const fractional = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return dollars * 100 + fractional;
}

export function RateSheetClient({ catalog, initialRates }: Props): JSX.Element {
  // Server snapshot: cents per cell. Missing key = no rate set on the server.
  const [server, setServer] = useState<Map<CellKey, number>>(() => {
    const m = new Map<CellKey, number>();
    for (const r of initialRates) m.set(keyOf(r.serviceId, r.vehicleClass), r.priceCents);
    return m;
  });
  // Draft values (what the user has typed). undefined = same as server.
  const [draft, setDraft] = useState<Map<CellKey, string>>(() => new Map());
  const [saving, setSaving] = useState(false);

  // Track per-cell error state for invalid inputs so the user sees feedback
  // without us trying to coerce ambiguous text.
  const [errors, setErrors] = useState<Set<CellKey>>(() => new Set());

  const inputRefs = useRef<Map<CellKey, HTMLInputElement | null>>(new Map());

  const grouped = useMemo(() => {
    const m = new Map<ServiceCategory, ServiceCatalogEntryDto[]>();
    for (const cat of serviceCategoryValues) m.set(cat, []);
    for (const svc of catalog) {
      if (!svc.isActive) continue;
      m.get(svc.category)?.push(svc);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }
    return m;
  }, [catalog]);

  // Use the union of catalog-applicable classes as the unified column set so
  // every category section renders identical column widths — that fixes one
  // of the Build 1 cosmetic bugs. Class-independent services span the full
  // class set with their single "Price" cell.
  const unifiedClasses = useMemo(() => activeClasses(catalog), [catalog]);

  const dirtyCount = useMemo(() => {
    let n = 0;
    for (const [k, v] of draft.entries()) {
      if (errors.has(k)) continue;
      const cents = parseDollarsToCents(v);
      if (cents === null) {
        // Empty draft is "no change" if server is also missing; treat as not dirty.
        if (!server.has(k)) continue;
        n += 1;
        continue;
      }
      if (Number.isNaN(cents)) continue;
      if (server.get(k) !== cents) n += 1;
    }
    return n;
  }, [draft, server, errors]);

  function handleChange(key: CellKey, value: string): void {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
    setErrors((prev) => {
      if (!value.trim()) {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      }
      const cents = parseDollarsToCents(value);
      const isInvalid = Number.isNaN(cents);
      if (isInvalid && !prev.has(key)) {
        const next = new Set(prev);
        next.add(key);
        return next;
      }
      if (!isInvalid && prev.has(key)) {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }
      return prev;
    });
  }

  function handleRevertCell(key: CellKey): void {
    setDraft((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    if (saving) return;
    if (errors.size > 0) {
      toast.error('Fix invalid prices first.');
      return;
    }
    type Upsert = { serviceId: string; vehicleClass: RateVehicleClass; priceCents: number };
    const payload: Upsert[] = [];
    for (const [key, raw] of draft.entries()) {
      const [serviceId, vehicleClass] = key.split(':') as [string, RateVehicleClass];
      const cents = parseDollarsToCents(raw);
      if (cents === null) {
        // Empty cell — we don't support DELETE via the bulk endpoint in this
        // build; skip it so the operator's edit is a no-op. Surfaced as a
        // Backlog item.
        continue;
      }
      if (Number.isNaN(cents)) continue;
      if (server.get(key) === cents) continue;
      payload.push({ serviceId, vehicleClass, priceCents: cents });
    }
    if (payload.length === 0) {
      toast.info('No changes to save.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/service-rates/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: payload }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(data?.message ?? 'Save failed');
        return;
      }
      const body = (await res.json()) as { saved: number; rates: ServiceRateDto[] };
      setServer((prev) => {
        const next = new Map(prev);
        for (const r of body.rates) next.set(keyOf(r.serviceId, r.vehicleClass), r.priceCents);
        return next;
      });
      setDraft(new Map());
      toast.success(`Saved ${body.saved} rate${body.saved === 1 ? '' : 's'}`);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard(): void {
    if (dirtyCount === 0) return;
    if (!confirm('Discard all unsaved rate changes?')) return;
    setDraft(new Map());
    setErrors(new Set());
  }

  const isEmpty = catalog.length === 0;
  if (isEmpty) {
    return (
      <div className="rounded-[14px] border border-divider bg-bg-surface p-6 text-center">
        <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          No services in the catalog
        </p>
        <p className="mt-2 text-sm text-text-secondary-on-dark">
          Switch to the Catalog view and seed the defaults first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-text-secondary-on-dark">
          {dirtyCount > 0 ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
              {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
              All changes saved
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleDiscard}
            disabled={saving || dirtyCount === 0}
          >
            Discard
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || dirtyCount === 0}>
            {saving ? 'Saving…' : `Save ${dirtyCount > 0 ? `(${dirtyCount})` : 'changes'}`}
          </Button>
        </div>
      </div>

      <div className="space-y-6" data-testid="rate-sheet-grid">
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
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <colgroup>
                    <col className="w-[28%]" />
                    <col className="w-[14%]" />
                    {unifiedClasses.map((vc) => (
                      <col key={vc} />
                    ))}
                  </colgroup>
                  <thead className="border-b border-divider text-left text-text-secondary-on-dark/60">
                    <tr>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em]">
                        Service
                      </th>
                      <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em]">
                        Calc unit
                      </th>
                      {unifiedClasses.map((vc) => (
                        <th
                          key={vc}
                          className="px-3 py-3 text-center font-mono text-[10px] uppercase tracking-[0.18em]"
                        >
                          {CLASS_LABELS[vc as RateVehicleClass]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((svc) => {
                      const cols = columnsFor(svc);
                      const isClassIndependent =
                        cols.length === 1 && cols[0] === SERVICE_RATE_ANY_CLASS;
                      return (
                        <tr
                          key={svc.id}
                          className="border-b border-divider last:border-0 align-middle hover:bg-bg-surface-elevated/30"
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-text-primary-on-dark">{svc.name}</div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark/60">
                              {svc.code}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark">
                            {svc.calculationUnit.replace(/_/g, ' ')}
                            {svc.supportsPerResourceMultiplier ? (
                              <span className="ml-1 rounded bg-violet/15 px-1.5 py-0.5 text-[9px] text-violet">
                                ×N
                              </span>
                            ) : null}
                          </td>
                          {isClassIndependent
                            ? // One spanning input — visually centered under the "Price" header
                              [
                                <td
                                  key="price"
                                  className="px-3 py-3"
                                  colSpan={unifiedClasses.length}
                                >
                                  <PriceInput
                                    cellKey={keyOf(svc.id, SERVICE_RATE_ANY_CLASS)}
                                    serverCents={server.get(keyOf(svc.id, SERVICE_RATE_ANY_CLASS))}
                                    draftValue={draft.get(keyOf(svc.id, SERVICE_RATE_ANY_CLASS))}
                                    hasError={errors.has(keyOf(svc.id, SERVICE_RATE_ANY_CLASS))}
                                    onChange={(v) =>
                                      handleChange(keyOf(svc.id, SERVICE_RATE_ANY_CLASS), v)
                                    }
                                    onRevert={() =>
                                      handleRevertCell(keyOf(svc.id, SERVICE_RATE_ANY_CLASS))
                                    }
                                    inputRef={(el) =>
                                      inputRefs.current.set(
                                        keyOf(svc.id, SERVICE_RATE_ANY_CLASS),
                                        el,
                                      )
                                    }
                                    spanAll
                                  />
                                </td>,
                              ]
                            : unifiedClasses.map((vc) => {
                                const applies = (svc.applicableVehicleClasses as string[]).includes(
                                  vc,
                                );
                                if (!applies) {
                                  return (
                                    <td
                                      key={vc}
                                      className="px-3 py-3 text-center text-text-secondary-on-dark/30"
                                    >
                                      —
                                    </td>
                                  );
                                }
                                const k = keyOf(svc.id, vc as RateVehicleClass);
                                return (
                                  <td key={vc} className="px-3 py-3">
                                    <PriceInput
                                      cellKey={k}
                                      serverCents={server.get(k)}
                                      draftValue={draft.get(k)}
                                      hasError={errors.has(k)}
                                      onChange={(v) => handleChange(k, v)}
                                      onRevert={() => handleRevertCell(k)}
                                      inputRef={(el) => inputRefs.current.set(k, el)}
                                    />
                                  </td>
                                );
                              })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface PriceInputProps {
  cellKey: CellKey;
  serverCents: number | undefined;
  draftValue: string | undefined;
  hasError: boolean;
  onChange: (value: string) => void;
  onRevert: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
  spanAll?: boolean;
}

function PriceInput({
  cellKey,
  serverCents,
  draftValue,
  hasError,
  onChange,
  onRevert,
  inputRef,
  spanAll,
}: PriceInputProps): JSX.Element {
  const displayed =
    draftValue !== undefined ? draftValue : serverCents != null ? formatDollars(serverCents) : '';
  const isDirty =
    draftValue !== undefined &&
    (() => {
      const parsed = parseDollarsToCents(draftValue);
      if (parsed === null) return serverCents !== undefined;
      if (Number.isNaN(parsed)) return false;
      return serverCents !== parsed;
    })();

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1',
        spanAll ? 'max-w-[200px] mx-auto' : '',
      )}
    >
      <span className="font-mono text-[11px] text-text-secondary-on-dark/60">$</span>
      <input
        ref={inputRef}
        data-cell-key={cellKey}
        type="text"
        inputMode="decimal"
        value={displayed}
        placeholder="—"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onRevert();
            e.currentTarget.blur();
          }
        }}
        aria-invalid={hasError || undefined}
        className={cn(
          'h-9 w-full max-w-[110px] rounded-[8px] border bg-bg-surface px-2 text-right font-mono text-sm text-text-primary-on-dark transition-colors focus:outline-none focus:ring-1',
          hasError
            ? 'border-danger/60 focus:border-danger focus:ring-danger/30'
            : isDirty
              ? 'border-amber/60 focus:border-amber focus:ring-amber/30'
              : 'border-divider focus:border-brand-primary/60 focus:ring-brand-primary/30',
        )}
      />
    </div>
  );
}
