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
  return <h4 className="mt-6 text-base font-semibold text-text-primary-on-dark">{children}</h4>;
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
    <Link
      href={href}
      className="text-brand-primary hover:underline underline-offset-2 transition-colors"
    >
      {title}
    </Link>
  );
}

// =====================================================================
// Article — Generating and Sending Invoices
// =====================================================================

export function GeneratingInvoicesArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        In US Tow DISPATCH, every completed job must be converted into an invoice before it hits
        your general ledger. This two-step process—Job to Draft Invoice, Draft Invoice to
        Posted—protects your accounting from field errors and ensures that dynamic pricing and
        account-specific rates are applied correctly before the customer sees the bill.
      </P>
      <P>
        This guide walks through the invoice generation lifecycle, how to edit line items before
        posting, and how to deliver the final invoice to the customer via email with a hosted
        payment link.
      </P>

      <H2>Overview</H2>
      <P>
        The platform strictly separates <Em>operational</Em> records from <Em>financial</Em>{' '}
        records. A Job is an operational record: it tracks where a truck went and what it did. An
        Invoice is a financial record: it tracks what you charged for the work and whether it was
        paid.
      </P>
      <P>
        When a driver marks a job <Code>Completed</Code>, the system does not automatically create
        an invoice. Instead, the job appears in the <Em>Ready to Invoice</Em> queue. Your accounting
        team (or dispatchers, depending on your workflow) reviews the job, generates a{' '}
        <Em>Draft</Em> invoice, makes any necessary manual adjustments, and then <Em>Posts</Em> it.
      </P>

      <Callout tone="tip" title="The Golden Rule of Invoicing">
        Once an invoice is <Em>Posted</Em> (status: <Code>issued</Code>), its line items are locked.
        You cannot edit the amount of a posted invoice because doing so breaks accounting sync
        (e.g., QuickBooks Online). If a posted invoice is wrong, you must <Code>Void</Code> it and
        generate a new one, or issue a partial refund.
      </Callout>

      <H2>When to use what</H2>
      <P>
        Invoices exist in one of several states. Understanding the state machine is critical for
        your accounting workflow.
      </P>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Draft
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            The invoice has been generated from the job but has not been finalized.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Line items can be added, edited, or removed.</li>
            <li>The invoice does not appear in A/R aging.</li>
            <li>It has not been synced to QuickBooks.</li>
          </ul>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Posted (Issued)
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            The invoice is locked and legally binding.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Line items are read-only.</li>
            <li>The invoice now appears in A/R aging and statements.</li>
            <li>It is automatically pushed to QuickBooks (if configured).</li>
            <li>It can be emailed to the customer with a payment link.</li>
          </ul>
        </div>
      </div>

      <H2>Worked Example: Invoicing a Motor Club Job</H2>
      <P>
        Let's walk through generating an invoice for a completed Agero tow. The driver has marked
        the job complete, and it's time to bill it.
      </P>

      <H3>Step 1: Generate the Draft</H3>
      <OrderedList>
        <li>
          Navigate to the <Em>Tow Jobs</Em> list. Filter for jobs with status <Code>Completed</Code>{' '}
          that do not have an invoice attached.
        </li>
        <li>
          Click into the job. On the Job Detail page, click the <Code>Generate Invoice</Code>{' '}
          button.
        </li>
        <li>
          The system runs the rate engine. It reads the Agero Account Rate Card, applies the
          contracted base rate, calculates the enroute and in-tow miles, and generates a Draft
          invoice. You are redirected to the Invoice Review screen.
        </li>
      </OrderedList>

      <H3>Step 2: Review and Edit Line Items</H3>
      <OrderedList>
        <li>Review the generated line items. You see the base tow fee and the mileage fee.</li>
        <li>
          The driver added a note that they had to use a snatch block to pull the vehicle out of a
          ditch. The rate engine didn't know this, so you need to add it manually.
        </li>
        <li>
          Click <Code>Add Line Item</Code>. Enter the description "Winching / Snatch Block" and the
          amount <Code>75.00</Code>. Save the line item. The invoice subtotal updates immediately.
        </li>
      </OrderedList>

      <H3>Step 3: Post the Invoice</H3>
      <OrderedList>
        <li>
          Once you are satisfied the invoice is correct, click the <Code>Post Invoice</Code> button
          at the top of the screen.
        </li>
        <li>
          The status changes from <Em>Draft</Em> to <Em>Posted</Em>. The line items lock. The
          invoice is assigned a formal Invoice Number (e.g., <Code>INV-2026-1042</Code>).
        </li>
      </OrderedList>

      <H3>Step 4: Send to Customer</H3>
      <OrderedList>
        <li>
          With the invoice posted, the <Code>Send Email</Code> button becomes active. Click it.
        </li>
        <li>
          A modal appears with the customer's email address pre-populated. You can add additional
          CCs (e.g., the motor club's generic billing inbox).
        </li>
        <li>
          Click <Code>Send</Code>. The customer receives an email with a PDF copy of the invoice
          attached, and a secure "Pay Now" button that links to your Stripe hosted checkout page.
          The invoice status changes to <Em>Sent</Em>.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>
      <P>When invoicing doesn't behave as expected, use this guide to find the fix.</P>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The "Generate Invoice" button is missing</H4>
          <UnorderedList>
            <li>
              <Em>Is the job completed?</Em> You cannot generate an invoice for a job that is still{' '}
              <Em>En Route</Em> or <Em>In Progress</Em>. The job must reach a terminal state (
              <Code>Completed</Code>, <Code>Cancelled</Code>, or <Code>GOA</Code>).
            </li>
            <li>
              <Em>Does the job already have an invoice?</Em> Look at the top of the Job Detail page.
              If there is an <Em>Invoice #</Em> link, the invoice was already generated by someone
              else. Click the link to view it.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The generated Draft invoice is missing the mileage charge</H4>
          <UnorderedList>
            <li>
              <Em>Did the job have valid pickup and dropoff addresses?</Em> The rate engine requires
              valid GPS coordinates to calculate road miles. If the addresses were entered manually
              without using the Mapbox autocomplete dropdown, the system may not have been able to
              calculate the distance.
            </li>
            <li>
              <Em>Does the Account Rate Card include free miles?</Em> If the motor club contract
              includes 10 free miles, and the tow was only 8 miles, the rate engine correctly omits
              the mileage charge.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: I posted an invoice with a mistake</H4>
          <P>You cannot edit a posted invoice. You must void it and start over.</P>
          <UnorderedList>
            <li>
              Click <Code>Void Invoice</Code> at the top of the screen. The invoice status changes
              to <Em>Voided</Em> and its balance drops to zero.
            </li>
            <li>
              Return to the original Job Detail page. The <Code>Generate Invoice</Code> button will
              be active again. Click it to generate a fresh Draft invoice and correct the mistake.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">
            Can drivers generate invoices in the field?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Not currently. The invoice generation workflow is restricted to Admin, Manager, and
            Accounting roles to protect your general ledger from field errors. Drivers mark jobs
            complete; the back office handles the billing.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">
            What happens if a customer pays partially in cash and the rest on a card?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            You can record multiple payments against a single invoice. On the posted invoice screen,
            click "Record Payment," enter the cash amount, and save. The invoice status changes to
            "Partially Paid." You can then process the remaining balance via credit card.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/billing-finance/card-payments"
            title="Processing Credit Cards in the Field vs. Office"
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
