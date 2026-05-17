'use client';

/**
 * Rate Card tab — inline-editable grid grouped by category. Each row is
 * one (service, vehicle_class) cell. Three override patterns the
 * operator can apply per cell:
 *
 *   - FLAT  — types the new price in dollars
 *   - %-OFF — types the percent off the master rate
 *   - $-OFF — types the dollars off the master rate
 *
 * The override-mode toggle at the top sets the default pattern for new
 * overrides; individual cells can switch their pattern via an inline
 * chip. Effective price is recomputed live as the operator types so the
 * final $ surfaces alongside the master price.
 *
 * Mirrors the Build 2 Master Rate Sheet keyboard pattern: Tab cell-to-
 * cell, Esc reverts the focused cell, Bulk Save commits all dirty cells
 * in a single PATCH.
 */
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ACCOUNT_RATE_OVERRIDE_TYPE_LABELS,
  type AccountRateCardDto,
  type AccountRateOverrideType,
  SERVICE_CATEGORY_LABELS,
  SERVICE_RATE_ANY_CLASS,
  type ServiceCategory,
  resolveAccountOverridePriceCents,
  serviceCategoryValues,
} from '@ustowdispatch/shared';
import { type JSX, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  rateCard: AccountRateCardDto;
  onSaved: (next: AccountRateCardDto) => void;
}

interface DraftCell {
  overrideType: AccountRateOverrideType;
  inputValue: string; // raw text from the operator
  notes: string | null;
  // If this draft replaces an existing override, we track its id so we
  // know to send a fresh upsert (not a brand-new one).
  existingOverrideId: string | null;
}

type CellKey = `${string}:${string}`;
const keyOf = (serviceCatalogId: string, vehicleClass: string): CellKey =>
  `${serviceCatalogId}:${vehicleClass}`;

function parseDollarsToCents(value: string): number | null {
  const cleaned = value.trim();
  if (!cleaned) return null;
  const m = cleaned.match(/^\$?(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return Number.NaN;
  const dollars = Number(m[1]);
  const fractional = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return dollars * 100 + fractional;
}

function parsePercent(value: string): string | null {
  const cleaned = value.trim().replace(/%$/, '');
  if (!cleaned) return null;
  const m = cleaned.match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return cleaned;
}

function formatCents(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export function RateCardTab({ rateCard, onSaved }: Props): JSX.Element {
  const [defaultOverrideType, setDefaultOverrideType] =
    useState<AccountRateOverrideType>('flat_price');
  const [categoryFilter, setCategoryFilter] = useState<ServiceCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Map<CellKey, DraftCell>>(() => new Map());
  const [saving, setSaving] = useState(false);

  // Index master rate by cell key. The API gives us at most one row per
  // (service, vehicle_class) cell.
  const masterByKey = useMemo(() => {
    const m = new Map<CellKey, number | null>();
    for (const r of rateCard.masterRates) {
      m.set(keyOf(r.serviceCatalogId, r.vehicleClass), r.priceCents);
    }
    return m;
  }, [rateCard.masterRates]);

  const overridesByKey = useMemo(() => {
    const m = new Map<CellKey, AccountRateCardDto['overrides'][number]>();
    for (const o of rateCard.overrides) {
      const vc = o.vehicleClass ?? SERVICE_RATE_ANY_CLASS;
      m.set(keyOf(o.serviceCatalogId, vc), o);
    }
    return m;
  }, [rateCard.overrides]);

  const dirtyCount = useMemo(() => {
    let n = 0;
    for (const [key, d] of drafts.entries()) {
      const valid = isDraftValid(d);
      if (!valid) continue;
      // Has the value actually changed vs the persisted override (or no
      // override → any non-empty draft is dirty)?
      const existing = overridesByKey.get(key);
      if (!existing) {
        n += 1;
        continue;
      }
      const draftMatch = draftMatchesOverride(d, existing);
      if (!draftMatch) n += 1;
    }
    return n;
  }, [drafts, overridesByKey]);

  // Group rows by category then service. Each service may produce multiple
  // rows (one per applicable vehicle class).
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const m = new Map<ServiceCategory, AccountRateCardDto['masterRates']>();
    for (const cat of serviceCategoryValues) m.set(cat as ServiceCategory, []);
    for (const r of rateCard.masterRates) {
      if (categoryFilter !== 'all' && r.category !== categoryFilter) continue;
      if (
        q &&
        !r.serviceName.toLowerCase().includes(q) &&
        !r.serviceCode.toLowerCase().includes(q)
      ) {
        continue;
      }
      const cat = r.category as ServiceCategory;
      m.get(cat)?.push(r);
    }
    for (const arr of m.values()) {
      arr.sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          a.serviceName.localeCompare(b.serviceName) ||
          a.vehicleClass.localeCompare(b.vehicleClass),
      );
    }
    return m;
  }, [rateCard.masterRates, categoryFilter, search]);

  function setDraftValue(key: CellKey, patch: Partial<DraftCell>): void {
    setDrafts((prev) => {
      const next = new Map(prev);
      const existing = next.get(key) ?? {
        overrideType: defaultOverrideType,
        inputValue: '',
        notes: null,
        existingOverrideId: overridesByKey.get(key)?.id ?? null,
      };
      next.set(key, { ...existing, ...patch });
      return next;
    });
  }

  function revertCell(key: CellKey): void {
    setDrafts((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }

  async function handleClear(key: CellKey, overrideId: string | null): Promise<void> {
    // Two paths: if an override is persisted, DELETE it; otherwise just
    // drop the draft.
    if (!overrideId) {
      revertCell(key);
      return;
    }
    if (
      !confirm(
        'Clear this override? The account will fall back to the master rate for this service + class.',
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/accounts/${rateCard.account.id}/rate-card/overrides/${overrideId}`,
        { method: 'DELETE' },
      );
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? 'Failed to clear override');
        return;
      }
      revertCell(key);
      // Refetch the rate card to reflect server state.
      const refresh = await fetch(`/api/accounts/${rateCard.account.id}/rate-card`, {
        cache: 'no-store',
      });
      if (refresh.ok) {
        const data = (await refresh.json()) as AccountRateCardDto;
        onSaved(data);
      }
      toast.success('Override cleared');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (saving || dirtyCount === 0) return;
    const overrides: Array<{
      serviceCatalogId: string;
      vehicleClass: string | null;
      overrideType: AccountRateOverrideType;
      overrideValueCents?: number;
      overridePercent?: string;
      notes?: string;
    }> = [];
    for (const [key, d] of drafts.entries()) {
      if (!isDraftValid(d)) continue;
      const existing = overridesByKey.get(key);
      if (existing && draftMatchesOverride(d, existing)) continue;
      const [serviceCatalogId, vc] = key.split(':') as [string, string];
      const vehicleClass = vc === SERVICE_RATE_ANY_CLASS ? null : vc;
      const base: (typeof overrides)[number] = {
        serviceCatalogId,
        vehicleClass,
        overrideType: d.overrideType,
      };
      if (d.overrideType === 'percent_discount') {
        const pct = parsePercent(d.inputValue);
        if (pct == null) continue;
        base.overridePercent = pct;
      } else {
        const cents = parseDollarsToCents(d.inputValue);
        if (cents == null || Number.isNaN(cents)) continue;
        base.overrideValueCents = cents;
      }
      if (d.notes && d.notes.trim().length > 0) base.notes = d.notes.trim();
      overrides.push(base);
    }
    if (overrides.length === 0) {
      toast.info('No valid changes to save.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${rateCard.account.id}/rate-card/bulk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? `Save failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as AccountRateCardDto;
      onSaved(data);
      setDrafts(new Map());
      toast.success(`Saved ${overrides.length} override${overrides.length === 1 ? '' : 's'}`);
    } finally {
      setSaving(false);
    }
  }

  const isEmpty = rateCard.masterRates.length === 0;
  if (isEmpty) {
    return (
      <div className="rounded-[14px] border border-divider bg-bg-surface p-6 text-center">
        <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          No services in the catalog
        </p>
        <p className="mt-2 text-sm text-text-secondary-on-dark">
          Set master rates on the Services & Pricing page first, then come back here to add
          per-account overrides.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="account-rate-card-tab">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Category filter"
            className="rounded-[8px] border border-divider bg-bg-surface px-2 py-1.5 text-xs"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ServiceCategory | 'all')}
          >
            <option value="all">All categories</option>
            {serviceCategoryValues.map((c) => (
              <option key={c} value={c}>
                {SERVICE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search service…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-[8px] border border-divider bg-bg-surface px-2 py-1.5 text-xs"
          />
          <div aria-label="Default override mode" className="flex gap-1">
            {(['flat_price', 'percent_discount', 'flat_dollar_discount'] as const).map((t) => (
              <button
                type="button"
                key={t}
                aria-pressed={defaultOverrideType === t}
                onClick={() => setDefaultOverrideType(t)}
                className={cn(
                  'rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]',
                  defaultOverrideType === t
                    ? 'bg-brand-primary text-bg-base'
                    : 'bg-bg-surface-elevated text-text-secondary-on-dark',
                )}
              >
                {ACCOUNT_RATE_OVERRIDE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
              {dirtyCount} unsaved
            </span>
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
              All saved
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={saving || dirtyCount === 0}
            onClick={() => setDrafts(new Map())}
          >
            Discard
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || dirtyCount === 0}>
            {saving ? 'Saving…' : dirtyCount > 0 ? `Save (${dirtyCount})` : 'Save'}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([cat, list]) => {
          if (list.length === 0) return null;
          return (
            <section
              key={cat}
              className="overflow-hidden rounded-[14px] border border-divider bg-bg-surface"
            >
              <header className="flex items-center justify-between border-b border-divider px-4 py-2.5">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                  {SERVICE_CATEGORY_LABELS[cat]}
                </h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
                  {list.length}
                </span>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="border-b border-divider text-left text-text-secondary-on-dark/60">
                    <tr>
                      <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                        Service
                      </th>
                      <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                        Class
                      </th>
                      <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-[0.18em]">
                        Master
                      </th>
                      <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                        Mode
                      </th>
                      <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                        Override
                      </th>
                      <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-[0.18em]">
                        Effective
                      </th>
                      <th className="px-2 py-2" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((row) => {
                      const k = keyOf(row.serviceCatalogId, row.vehicleClass);
                      const existing = overridesByKey.get(k);
                      const draft = drafts.get(k);
                      const effectiveOverrideType =
                        draft?.overrideType ?? existing?.overrideType ?? defaultOverrideType;
                      const inputValue = draft?.inputValue ?? formatOverrideValue(existing);
                      const liveEffective = computeEffective(
                        effectiveOverrideType,
                        inputValue,
                        row.priceCents,
                        existing,
                      );
                      const isDirty = draft != null && !draftMatchesOverride(draft, existing);
                      return (
                        <tr
                          key={k}
                          className={cn(
                            'border-b border-divider last:border-0 align-middle',
                            isDirty ? 'border-l-2 border-l-amber' : '',
                          )}
                        >
                          <td className="px-4 py-2">
                            <div className="font-medium text-text-primary-on-dark">
                              {row.serviceName}
                            </div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark/60">
                              {row.serviceCode}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                            {row.vehicleClass === SERVICE_RATE_ANY_CLASS
                              ? 'Any'
                              : row.vehicleClass.replace(/_/g, ' ')}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-text-secondary-on-dark">
                            {formatCents(row.priceCents)}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              aria-label="Override mode"
                              className="rounded-[6px] border border-divider bg-bg-base px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]"
                              value={effectiveOverrideType}
                              onChange={(e) =>
                                setDraftValue(k, {
                                  overrideType: e.target.value as AccountRateOverrideType,
                                  inputValue: '',
                                  existingOverrideId: existing?.id ?? null,
                                })
                              }
                            >
                              {(
                                ['flat_price', 'percent_discount', 'flat_dollar_discount'] as const
                              ).map((t) => (
                                <option key={t} value={t}>
                                  {ACCOUNT_RATE_OVERRIDE_TYPE_LABELS[t]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              {effectiveOverrideType === 'flat_price' ? (
                                <span className="font-mono text-[10px] text-text-secondary-on-dark/60">
                                  $
                                </span>
                              ) : null}
                              <input
                                type="text"
                                inputMode="decimal"
                                value={inputValue}
                                placeholder={
                                  effectiveOverrideType === 'percent_discount' ? '10' : '0.00'
                                }
                                onChange={(e) =>
                                  setDraftValue(k, {
                                    overrideType: effectiveOverrideType,
                                    inputValue: e.target.value,
                                    existingOverrideId: existing?.id ?? null,
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    revertCell(k);
                                  }
                                }}
                                className={cn(
                                  'w-20 rounded-[6px] border border-divider bg-bg-base px-2 py-1 text-right font-mono text-sm',
                                  isDirty ? 'border-amber' : '',
                                )}
                              />
                              {effectiveOverrideType === 'percent_discount' ? (
                                <span className="font-mono text-[10px] text-text-secondary-on-dark/60">
                                  %
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-sm font-semibold text-text-primary-on-dark">
                            {liveEffective != null ? formatCents(liveEffective) : '—'}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleClear(k, existing?.id ?? null)}
                              disabled={saving || (!draft && !existing)}
                              className="rounded-[6px] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark hover:text-danger disabled:opacity-30"
                              aria-label="Clear override"
                            >
                              Clear
                            </button>
                          </td>
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

function isDraftValid(d: DraftCell): boolean {
  if (d.overrideType === 'percent_discount') return parsePercent(d.inputValue) != null;
  const cents = parseDollarsToCents(d.inputValue);
  return cents != null && !Number.isNaN(cents);
}

function draftMatchesOverride(
  d: DraftCell,
  existing: AccountRateCardDto['overrides'][number] | undefined,
): boolean {
  if (!existing) return false;
  if (d.overrideType !== existing.overrideType) return false;
  if (d.overrideType === 'percent_discount') {
    const draftPct = parsePercent(d.inputValue);
    return draftPct === existing.overridePercent;
  }
  const draftCents = parseDollarsToCents(d.inputValue);
  return draftCents === existing.overrideValueCents;
}

function formatOverrideValue(o: AccountRateCardDto['overrides'][number] | undefined): string {
  if (!o) return '';
  if (o.overrideType === 'percent_discount') {
    return o.overridePercent ?? '';
  }
  return (o.overrideValueCents / 100).toFixed(2);
}

function computeEffective(
  overrideType: AccountRateOverrideType,
  inputValue: string,
  masterCents: number | null,
  fallbackOverride: AccountRateCardDto['overrides'][number] | undefined,
): number | null {
  // If the input parses, prefer that — otherwise use the persisted
  // override's effective price if available.
  if (overrideType === 'percent_discount') {
    const pct = parsePercent(inputValue);
    if (pct != null) {
      return resolveAccountOverridePriceCents(overrideType, 0, pct, masterCents);
    }
  } else {
    const cents = parseDollarsToCents(inputValue);
    if (cents != null && !Number.isNaN(cents)) {
      return resolveAccountOverridePriceCents(overrideType, cents, null, masterCents);
    }
  }
  if (fallbackOverride) return fallbackOverride.effectivePriceCents;
  return masterCents;
}
