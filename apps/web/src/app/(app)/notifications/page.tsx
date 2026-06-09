/**
 * /notifications — placeholder for the in-app notifications feed.
 *
 * Today this is a "Coming soon" landing. When the feature ships it
 * becomes the chronological list of in-app alerts (job assignments,
 * invoice paid, driver clock-in/out, integration failures, etc.).
 * Per-tenant + per-user preferences for which events emit a
 * notification live separately at /settings/notifications.
 *
 * Routed from the topbar bell icon — see
 * apps/web/src/components/app-shell/topbar.tsx.
 */
import { Bell, Settings } from 'lucide-react';
import Link from 'next/link';
import type { JSX } from 'react';

export const metadata = { title: 'Notifications — Tow Dispatch' };

export default function NotificationsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-surface-elevated px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
          <Bell className="h-3 w-3" />
          In-app notifications
        </span>
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          Notifications
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">
          A live feed of in-app alerts — job assignments, invoice events, driver clock-in/out,
          integration failures — will live here. The feed isn&rsquo;t wired up yet; transactional
          emails already fire per feature, but there&rsquo;s no central notification store today.
        </p>
      </header>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h2 className="font-semibold text-text-primary-on-dark">Coming soon</h2>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          A chronological list of in-app alerts, with read / unread state, filters by event type
          (jobs / billing / fleet / accounting / integrations), and a mark-all-read action.
        </p>
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold text-text-primary-on-dark">Notification preferences</h2>
            <p className="mt-1 max-w-prose text-sm text-text-secondary-on-dark">
              Choose which events emit a notification, per tenant and per user. Lives under Settings
              → Notifications today; that page is read-only until the preferences schema ships.
            </p>
          </div>
          <Link
            href="/settings/notifications"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-divider bg-bg-surface-elevated px-3 py-2 text-sm font-semibold text-text-primary-on-dark transition-colors hover:border-divider-strong"
          >
            <Settings className="h-4 w-4" />
            Open preferences
          </Link>
        </div>
      </section>
    </div>
  );
}
