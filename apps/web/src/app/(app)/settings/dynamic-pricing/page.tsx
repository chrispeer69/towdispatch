import { tryFetch } from '@/lib/api/client';
/**
 * /settings/dynamic-pricing — operator-facing configuration surface for
 * the Dynamic Pricing Engine (Moat #1).
 *
 * 5 tier-category cards each with enable/disable toggle and "Configure"
 * button. The configure modals live inside the client component.
 */
import {
  fetchDynamicPricingSettings,
  fetchHolidays,
  fetchNoaaMappings,
  fetchTiers,
} from '@/lib/api/dynamic-pricing';
import { getSessionToken } from '@/lib/auth/session';
import type {
  DynamicPricingHolidayDto,
  DynamicPricingNoaaMappingDto,
  DynamicPricingTenantSettings,
  DynamicPricingTierDto,
} from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { DynamicPricingSettingsClient } from './dynamic-pricing-settings-client';

export const metadata = { title: 'Dynamic Pricing — US Tow DISPATCH' };
export const dynamic = 'force-dynamic';

const TAB = findSettingsTab('dynamic-pricing');

export default async function DynamicPricingSettingsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const [tiersR, mappingsR, holidaysR, settingsR] = await Promise.all([
    tryFetch(() => fetchTiers(token)),
    tryFetch(() => fetchNoaaMappings(token)),
    tryFetch(() => fetchHolidays(token)),
    tryFetch(() => fetchDynamicPricingSettings(token)),
  ]);
  const tiers: DynamicPricingTierDto[] = tiersR.data ?? [];
  const mappings: DynamicPricingNoaaMappingDto[] = mappingsR.data ?? [];
  const holidays: DynamicPricingHolidayDto[] = holidaysR.data ?? [];
  const settings: DynamicPricingTenantSettings = settingsR.data ?? {
    capMultiplier: 3.0,
    demandSurgeThresholds: [150, 200, 300],
    demandSurgeMultipliers: [1.3, 1.6, 2.0],
    motorClubStormSurgeEnabled: false,
  };
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
          {TAB.label}
        </h1>
        <p className="text-sm text-text-secondary-on-dark">{TAB.description}</p>
      </header>
      <DynamicPricingSettingsClient
        initialTiers={tiers}
        initialMappings={mappings}
        initialHolidays={holidays}
        initialSettings={settings}
      />
    </div>
  );
}
