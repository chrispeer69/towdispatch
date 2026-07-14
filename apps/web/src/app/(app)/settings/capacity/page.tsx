/**
 * /settings/capacity — operator-facing configuration surface for CADS
 * (Capacity-Aware Dispatch Signaling, Session 58).
 *
 * Four sections handled by the client component: band thresholds +
 * broadcast tuning, job weights, partner registry (credentials shown
 * once), and active manual overrides. Links to the broadcast log at
 * /settings/capacity/broadcasts.
 */
import {
  fetchCapacityOverrides,
  fetchCapacityPartners,
  fetchCapacitySettings,
} from '@/lib/api/capacity';
import { tryFetch } from '@/lib/api/client';
import { getSessionToken } from '@/lib/auth/session';
import {
  type CapacityOverrideDto,
  type CapacityPartnerDto,
  type CapacitySettingsDto,
  defaultCapacitySettings,
} from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';
import { CapacitySettingsClient } from './capacity-settings-client';

export const metadata = { title: 'Capacity Signaling — US Tow Dispatch' };
export const dynamic = 'force-dynamic';

const TAB = findSettingsTab('capacity');

export default async function CapacitySettingsPage(): Promise<JSX.Element> {
  const token = await getSessionToken();
  const [settingsR, partnersR, overridesR] = await Promise.all([
    tryFetch(() => fetchCapacitySettings(token)),
    tryFetch(() => fetchCapacityPartners(token)),
    tryFetch(() => fetchCapacityOverrides(false, token)),
  ]);
  const settings: CapacitySettingsDto = settingsR.data ?? defaultCapacitySettings;
  const partners: CapacityPartnerDto[] = partnersR.data ?? [];
  const overrides: CapacityOverrideDto[] = overridesR.data ?? [];
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-xl font-extrabold uppercase leading-none tracking-tight md:text-2xl">
          {TAB.label}
        </h1>
        <p className="text-sm text-text-secondary-on-dark">{TAB.description}</p>
      </header>
      <CapacitySettingsClient
        initialSettings={settings}
        initialPartners={partners}
        initialOverrides={overrides}
      />
    </div>
  );
}
