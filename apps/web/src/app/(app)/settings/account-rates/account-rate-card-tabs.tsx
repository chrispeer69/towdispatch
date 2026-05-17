'use client';

/**
 * Three-tab editor for a single account's rate card. Tabs:
 *   1. Rate Card           — pricing overrides per (service, vehicle class)
 *   2. Service Availability — per-service availability flag
 *   3. Contract Terms      — payment terms + intake/invoice flags
 *
 * Active tab persists in a URL hash so the operator can deep-link a
 * conversation ("see the contract terms tab for Agero"). Cross-tab
 * dirty/saving state is owned by the parent component and re-keyed when
 * the operator switches accounts.
 */
import { cn } from '@/lib/utils';
import type { AccountRateCardDto } from '@ustowdispatch/shared';
import { type JSX, useState } from 'react';
import { ContractTermsTab } from './contract-terms-tab';
import { RateCardTab } from './rate-card-tab';
import { ServiceAvailabilityTab } from './service-availability-tab';

type TabId = 'rate-card' | 'availability' | 'contract-terms';

interface Props {
  rateCard: AccountRateCardDto;
  onSaved: (next: AccountRateCardDto) => void;
  onAvailabilityDelete: (deletedId: string) => void;
}

export function AccountRateCardTabs({
  rateCard,
  onSaved,
  onAvailabilityDelete,
}: Props): JSX.Element {
  const [tab, setTab] = useState<TabId>('rate-card');

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-condensed text-lg font-extrabold uppercase leading-none tracking-tight md:text-xl">
            {rateCard.account.name}
          </h2>
          <span className="rounded-full bg-bg-surface-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
            {rateCard.account.isMotorClub ? 'Motor club' : 'Direct bill'}
          </span>
          {rateCard.account.motorClubNetworkCode ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark/70">
              {rateCard.account.motorClubNetworkCode}
            </span>
          ) : null}
        </div>
        <nav role="tablist" aria-label="Account rate card sections" className="flex gap-1.5">
          {(
            [
              ['rate-card', 'Rate Card'],
              ['availability', 'Service Availability'],
              ['contract-terms', 'Contract Terms'],
            ] as Array<[TabId, string]>
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'rounded-[8px] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
                tab === id
                  ? 'bg-brand-primary/15 text-brand-primary'
                  : 'bg-bg-surface text-text-secondary-on-dark hover:text-text-primary-on-dark',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div role="tabpanel">
        {tab === 'rate-card' ? <RateCardTab rateCard={rateCard} onSaved={onSaved} /> : null}
        {tab === 'availability' ? (
          <ServiceAvailabilityTab
            rateCard={rateCard}
            onSaved={onSaved}
            onDelete={onAvailabilityDelete}
          />
        ) : null}
        {tab === 'contract-terms' ? <ContractTermsTab accountId={rateCard.account.id} /> : null}
      </div>
    </div>
  );
}
