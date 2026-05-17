import { tryFetch } from '@/lib/api/client';
/**
 * /dynamic-pricing — top-level Control Panel for the Dynamic Pricing
 * Engine (Moat #1).
 *
 * Six sections (per spec):
 *   1. Active tiers right now
 *   2. Scheduled activations
 *   3. Recent tier history (last 24 hours)
 *   4. Today's Pulse
 *   5. Override Report (last 7 days summary)
 *   6. Tier Performance (current month summary)
 *
 * Plus: a demand-surge suggestions banner above section 1 when any
 * pending suggestion exists.
 */
import {
  fetchOverrideReport,
  fetchPendingDemandSurgeSuggestions,
  fetchPulseToday,
  fetchTierHistoryReport,
  fetchTierPerformanceReport,
  fetchTiers,
} from '@/lib/api/dynamic-pricing';
import { getSessionToken } from '@/lib/auth/session';
import type {
  DynamicPricingDemandSurgeSuggestionDto,
  DynamicPricingPulseToday,
  DynamicPricingTierDto,
  OverrideReportRow,
  TierHistoryRow,
  TierPerformanceRow,
} from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { ControlPanelClient } from './control-panel-client';

export const metadata = { title: 'Dynamic Pricing — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

export default async function DynamicPricingControlPanelPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfMonthIso = startOfMonth.toISOString();

  const [tiersR, pulseR, suggestionsR, historyR, overrideR, perfR] = await Promise.all([
    tryFetch(() => fetchTiers(token)),
    tryFetch(() => fetchPulseToday(token)),
    tryFetch(() => fetchPendingDemandSurgeSuggestions(token)),
    tryFetch(() => fetchTierHistoryReport({ from: since24h }, token)),
    tryFetch(() => fetchOverrideReport({ from: since7d }, token)),
    tryFetch(() => fetchTierPerformanceReport({ from: startOfMonthIso }, token)),
  ]);

  return (
    <ControlPanelClient
      tiers={(tiersR.data ?? []) as DynamicPricingTierDto[]}
      pulse={
        (pulseR.data ?? {
          date: '',
          revenueCents: 0,
          standardRevenueCents: 0,
          deltaCents: 0,
          upliftPct: 0,
          acceptedQuoteCount: 0,
          byTier: [],
        }) as DynamicPricingPulseToday
      }
      suggestions={(suggestionsR.data ?? []) as DynamicPricingDemandSurgeSuggestionDto[]}
      history={(historyR.data ?? []) as TierHistoryRow[]}
      overrides={(overrideR.data ?? []) as OverrideReportRow[]}
      performance={(perfR.data ?? []) as TierPerformanceRow[]}
    />
  );
}
