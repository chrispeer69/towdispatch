/**
 * /settings/notifications — read-only view of the email + notification
 * infrastructure currently in place.
 *
 * What this page is, deliberately:
 *   - A factual inventory of which transactional emails the system
 *     sends today and how delivery is configured (env-driven), so an
 *     operator coming to this tab understands what's wired and what
 *     isn't.
 *   - The home for the sidebar "Email Settings" link (which used to
 *     be a disabled placeholder).
 *
 * What this page is NOT:
 *   - A "save your tenant's From address" form. Per-tenant email
 *     config (custom From, SendGrid key, template overrides,
 *     per-email suppressions) is not modelled yet — there is no
 *     `tenant_email_settings` table and no JWT-authed admin email
 *     controller. The fields below are presented as informational
 *     only; faking editable controls that don't persist would be
 *     dishonest.
 *
 * Follow-up: see SETTINGS_DISCOVERY.md backlog #5 (no notification
 * preferences schema/service) and apps/web/docs/theming.md backlog
 * for the broader rename sweep.
 */
import { Mail, ShieldCheck } from 'lucide-react';
import type { JSX } from 'react';
import { findSettingsTab } from '../tabs';

const TAB = findSettingsTab('notifications');

interface EmailTemplate {
  template: string;
  purpose: string;
  trigger: string;
}

const TRANSACTIONAL_EMAILS: EmailTemplate[] = [
  {
    template: 'email-verification',
    purpose: 'Confirm a new user owns the email they signed up with',
    trigger: 'On signup, on email change',
  },
  {
    template: 'welcome',
    purpose: 'Welcome message after email verification',
    trigger: 'After /verify-email succeeds',
  },
  {
    template: 'password-reset',
    purpose: 'Time-boxed token to reset a forgotten password',
    trigger: 'From /forgot-password',
  },
  {
    template: 'password-changed-notification',
    purpose: 'Security notice that a password was changed',
    trigger: 'After a successful password change',
  },
  {
    template: 'invoice-issued',
    purpose: 'New invoice sent to the customer with totals + due date',
    trigger: 'When an invoice transitions draft → issued',
  },
  {
    template: 'invoice-overdue',
    purpose: 'Past-due reminder once balance remains after due date',
    trigger: 'Daily cron: invoice.dueAt < now() && balance > 0',
  },
  {
    template: 'statement-generated',
    purpose: 'Customer statement of account PDF link',
    trigger: 'On-demand from /billing/statements',
  },
  {
    template: 'credit-memo-issued',
    purpose: 'Credit memo notice with reason + applied-to text',
    trigger: 'When a credit memo is issued',
  },
];

export default function NotificationsPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-surface-elevated px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
          <Mail className="h-3 w-3" />
          Email + notifications
        </span>
        <h1 className="font-condensed text-3xl font-extrabold uppercase leading-none tracking-tight md:text-4xl">
          {TAB.label}
        </h1>
        <p className="max-w-prose text-sm text-text-secondary-on-dark">
          Read-only view of the transactional emails Tow Dispatch sends today and how delivery is
          currently configured. Per-tenant overrides (custom From address, template editing,
          per-email suppressions, in-app alert preferences) are not yet modelled — see the panel at
          the bottom of this page.
        </p>
      </header>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h2 className="font-semibold text-text-primary-on-dark">Delivery configuration</h2>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Email transport is selected at first send. SendGrid is used when the API key is present on
          the server environment; otherwise the service falls back to SMTP (mailhog in dev). Both
          the From address and the API key are server-side environment variables and are not
          editable from the app today.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/40 p-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark">
              Provider (env-controlled)
            </dt>
            <dd className="mt-1 font-medium text-text-primary-on-dark">SendGrid HTTP API</dd>
            <dd className="text-xs text-text-secondary-on-dark">
              Falls back to SMTP when SENDGRID_API_KEY is empty
            </dd>
          </div>
          <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/40 p-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark">
              Retry policy
            </dt>
            <dd className="mt-1 font-medium text-text-primary-on-dark">
              3 attempts, 400ms exponential backoff
            </dd>
            <dd className="text-xs text-text-secondary-on-dark">
              Retries 5xx responses only; 4xx fails fast
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h2 className="font-semibold text-text-primary-on-dark">Transactional emails sent</h2>
        <p className="mt-1 text-sm text-text-secondary-on-dark">
          Every email the system can send is listed here. Templates live in
          <code className="ml-1 rounded bg-bg-surface-elevated/60 px-1.5 py-0.5 font-mono text-xs">
            apps/api/src/modules/email/templates
          </code>{' '}
          as paired HTML + plain-text files.
        </p>
        <ul className="mt-4 divide-y divide-divider">
          {TRANSACTIONAL_EMAILS.map((t) => (
            <li key={t.template} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <code className="font-mono text-sm font-semibold text-text-primary-on-dark">
                  {t.template}
                </code>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary-on-dark">
                  {t.trigger}
                </span>
              </div>
              <p className="mt-1 text-sm text-text-secondary-on-dark">{t.purpose}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[14px] border border-divider bg-bg-surface p-5">
        <h2 className="flex items-center gap-2 font-semibold text-text-primary-on-dark">
          <ShieldCheck className="h-4 w-4 text-status-warning" />
          Not built yet
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-text-secondary-on-dark">
          <li>
            <span className="font-medium text-text-primary-on-dark">Per-tenant From address.</span>{' '}
            Currently the From is a single server env var; tenants can't set their own.
          </li>
          <li>
            <span className="font-medium text-text-primary-on-dark">Suppression toggles.</span> No
            way to disable individual transactional emails (e.g. opt out of invoice-overdue
            reminders) on a per-tenant or per-customer basis.
          </li>
          <li>
            <span className="font-medium text-text-primary-on-dark">Template editing.</span>{' '}
            Templates are versioned with the codebase; no in-app editor.
          </li>
          <li>
            <span className="font-medium text-text-primary-on-dark">Outgoing-email log.</span> Sends
            are logged to pino on the API but not persisted to the database, so there's no in-app
            audit trail.
          </li>
          <li>
            <span className="font-medium text-text-primary-on-dark">
              In-app notification preferences.
            </span>{' '}
            No notifications schema or service — alerts in the app today are emitted per feature
            with no central preference store.
          </li>
        </ul>
        <p className="mt-3 text-xs text-text-secondary-on-dark">
          Each of these is a discrete follow-up that needs a DB migration, an API surface, and a UI
          editor before it can ship.
        </p>
      </section>
    </div>
  );
}
