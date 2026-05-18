/**
 * A/R Aging Workspace article body.
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
// Article — The A/R Aging Workspace
// =====================================================================

export function ArAgingArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Cash flow leak is a silent killer in the towing industry. If your accounting team is relying on spreadsheets or memory to track which motor club owes you for last month's tows, you are losing money. The <Em>A/R Aging Workspace</Em> replaces those spreadsheets with a real-time, actionable dashboard.
      </P>
      <P>
        This guide explains how to use the A/R workspace to identify past-due invoices, filter by specific accounts, and send bulk reminder emails with one click.
      </P>

      <H2>Overview</H2>
      <P>
        The A/R (Accounts Receivable) Aging Workspace is located under <Em>Billing → A/R Workspace</Em>. It displays every posted invoice in your system that has not been fully paid.
      </P>
      <P>
        Unlike a static report, this workspace is interactive. You can filter the list to show only invoices older than 30 days, select them all, and click "Send Reminder" to instantly email the customers. The system automatically calculates whether an invoice is "Past Due" based on the delinquency threshold you set for that specific account.
      </P>

      <Callout tone="tip" title="What defines 'Past Due'?">
        "Overdue" and "Past Due" are not the same thing. An invoice might be overdue by 1 day, but if your contract with Agero gives them 30 days to pay, it isn't "Past Due" (delinquent) until day 31. The A/R Workspace respects the <Em>Delinquency Days Threshold</Em> you configure for each Account in <Em>Settings → Accounts</Em>. If you haven't set a threshold, it uses the global default from <Em>Settings → Invoice Defaults</Em>.
      </Callout>

      <H2>When to use what</H2>
      <P>
        The workspace provides several tools to help you manage your collections workflow.
      </P>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            The Filter Bar
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Use this to narrow down the list of invoices.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Filter by Status (e.g., show only <Code>Past Due</Code>).</li>
            <li>Filter by Account (e.g., show only Allstate).</li>
            <li>Filter by Date Range (e.g., issued last month).</li>
          </ul>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Bulk Actions
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Use this to act on multiple invoices at once.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Select multiple rows using the checkboxes.</li>
            <li>Click <Code>Send reminder email</Code> to re-send the invoice with a "Past Due" notice.</li>
            <li>Generates statements for a single account (requires filtering by Account first).</li>
          </ul>
        </div>
      </div>

      <H2>Worked Example: Chasing Down Past-Due Motor Club Invoices</H2>
      <P>
        It's the 15th of the month. Your accounting manager needs to follow up with AAA regarding unpaid invoices from two months ago.
      </P>

      <H3>Step 1: Filter the Workspace</H3>
      <OrderedList>
        <li>
          Navigate to <Em>Billing → A/R Workspace</Em>.
        </li>
        <li>
          In the Filter Bar, click the <Code>Account</Code> dropdown and select <Code>AAA</Code>.
        </li>
        <li>
          Click the <Code>Past Due</Code> status chip to ensure you are only looking at delinquent invoices.
        </li>
        <li>
          Click <Code>Apply</Code>. The table updates to show only the AAA invoices that have crossed your configured delinquency threshold.
        </li>
      </OrderedList>

      <H3>Step 2: Review the Summary</H3>
      <OrderedList>
        <li>
          Look at the sticky summary footer at the bottom of the screen. It calculates the totals for the currently filtered view.
        </li>
        <li>
          You see that AAA has 14 past-due invoices totaling $2,450.00.
        </li>
      </OrderedList>

      <H3>Step 3: Send Bulk Reminders</H3>
      <OrderedList>
        <li>
          Click the master checkbox at the top left of the table to select all 14 rows.
        </li>
        <li>
          The Bulk Action bar appears at the top of the table. Click <Code>Send reminder email</Code>.
        </li>
        <li>
          The system automatically emails the AAA billing contact with copies of all 14 invoices, flagged as past due.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>
      <P>
        If the A/R Workspace isn't showing what you expect, check these common issues.
      </P>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: An invoice is overdue, but not highlighted in red as "Past Due"</H4>
          <UnorderedList>
            <li>
              <Em>Check the Account's delinquency threshold.</Em> Navigate to <Em>Settings → Accounts</Em>, open the account, and check the "Delinquency Days" setting. If it's set to 45 days, an invoice won't flag as Past Due until day 46.
            </li>
            <li>
              <Em>Check the global default.</Em> If the account has no specific threshold, the system uses the default in <Em>Settings → Invoice Defaults</Em>.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The "Generate Statement" button is grayed out</H4>
          <UnorderedList>
            <li>
              <Em>Filter by a single account first.</Em> You cannot generate a consolidated statement across multiple different customers or motor clubs. You must use the Filter Bar to select exactly one Account before the button becomes active.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can I export this list to Excel?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. Click the <Code>Reports →</Code> button in the top right, or use the <Code>Excel</Code> button in the filter bar, to download a full CSV/Excel export of your A/R aging data for use in pivot tables or external reporting.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">Does this replace QuickBooks?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            No. If you have connected QuickBooks Online, US Tow DISPATCH pushes the invoices to QBO. The A/R Workspace is designed for your daily operational collections workflow (sending reminders, generating statements), while QBO remains your official general ledger for tax and compliance.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/billing-finance/statement-generation"
            title="Statement Generation and Delivery"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/billing-finance/red-alert-workflow"
            title="The RED ALERT Workflow: Automated Past-Due Digests"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
