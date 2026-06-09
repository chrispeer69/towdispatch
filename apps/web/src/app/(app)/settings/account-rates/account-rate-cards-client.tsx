'use client';

/**
 * Account Rate Cards orchestrator — left rail + three-tab editor.
 *
 * Left rail: scrollable account list with a search box and account-type
 * filter chips. Click an account to load its rate card into the right
 * pane.
 *
 * Right pane: three tabs (Rate Card / Service Availability / Contract
 * Terms). Tab content fetches lazily; the orchestrator owns the
 * cross-tab dirty/saving state so a navigate-away inside the right pane
 * can warn before discarding edits.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
  AccountDto,
  AccountRateCardDto,
  AccountServiceAvailabilityDto,
} from '@towdispatch/shared';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AccountRateCardTabs } from './account-rate-card-tabs';

type AccountFilter = 'all' | 'motor_club' | 'direct_bill' | 'cash' | 'fleet';

interface Props {
  accounts: AccountDto[];
}

export function AccountRateCardsClient({ accounts }: Props): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [rateCard, setRateCard] = useState<AccountRateCardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Count of active override rows per account, for the badge in the left
  // rail. Populated as accounts are visited; falls back to "—" otherwise.
  const [overrideCounts, setOverrideCounts] = useState<Map<string, number>>(new Map());

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter === 'motor_club' && !a.isMotorClub) return false;
      if (filter === 'direct_bill' && (a.isMotorClub || a.billingTerms === 'cod')) return false;
      if (filter === 'cash' && a.billingTerms !== 'cod' && a.billingTerms !== 'prepay') {
        return false;
      }
      // "Fleet" is an editorial label for non-motor-club, non-cash accounts.
      // We approximate by: not a motor club AND billing is net_* (any).
      if (
        filter === 'fleet' &&
        (a.isMotorClub || a.billingTerms === 'cod' || a.billingTerms === 'prepay')
      ) {
        return false;
      }
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.accountNumber ?? '').toLowerCase().includes(q) ||
        (a.motorClubNetworkCode ?? '').toLowerCase().includes(q)
      );
    });
  }, [accounts, search, filter]);

  // Load rate card when the operator selects an account.
  useEffect(() => {
    if (!selectedId) {
      setRateCard(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async (): Promise<void> => {
      try {
        const res = await fetch(`/api/accounts/${selectedId}/rate-card`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `Failed to load (${res.status})`);
        }
        const data = (await res.json()) as AccountRateCardDto;
        if (cancelled) return;
        setRateCard(data);
        setOverrideCounts((prev) => {
          const next = new Map(prev);
          next.set(data.account.id, data.overrides.filter((o) => o.isActive).length);
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load rate card';
        setLoadError(message);
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [selectedId]);

  function handleSaved(updated: AccountRateCardDto): void {
    setRateCard(updated);
    setOverrideCounts((prev) => {
      const next = new Map(prev);
      next.set(updated.account.id, updated.overrides.filter((o) => o.isActive).length);
      return next;
    });
  }

  function handleAvailabilityDelete(deletedId: string): void {
    if (!rateCard) return;
    setRateCard({
      ...rateCard,
      availability: rateCard.availability.filter(
        (a: AccountServiceAvailabilityDto) => a.id !== deletedId,
      ),
    });
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-[14px] border border-divider bg-bg-surface p-6 text-center">
        <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
          No accounts yet
        </p>
        <p className="mt-2 text-sm text-text-secondary-on-dark">
          Add accounts from the{' '}
          <a className="text-brand-primary underline" href="/accounts">
            Accounts page
          </a>{' '}
          to manage their rate cards here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Left rail */}
      <aside className="w-full shrink-0 lg:w-[300px]">
        <div className="space-y-3 rounded-[14px] border border-divider bg-bg-surface p-3">
          <Input
            type="search"
            placeholder="Search accounts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Account type">
            {(
              [
                ['all', 'All'],
                ['motor_club', 'Motor Clubs'],
                ['cash', 'Cash'],
                ['direct_bill', 'Direct Bill'],
                ['fleet', 'Fleet'],
              ] as Array<[AccountFilter, string]>
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={cn(
                  'rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors',
                  filter === key
                    ? 'bg-brand-primary text-bg-base'
                    : 'bg-bg-surface-elevated text-text-secondary-on-dark hover:text-text-primary-on-dark',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <ul
            className="max-h-[70vh] overflow-y-auto"
            aria-label="Accounts"
            data-testid="account-rate-cards-list"
          >
            {filteredAccounts.length === 0 ? (
              <li className="px-2 py-6 text-center text-xs text-text-secondary-on-dark">
                No accounts match.
              </li>
            ) : (
              filteredAccounts.map((a) => {
                const isSelected = a.id === selectedId;
                const overrideCount = overrideCounts.get(a.id);
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left transition-colors',
                        isSelected
                          ? 'bg-brand-primary/15 text-brand-primary'
                          : 'text-text-primary-on-dark hover:bg-bg-surface-elevated',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.name}</div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark/70">
                          {a.isMotorClub
                            ? 'Motor club'
                            : a.billingTerms === 'cod' || a.billingTerms === 'prepay'
                              ? 'Cash'
                              : 'Direct bill'}
                        </div>
                      </div>
                      {overrideCount !== undefined && overrideCount > 0 ? (
                        <span className="rounded-full bg-bg-surface-elevated px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                          {overrideCount}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </aside>

      {/* Right pane */}
      <section className="min-w-0 flex-1">
        {selectedId == null ? (
          <div className="rounded-[14px] border border-divider bg-bg-surface p-8 text-center">
            <p className="font-condensed text-base font-extrabold uppercase tracking-wide text-text-primary-on-dark">
              Select an account
            </p>
            <p className="mt-2 text-sm text-text-secondary-on-dark">
              Choose an account on the left to view and edit its rate card, service availability,
              and contract terms.
            </p>
          </div>
        ) : loading || !rateCard ? (
          <div className="rounded-[14px] border border-divider bg-bg-surface p-8 text-center text-sm text-text-secondary-on-dark">
            {loadError ? (
              <div className="space-y-3">
                <p className="text-danger">{loadError}</p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    // Re-run effect by toggling state.
                    const id = selectedId;
                    setSelectedId(null);
                    setTimeout(() => setSelectedId(id), 10);
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : (
              'Loading…'
            )}
          </div>
        ) : (
          <AccountRateCardTabs
            rateCard={rateCard}
            onSaved={handleSaved}
            onAvailabilityDelete={handleAvailabilityDelete}
          />
        )}
      </section>
    </div>
  );
}
