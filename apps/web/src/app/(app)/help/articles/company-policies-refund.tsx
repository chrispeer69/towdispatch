/**
 * Refund Policy article body.
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
// Article — Standard Refund Policy Template
// =====================================================================

export function RefundPolicyArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Chargebacks are a reality in the towing business. When a customer disputes a credit card
        charge, Stripe (and the customer's bank) will look for a clear, publicly posted refund
        policy. Without one, you lose the dispute by default.
      </P>
      <P>
        This document provides a standard, legally defensible Refund Policy template that you can
        copy, paste into your own website, and link to on your US Tow DISPATCH customer tracking
        pages.
      </P>

      <H2>Overview</H2>
      <P>
        A good refund policy in the towing industry must address the three most common dispute
        scenarios: "Gone On Arrival" (GOA), cancellations after dispatch, and dissatisfaction with
        service. It must clearly state when a refund is owed and, more importantly, when it is{' '}
        <Em>not</Em>.
      </P>

      <Callout tone="tip" title="How to use this template">
        Copy the text in the gray box below. Replace the bracketed text like{' '}
        <Code>[Company Name]</Code> with your actual business details. Post it on your public
        website (e.g., <Code>acmetowing.com/refunds</Code>).
      </Callout>

      <H2>The Policy Template</H2>

      <div className="mt-6 rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-6 font-serif text-sm leading-relaxed text-text-primary-on-dark/80">
        <h4 className="mb-4 text-lg font-bold text-text-primary-on-dark">
          [Company Name] Refund and Cancellation Policy
        </h4>

        <p className="mb-4">
          At [Company Name], we are committed to providing prompt and professional towing and
          roadside assistance services. Due to the immediate nature of our dispatch operations, our
          refund and cancellation policies are strictly enforced as follows:
        </p>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">
          1. Cancellations Before Dispatch
        </h5>
        <p className="mb-4">
          If you cancel your service request <Em>before</Em> a driver has been dispatched to your
          location, you are entitled to a full refund of any pre-paid amounts.
        </p>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">
          2. Cancellations After Dispatch (GOA / Dry Run)
        </h5>
        <p className="mb-4">
          Once a driver has been dispatched and is en route to your location, you have incurred a
          service cost. If you cancel the service while the driver is en route, or if the driver
          arrives at the location and the vehicle is no longer there ("Gone On Arrival"), you will
          be charged a <Em>Dry Run Fee</Em> of [Insert Amount, e.g., $75.00] or 50% of the quoted
          service amount, whichever is greater. The remainder of any pre-paid amount will be
          refunded.
        </p>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">3. Completed Services</h5>
        <p className="mb-4">
          Once a service (tow, jump start, lockout, tire change, winch, or recovery) has been
          completed, <Em>all charges are final and non-refundable</Em>. We do not offer refunds for
          completed services under any circumstances.
        </p>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">
          4. Impound and Storage Fees
        </h5>
        <p className="mb-4">
          Fees related to police-ordered impounds, private property towing (PPI), and daily storage
          accruals are mandated by local and state regulations. These fees are strictly
          non-refundable. Vehicles will not be released until all accrued fees are paid in full.
        </p>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">5. Damage Claims</h5>
        <p className="mb-4">
          Refunds are not issued as a remedy for alleged vehicle damage. If you believe your vehicle
          was damaged during the towing process, you must file a formal damage claim by contacting
          our office at [Insert Phone Number] within 24 hours of service completion. Damage claims
          are handled through our insurance provider, not via credit card refunds or chargebacks.
        </p>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">6. Processing Time</h5>
        <p className="mb-4">
          Approved refunds will be processed back to the original method of payment. Please allow
          5-10 business days for the credit to appear on your bank or credit card statement,
          depending on your financial institution.
        </p>
      </div>

      <H2>How to Enforce This in US Tow DISPATCH</H2>
      <P>Having the policy is only half the battle. You must prove the customer agreed to it.</P>

      <H3>Digital Signatures</H3>
      <OrderedList>
        <li>
          When your driver arrives on scene, they should use the US Tow DISPATCH mobile app to
          capture the customer's signature on the digital Bill of Lading (BOL).
        </li>
        <li>
          The digital BOL automatically includes a link to your refund policy (if configured in your
          tenant settings).
        </li>
        <li>
          If the customer later disputes the charge, you can export the signed BOL from the{' '}
          <Em>Job Detail</Em> page and submit it to Stripe as proof of service.
        </li>
      </OrderedList>

      <H3>Processing Partial Refunds (Dry Runs)</H3>
      <P>If you need to charge a Dry Run fee and refund the rest:</P>
      <OrderedList>
        <li>
          Open the <Em>Invoice</Em> in US Tow DISPATCH.
        </li>
        <li>
          Click <Code>Issue Refund</Code>.
        </li>
        <li>
          Select <Code>Partial Refund</Code> and enter the amount to return to the customer. The
          system will automatically update the invoice balance and push the refund to Stripe.
        </li>
      </OrderedList>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">
            What if the customer disputes the charge anyway?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Stripe will notify you of the chargeback. You must respond within the dispute window
            (usually 7-15 days). Upload the signed BOL, the GPS timestamp of the driver's arrival
            (available in the Job Audit Log), and a screenshot of your Refund Policy. This
            combination wins the majority of "service not rendered" disputes.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/company-policies/damage-claim-procedure"
            title="Damage Claim Dispute Procedure"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/billing-finance/card-payments"
            title="Processing Credit Cards in the Field vs. Office"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
