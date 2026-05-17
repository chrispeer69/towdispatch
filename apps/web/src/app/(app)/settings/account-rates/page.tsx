/**
 * /settings/account-rates — Account Rate Cards.
 *
 * Status: NOT live yet. The `accounts.defaultRateSheetId` column
 * exists and the rate-engine resolves it at quote time, but there
 * is no `/rate-sheets` list endpoint on the API today — without
 * one, a per-account rate-sheet picker has nothing to pick from.
 *
 * The new Master Rate Sheet (build 2 of 6, PR #24) uses a flatter
 * `/service-rates` model and doesn't expose multi-sheet management
 * yet. When `/rate-sheets` ships (or the master-rate-sheet UI is
 * extended to multi-sheet), this page becomes a per-account picker
 * with sheet preview.
 */
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';

const TAB = findSettingsTab('account-rates');

export const metadata = { title: 'Account Rate Cards — US Tow DISPATCH' };

export default function AccountRateCardsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          {TAB.label}
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">{TAB.description}</p>
      </header>

      <section className="rounded-[14px] border border-status-warning/30 bg-status-warning/5 p-5 text-sm">
        <p className="font-semibold text-text-primary-on-dark">
          Not live yet — needs a backend list endpoint
        </p>
        <p className="mt-2 text-text-secondary-on-dark">The pieces are partly in place:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-secondary-on-dark">
          <li>
            <code className="font-mono">accounts.defaultRateSheetId</code> exists on the schema and
            is editable via <code className="font-mono">PATCH /accounts/:id</code>.
          </li>
          <li>
            The rate-engine resolves it first at quote time
            (apps/api/src/modules/rates/rate-engine.service.ts), so an account-level rate sheet wins
            over the tenant default.
          </li>
        </ul>
        <p className="mt-3 text-text-secondary-on-dark">
          What&rsquo;s missing: a <code className="font-mono">GET /rate-sheets</code> endpoint that
          lists the tenant&rsquo;s rate sheets so this page can render a picker. The new Master Rate
          Sheet (Admin Settings build 2) uses a flatter{' '}
          <code className="font-mono">/service-rates</code> model and doesn&rsquo;t expose
          multi-sheet management yet. When the list endpoint ships, this page becomes a per- account
          picker with sheet preview.
        </p>
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5 text-sm">
        <p className="font-semibold text-text-primary-on-dark">What you can do today</p>
        <p className="mt-2 text-text-secondary-on-dark">
          The single tenant-wide rate sheet is editable on the{' '}
          <a href="/settings/services" className="text-brand-primary hover:underline">
            Services &amp; Pricing
          </a>{' '}
          tab. Per-account overrides will land here once the list endpoint is in place.
        </p>
      </section>
    </div>
  );
}
