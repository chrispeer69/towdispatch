/**
 * /settings/billing — links out to the existing Stripe Connect settings
 * page at /billing/payments-settings rather than embedding or moving it.
 * SaaS-subscription billing (the tow company paying for the app) does
 * not exist yet; that half of the tab is a Coming Soon card.
 *
 * Logged for the architecture spec phase: the canonical home for
 * Stripe Connect should eventually be /settings/billing, with the
 * existing /billing/payments-settings route either removed or
 * redirecting here. Out of scope for this PR.
 */
import Link from 'next/link';
import type { JSX } from 'react';
import { ComingSoonCard } from '../coming-soon';
import { findSettingsTab } from '../tabs';

const TAB = findSettingsTab('billing');

export default function BillingSubscriptionPage(): JSX.Element {
  return (
    <ComingSoonCard
      title={TAB.label}
      description="SaaS subscription billing (the plan you pay for US Tow DISPATCH) will live here when it ships. The Stripe Connect setup that lets you accept payments from your customers is already wired and lives at the link below."
    >
      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-primary-on-dark">
              Stripe Connect — accept payments
            </h2>
            <p className="mt-1 max-w-prose text-sm text-text-secondary-on-dark">
              Connect a Stripe account, complete onboarding, and configure the platform margin used
              on every card and ACH transaction.
            </p>
          </div>
          <Link
            href="/billing/payments-settings"
            className="inline-flex shrink-0 items-center justify-center rounded-md bg-action px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-action/90"
          >
            Open Stripe Connect settings →
          </Link>
        </div>
      </section>
    </ComingSoonCard>
  );
}
