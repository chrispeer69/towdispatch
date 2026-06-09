'use client';

/**
 * Service Availability tab — per-service availability flag for an
 * account. Three values: available (default), not_covered, and
 * pre_approval_required. Row absence means 'available', so the UI shows
 * every catalog service with its current value pre-filled.
 */
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ACCOUNT_SERVICE_AVAILABILITY_LABELS,
  type AccountRateCardDto,
  type AccountServiceAvailabilityValue,
  SERVICE_CATEGORY_LABELS,
  type ServiceCategory,
  accountServiceAvailabilityValues,
  serviceCategoryValues,
} from '@towdispatch/shared';
import { type JSX, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface Props {
  rateCard: AccountRateCardDto;
  onSaved: (next: AccountRateCardDto) => void;
  onDelete: (deletedId: string) => void;
}

type DraftMap = Map<string, { availability: AccountServiceAvailabilityValue; notes: string }>;

export function ServiceAvailabilityTab({ rateCard, onSaved, onDelete }: Props): JSX.Element {
  const [drafts, setDrafts] = useState<DraftMap>(() => new Map());
  const [saving, setSaving] = useState(false);

  const availabilityByServiceId = useMemo(() => {
    const m = new Map<string, AccountRateCardDto['availability'][number]>();
    for (const a of rateCard.availability) m.set(a.serviceCatalogId, a);
    return m;
  }, [rateCard.availability]);

  // Distinct services (one row per service, regardless of vehicle class
  // — availability is service-level, not class-level).
  const services = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{
      serviceCatalogId: string;
      serviceCode: string;
      serviceName: string;
      category: string;
      sortOrder: number;
    }> = [];
    for (const r of rateCard.masterRates) {
      if (seen.has(r.serviceCatalogId)) continue;
      seen.add(r.serviceCatalogId);
      out.push({
        serviceCatalogId: r.serviceCatalogId,
        serviceCode: r.serviceCode,
        serviceName: r.serviceName,
        category: r.category,
        sortOrder: r.sortOrder,
      });
    }
    return out;
  }, [rateCard.masterRates]);

  const grouped = useMemo(() => {
    const m = new Map<ServiceCategory, typeof services>();
    for (const cat of serviceCategoryValues) m.set(cat as ServiceCategory, []);
    for (const svc of services) {
      m.get(svc.category as ServiceCategory)?.push(svc);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder || a.serviceName.localeCompare(b.serviceName));
    }
    return m;
  }, [services]);

  function currentValue(serviceId: string): AccountServiceAvailabilityValue {
    const draft = drafts.get(serviceId);
    if (draft) return draft.availability;
    return availabilityByServiceId.get(serviceId)?.availability ?? 'available';
  }

  function setDraft(serviceId: string, availability: AccountServiceAvailabilityValue): void {
    setDrafts((prev) => {
      const next = new Map(prev);
      const persisted = availabilityByServiceId.get(serviceId);
      // Reverting to the persisted value: drop the draft.
      if ((persisted?.availability ?? 'available') === availability) {
        next.delete(serviceId);
      } else {
        next.set(serviceId, {
          availability,
          notes: persisted?.notes ?? '',
        });
      }
      return next;
    });
  }

  const dirtyCount = drafts.size;

  async function handleSave(): Promise<void> {
    if (dirtyCount === 0 || saving) return;

    // Two kinds of writes:
    //   - upserts: any draft where availability is NOT 'available'
    //   - deletes: any draft where availability IS 'available' AND a row
    //     was persisted (we delete it so the row absence means
    //     "available")
    const upserts: Array<{
      serviceCatalogId: string;
      availability: AccountServiceAvailabilityValue;
      notes?: string;
    }> = [];
    const deletes: string[] = [];
    for (const [serviceId, d] of drafts.entries()) {
      const persisted = availabilityByServiceId.get(serviceId);
      if (d.availability === 'available' && persisted) {
        deletes.push(persisted.id);
        continue;
      }
      if (d.availability === 'available') continue;
      upserts.push({
        serviceCatalogId: serviceId,
        availability: d.availability,
        ...(d.notes ? { notes: d.notes } : {}),
      });
    }

    setSaving(true);
    try {
      // Deletes first so that a service flipped not_covered → available
      // and then re-set to pre_approval_required gets the right final
      // state (single sequential pass per service).
      for (const id of deletes) {
        const res = await fetch(
          `/api/accounts/${rateCard.account.id}/rate-card/availability/${id}`,
          { method: 'DELETE' },
        );
        if (!res.ok && res.status !== 204) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          toast.error(body?.message ?? 'Failed to clear availability');
          return;
        }
        onDelete(id);
      }

      if (upserts.length > 0) {
        const res = await fetch(`/api/accounts/${rateCard.account.id}/rate-card/bulk`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ availability: upserts }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          toast.error(body?.message ?? `Save failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as AccountRateCardDto;
        onSaved(data);
      } else {
        // Only deletes ran — refetch to refresh.
        const refresh = await fetch(`/api/accounts/${rateCard.account.id}/rate-card`, {
          cache: 'no-store',
        });
        if (refresh.ok) onSaved((await refresh.json()) as AccountRateCardDto);
      }
      setDrafts(new Map());
      toast.success(`Saved ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="account-availability-tab">
      <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/40 px-4 py-3 text-xs text-text-secondary-on-dark">
        Mark services this account does not cover or requires pre-approval for. When a dispatcher
        tries to add a "Not Covered" service to an invoice for this account, they'll see a warning
        to re-classify as customer overage.
      </div>
      <div className="flex items-center justify-between">
        {dirtyCount > 0 ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
            {dirtyCount} unsaved
          </span>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark/60">
            All saved
          </span>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setDrafts(new Map())}
            disabled={saving || dirtyCount === 0}
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
              <header className="border-b border-divider px-4 py-2.5">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
                  {SERVICE_CATEGORY_LABELS[cat]}
                </h3>
              </header>
              <ul>
                {list.map((svc) => {
                  const value = currentValue(svc.serviceCatalogId);
                  const isDirty = drafts.has(svc.serviceCatalogId);
                  return (
                    <li
                      key={svc.serviceCatalogId}
                      className={cn(
                        'flex items-center justify-between gap-3 border-b border-divider px-4 py-2 last:border-0',
                        isDirty ? 'border-l-2 border-l-amber' : '',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text-primary-on-dark">
                          {svc.serviceName}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark/60">
                          {svc.serviceCode}
                        </div>
                      </div>
                      <select
                        aria-label={`Availability for ${svc.serviceName}`}
                        className="rounded-[6px] border border-divider bg-bg-base px-2 py-1 text-xs"
                        value={value}
                        onChange={(e) =>
                          setDraft(
                            svc.serviceCatalogId,
                            e.target.value as AccountServiceAvailabilityValue,
                          )
                        }
                      >
                        {accountServiceAvailabilityValues.map((v) => (
                          <option key={v} value={v}>
                            {ACCOUNT_SERVICE_AVAILABILITY_LABELS[v]}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
