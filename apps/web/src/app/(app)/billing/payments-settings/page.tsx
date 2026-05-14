/**
 * Settings → Payments — Stripe Connect onboarding + platform margin.
 *
 * Server fetches the current connect status; client surfaces the "Connect"
 * button and the margin form, both POSTing through Next.js BFF route handlers.
 *
 * The /payments/connect/status endpoint legitimately answers 401/403 when no
 * Stripe account is linked yet or the caller lacks finance scope — and the
 * sidebar prefetches this RSC on every page, so an uncaught throw here would
 * cascade across the shell. Same pattern as accounting/settings.
 */
import { tryFetch } from '@/lib/api/client';
import { fetchConnectStatus } from '@/lib/api/payments';
import type { StripeConnectStatusDto } from '@ustowdispatch/shared';
import type { JSX } from 'react';
import { PaymentsSettingsClient } from './payments-settings-client';

export const dynamic = 'force-dynamic';

const NOT_CONNECTED: StripeConnectStatusDto = {
  accountId: null,
  accountStatus: 'none',
  chargesEnabled: false,
  payoutsEnabled: false,
  platformMarginBps: 0,
  publicKeyConfigured: false,
};

export default async function PaymentsSettingsPage(): Promise<JSX.Element> {
  const result = await tryFetch(() => fetchConnectStatus());
  const status = result.data ?? NOT_CONNECTED;
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Stripe payments</h1>
        <p className="text-text-secondary mt-1 max-w-prose">
          Connect a Stripe account to accept card and ACH payments. Funds are paid out directly to
          your bank — US Tow DISPATCH only retains its configured platform margin.
        </p>
      </header>
      <PaymentsSettingsClient initial={status} />
    </div>
  );
}
