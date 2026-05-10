/**
 * Settings → Payments — Stripe Connect onboarding + platform margin.
 *
 * Server fetches the current connect status; client surfaces the "Connect"
 * button and the margin form, both POSTing through Next.js BFF route handlers.
 */
import { fetchConnectStatus } from '@/lib/api/payments';
import type { JSX } from 'react';
import { PaymentsSettingsClient } from './payments-settings-client';

export const dynamic = 'force-dynamic';

export default async function PaymentsSettingsPage(): Promise<JSX.Element> {
  const status = await fetchConnectStatus();
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Stripe payments</h1>
        <p className="text-text-secondary mt-1 max-w-prose">
          Connect a Stripe account to accept card and ACH payments. Funds are paid out directly to
          your bank — TowCommand only retains its configured platform margin.
        </p>
      </header>
      <PaymentsSettingsClient initial={status} />
    </div>
  );
}
