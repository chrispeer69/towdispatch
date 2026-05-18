/**
 * Statement Generation article body.
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
// Article — Statement Generation and Delivery
// =====================================================================

export function StatementGenerationArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Motor clubs and commercial fleets do not pay per invoice. They pay from a consolidated monthly or bi-weekly statement. Generating these statements accurately, applying payments against them, and tracking the remaining balance is a core accounting function.
      </P>
      <P>
        This guide explains how to generate a statement for a specific account, how the system handles carry-forward balances, and how to email the PDF statement directly to the motor club's accounts payable department.
      </P>

      <H2>Overview</H2>
      <P>
        A Statement is a snapshot in time. It shows the starting balance for an account, lists every invoice issued and payment received during a specific date range, and calculates the ending balance.
      </P>
      <P>
        In US Tow DISPATCH, statements are generated on demand. You can generate a statement for any date range, but the most common workflow is to generate them on the 1st of the month for the previous month's activity.
      </P>

      <Callout tone="tip" title="The difference between Invoices and Statements">
        An <Em>Invoice</Em> is a bill for a single tow job. A <Em>Statement</Em> is a summary of all invoices and payments for a single Account over a period of time. You send Invoices to cash customers. You send Statements to motor clubs.
      </Callout>

      <H2>Worked Example: Month-End Billing for Agero</H2>
      <P>
        It is the 1st of the month. You need to send Agero their statement for all tows completed last month.
      </P>

      <H3>Step 1: Navigate to Statements</H3>
      <OrderedList>
        <li>
          Navigate to <Em>Billing → Statements</Em> in the left sidebar.
        </li>
        <li>
          You will see a list of all previously generated statements. Click <Code>Generate Statement</Code> in the top right.
        </li>
      </OrderedList>

      <H3>Step 2: Select Account and Date Range</H3>
      <OrderedList>
        <li>
          In the generation modal, select <Code>Agero</Code> from the Account dropdown.
        </li>
        <li>
          Select the date range. You can use the quick-select buttons (e.g., <Code>Last Month</Code>) or manually pick the 1st through the 30th/31st.
        </li>
        <li>
          Click <Code>Generate Preview</Code>.
        </li>
      </OrderedList>

      <H3>Step 3: Review the Preview</H3>
      <P>
        The system compiles the statement and displays a preview on your screen. You should verify three things:
      </P>
      <UnorderedList>
        <li><Em>Starting Balance:</Em> Does this match what Agero owed you at the end of the previous month? (If they haven't paid last month's statement yet, this number will be greater than zero).</li>
        <li><Em>New Invoices:</Em> Scan the list of invoices generated during the month.</li>
        <li><Em>Payments Received:</Em> Scan the list of payments recorded during the month.</li>
      </UnorderedList>

      <H3>Step 4: Finalize and Send</H3>
      <OrderedList>
        <li>
          If the preview looks correct, click <Code>Finalize Statement</Code>. The system generates a formal PDF document with your company logo, remit-to address, and the line-item breakdown.
        </li>
        <li>
          The statement is now saved in the system. Click <Code>Email Statement</Code>.
        </li>
        <li>
          The email modal pre-populates with the billing email address configured on the Agero account. You can add CCs if needed. Click <Code>Send</Code>.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: An invoice is missing from the statement</H4>
          <UnorderedList>
            <li>
              <Em>Is the invoice still a Draft?</Em> Statements only include <Em>Posted</Em> invoices. If an invoice is still in Draft status, it will not appear on the statement, even if the job was completed during the date range. Post the invoice, then regenerate the statement.
            </li>
            <li>
              <Em>Check the invoice date.</Em> The statement pulls invoices based on their <Em>Posted Date</Em> (issued_at), not the date the tow occurred. If the tow happened on the 31st, but your accounting team didn't post the invoice until the 2nd of the next month, that invoice belongs on the next month's statement.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The starting balance is wrong</H4>
          <UnorderedList>
            <li>
              <Em>Did you forget to record a payment?</Em> The starting balance is calculated by taking all historical invoices for the account and subtracting all historical payments prior to the statement start date. If a motor club mailed a check last month and your team deposited it but forgot to record it in US Tow DISPATCH, the system still thinks they owe the money, and it will carry forward into the starting balance. Record the payment with the correct historical date, and regenerate the statement.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can I generate statements in bulk for all motor clubs?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Not currently. Statements must be generated one account at a time. This is an intentional design choice to force a manual review of the starting balance and invoice list before a PDF is sent to a major commercial partner.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">Does generating a statement push data to QuickBooks?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            No. Invoices and payments sync to QuickBooks individually as they happen. The Statement is just a PDF summary of those individual transactions. You do not need to sync the statement itself to QBO.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/billing-finance/generating-invoices"
            title="Generating and Sending Invoices"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/billing-finance/ar-aging-workspace"
            title="The A/R Aging Workspace: Managing Past Due Accounts"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
