/**
 * RED ALERT Workflow article body.
 */
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

// =====================================================================
// Shared building blocks
// =====================================================================

function H2({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="font-condensed mt-12 text-3xl font-extrabold uppercase tracking-tight text-text-primary-on-dark">
      {children}
    </h2>
  );
}

function H3({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h3 className="font-condensed mt-8 text-xl font-extrabold uppercase tracking-wide text-text-primary-on-dark">
      {children}
    </h3>
  );
}

function H4({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h4 className="mt-6 text-base font-semibold text-text-primary-on-dark">{children}</h4>
  );
}

function P({ children }: { children: ReactNode }): JSX.Element {
  return <p className="mt-4 text-sm leading-7 text-text-primary-on-dark/90">{children}</p>;
}

function Em({ children }: { children: ReactNode }): JSX.Element {
  return <strong className="font-semibold text-text-primary-on-dark">{children}</strong>;
}

function Code({ children }: { children: ReactNode }): JSX.Element {
  return (
    <code className="rounded bg-bg-surface-elevated px-1.5 py-0.5 font-mono text-[12px] text-brand-primary">
      {children}
    </code>
  );
}

function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'tip';
  title: string;
  children: ReactNode;
}): JSX.Element {
  const accent =
    tone === 'warning'
      ? 'border-status-warning/40 bg-status-warning/10'
      : tone === 'tip'
        ? 'border-ok/40 bg-ok/10'
        : 'border-info/40 bg-info/10';
  return (
    <div className={`mt-6 rounded-[10px] border ${accent} p-5`}>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary-on-dark">
        {title}
      </p>
      <div className="mt-2 text-sm leading-7 text-text-primary-on-dark/90">{children}</div>
    </div>
  );
}

function OrderedList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm leading-7 text-text-primary-on-dark/90">
      {children}
    </ol>
  );
}

function UnorderedList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ul className="mt-4 list-disc space-y-3 pl-6 text-sm leading-7 text-text-primary-on-dark/90">
      {children}
    </ul>
  );
}

function RelatedDoc({ href, title }: { href: string; title: string }): JSX.Element {
  return (
    <Link href={href} className="text-brand-primary hover:underline underline-offset-2 transition-colors">
      {title}
    </Link>
  );
}

// =====================================================================
// Article — The RED ALERT Workflow
// =====================================================================

export function RedAlertArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Most towing software relies on you remembering to run a "Past Due" report to find out who owes you money. US Tow DISPATCH flips that dynamic. The <Em>RED ALERT</Em> workflow is an automated engine that texts your accounts receivable directly to your inbox every Monday morning.
      </P>
      <P>
        This guide explains how the RED ALERT digest is generated, how the system decides what is "past due," and how to manage which team members receive the email.
      </P>

      <H2>Overview</H2>
      <P>
        Every Monday at 6:00 AM (Eastern Time), the platform runs a background job across your entire ledger. It looks at every posted invoice, compares its age to the delinquency threshold of the customer who owes it, and tallies up the leaked revenue.
      </P>
      <P>
        If your business has zero past-due invoices, the system stays quiet. If even one invoice is delinquent, the system generates the RED ALERT digest and emails it to the Owner and all subscribed Admins.
      </P>

      <Callout tone="tip" title="The Goal">
        The RED ALERT is designed to smack you on the shoulder on Monday morning and point at the money sitting on the table. It turns A/R from a passive accounting task into an active, unavoidable priority for the week.
      </Callout>

      <H2>How the Math Works</H2>
      <P>
        The system does not blindly flag every unpaid invoice. It respects your contracted terms.
      </P>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Cash Customers
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            For cash customers, payment is expected immediately.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>The system uses the <Em>Default Delinquency Days</Em> setting from <Em>Settings → Invoice Defaults</Em>.</li>
            <li>If the default is 0 days, a cash invoice becomes Past Due at midnight on the day it is posted.</li>
          </ul>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Motor Clubs & Commercial
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            For accounts, the system respects net terms.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>The system checks the <Em>Delinquency Days</Em> setting on the specific Account record.</li>
            <li>If Agero is set to 30 days, an invoice posted on May 1st is not flagged in the RED ALERT until May 31st.</li>
          </ul>
        </div>
      </div>

      <H2>Worked Example: Receiving the Digest</H2>
      <P>
        It is Monday morning. You open your email and see a message from US Tow DISPATCH with the subject line: <Code>RED ALERT: 3 past-due invoices ($450.00) — Acme Towing</Code>.
      </P>

      <H3>Step 1: Read the Breakdown</H3>
      <OrderedList>
        <li>
          Open the email. The body contains a plain-text breakdown of exactly who owes the money.
        </li>
        <li>
          You see: <Code>AAA Motor Club, 2 invoices, oldest 45 days overdue, $300.00</Code>.
        </li>
        <li>
          You see: <Code>Cash Customer (Maria Sanchez), 1 invoice, oldest 3 days overdue, $150.00</Code>.
        </li>
      </OrderedList>

      <H3>Step 2: Take Action</H3>
      <OrderedList>
        <li>
          Click the <Code>Open A/R Workspace</Code> link in the email. This drops you directly into the platform, pre-filtered to show only Past Due invoices.
        </li>
        <li>
          Select the two AAA invoices and click <Code>Send Reminder Email</Code>.
        </li>
        <li>
          Call Maria Sanchez directly regarding the cash invoice.
        </li>
      </OrderedList>

      <H2>Managing Who Receives the Alert</H2>
      <P>
        You can control which members of your team receive the Monday morning digest.
      </P>
      <OrderedList>
        <li>
          Navigate to <Em>Settings → Users</Em>.
        </li>
        <li>
          Look at the <Em>RED ALERT</Em> column in the user table.
        </li>
        <li>
          Users with the <Code>Owner</Code> or <Code>Admin</Code> role display a locked "Always" badge. They receive the digest automatically by virtue of their role, and cannot be opted out.
        </li>
        <li>
          For other roles (e.g., <Code>Manager</Code> or <Code>Accounting</Code>), you will see a toggle switch. Click the toggle to subscribe or unsubscribe that user from the digest.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: I didn't receive the RED ALERT email this Monday</H4>
          <UnorderedList>
            <li>
              <Em>Do you actually have past-due invoices?</Em> The system only sends the email if the past-due balance is greater than zero. If your A/R is clean, or if all unpaid invoices are still within their grace period, the system stays quiet.
            </li>
            <li>
              <Em>Check your spam folder.</Em> If this is your first week on the platform, your email provider may have filtered the message. Mark it as "Not Spam" to ensure future delivery.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The email says a motor club is past due, but their check is in the mail</H4>
          <UnorderedList>
            <li>
              <Em>The system only knows what you tell it.</Em> If you received a check on Friday but didn't record the payment in US Tow DISPATCH until Tuesday, the system correctly flagged the invoice as unpaid on Monday morning. Always record payments as soon as they are received to keep the digest accurate.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can I change the day or time the email sends?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Not currently. The cron job is hardcoded to run globally at 6:00 AM Eastern Time every Monday. This ensures a consistent operational cadence across the platform.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">Does the RED ALERT email go to the customer?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            No. The RED ALERT digest is an internal report sent only to your team. You must manually choose to send reminder emails to customers from the A/R Workspace.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/billing-finance/ar-aging-workspace"
            title="The A/R Aging Workspace: Managing Past Due Accounts"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/getting-started/inviting-users"
            title="Inviting Users and Setting Permissions"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
