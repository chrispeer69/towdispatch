/**
 * Processing Credit Cards article body.
 */
import { InvoiceLink } from '@/components/ui/entity-link';
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
// Article — Processing Credit Cards
// =====================================================================

export function CardPaymentsArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Cash flow is the lifeblood of a towing business. US Tow DISPATCH integrates directly with Stripe to process credit card payments instantly, securely, and with full PCI compliance. 
      </P>
      <P>
        This guide explains the two ways to take a card payment—in the field via the driver app, or from the back office via an emailed payment link—and how those payments automatically reconcile against your invoices.
      </P>

      <H2>Overview</H2>
      <P>
        Before you can take a credit card payment, your tenant Owner must connect a Stripe account in <Em>Settings → Integrations</Em>. Once connected, the platform handles the secure token exchange. We never see, touch, or store the raw credit card numbers.
      </P>
      <P>
        When a payment succeeds, two things happen instantly: the funds are routed to your Stripe account for deposit to your bank, and the invoice status in US Tow DISPATCH flips to <Code>Paid</Code>.
      </P>

      <Callout tone="tip" title="The Golden Rule of Payments">
        Never write down a customer's credit card number on a piece of paper or read it over the radio. Always use the secure Stripe Terminal in the field, or send the customer a hosted payment link to their phone. This protects you from PCI compliance fines and reduces chargeback disputes.
      </Callout>

      <H2>When to use what</H2>
      <P>
        You have two distinct paths for capturing a payment, depending on where the customer is.
      </P>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            In the Field (Stripe Terminal)
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            The customer is standing next to the tow truck.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Used by the driver via the mobile app.</li>
            <li>Requires a physical Stripe card reader (BBPOS or Stripe Reader M2) or Tap-to-Pay on iPhone/Android.</li>
            <li>Lowest processing fees (Card-Present rates).</li>
            <li>Highest protection against fraud chargebacks.</li>
          </ul>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Back Office (Hosted Link)
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            The customer is not present, or the invoice was generated after the tow.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Used by Dispatchers or Accounting via the web portal.</li>
            <li>Sends an email or SMS to the customer with a secure "Pay Now" link.</li>
            <li>Standard e-commerce processing fees (Card-Not-Present rates).</li>
            <li>Customer types their own card details on their own phone.</li>
          </ul>
        </div>
      </div>

      <H2>Worked Example: Taking Payment in the Field</H2>
      <P>
        Driver Dustin has just dropped off Maria's Toyota Camry at the repair shop. Maria is standing there with her credit card.
      </P>

      <H3>Step 1: Driver initiates payment</H3>
      <OrderedList>
        <li>
          On the driver app, Dustin taps <Code>Complete Job</Code>.
        </li>
        <li>
          The app displays the final quoted total (e.g., $145.00). Dustin taps <Code>Collect Payment</Code>.
        </li>
        <li>
          Dustin selects <Code>Credit Card (Tap/Insert)</Code>. The app connects via Bluetooth to the Stripe Terminal card reader in his truck.
        </li>
      </OrderedList>

      <H3>Step 2: Customer pays</H3>
      <OrderedList>
        <li>
          The card reader screen lights up and displays $145.00.
        </li>
        <li>
          Maria taps her card or Apple Pay on the reader.
        </li>
        <li>
          The reader beeps, and the driver app instantly updates to show <Code>Payment Successful</Code>.
        </li>
      </OrderedList>

      <H3>Step 3: Back-office sync</H3>
      <P>
        Back at the office, the dispatcher doesn't have to do anything. The job status automatically moves to <Em>Completed</Em>, and the associated invoice (when generated by accounting) will already reflect a $145.00 payment and a $0.00 balance.
      </P>

      <H2>Worked Example: Sending a Payment Link</H2>
      <P>
        A parent called in a tow for their college student. The student is with the car, but the parent is paying from home.
      </P>

      <H3>Step 1: Generate the Invoice</H3>
      <OrderedList>
        <li>
          The dispatcher creates the job and assigns it. The driver completes the tow.
        </li>
        <li>
          Accounting opens the job, clicks <Code>Generate Invoice</Code>, reviews the line items, and clicks <Code>Post Invoice</Code>.
        </li>
      </OrderedList>

      <H3>Step 2: Send the Link</H3>
      <OrderedList>
        <li>
          On the posted invoice screen, Accounting clicks <Code>Send Email</Code>.
        </li>
        <li>
          They enter the parent's email address and click Send.
        </li>
        <li>
          The parent receives an email with a PDF receipt and a large <Code>Pay Now</Code> button.
        </li>
      </OrderedList>

      <H3>Step 3: Customer Pays</H3>
      <OrderedList>
        <li>
          The parent clicks the link, which opens a secure Stripe checkout page on their phone or computer.
        </li>
        <li>
          They enter their card details and click Pay.
        </li>
        <li>
          Stripe processes the charge. The US Tow DISPATCH platform receives a secure webhook from Stripe confirming the payment. The invoice status instantly flips from <Em>Sent</Em> to <Em>Paid</Em>.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>
      <P>
        When a payment fails, use this guide to determine the cause.
      </P>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The driver app says "Card Reader Not Found"</H4>
          <UnorderedList>
            <li>
              <Em>Is the reader turned on?</Em> Ensure the physical Stripe Terminal device is powered on and charged.
            </li>
            <li>
              <Em>Is Bluetooth enabled?</Em> The driver's phone must have Bluetooth turned on and permissions granted to the US Tow DISPATCH app.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The customer's card was declined</H4>
          <UnorderedList>
            <li>
              <Em>Insufficient funds or bank block.</Em> If Stripe returns a "Declined" status, the issue is between the customer and their bank. Ask the customer for a different card or cash. Do not release the vehicle until payment is secured.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The customer paid via the link, but the invoice still says "Sent"</H4>
          <UnorderedList>
            <li>
              <Em>Webhook delay.</Em> Occasionally, Stripe webhooks can be delayed by a few seconds. Refresh the page.
            </li>
            <li>
              <Em>Did they actually complete the checkout?</Em> Customers sometimes click the link, look at the bill, and close the tab without paying. You can verify if a payment intent was created by checking your Stripe Dashboard directly.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can I take a card number over the phone?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes, but it is not recommended. If you must, you can open the invoice, click "Record Payment," select "Credit Card (Manual Entry)," and type the numbers. However, you will pay higher processing fees and bear 100% of the liability if the customer later disputes the charge. Sending a payment link is always safer.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">How do refunds work?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            If you need to refund a customer, open the paid invoice and click "Issue Refund." You can issue a full or partial refund. The funds will be returned to the customer's card within 5-10 business days, and the invoice balance will adjust automatically.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/getting-started/connect-stripe"
            title="Connecting your Stripe Account"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/billing-finance/generating-invoices"
            title="Generating and Sending Invoices"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
