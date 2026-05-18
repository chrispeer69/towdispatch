/**
 * Tier Offer Composer article body.
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
// Article — The Tier Offer Composer
// =====================================================================

export function TierOfferComposerArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Motor clubs dictate flat rates. When a severe weather event hits, those flat rates often fail to cover the increased cost of operating a heavy-duty fleet in dangerous conditions. The <Em>Tier Offer Composer</Em> flips the script: it allows you to proactively offer guaranteed truck capacity to motor clubs in exchange for a temporary, event-specific rate multiplier.
      </P>
      <P>
        This guide explains how to compose an offer, how motor club managers accept or decline it, and how the dispatch board enforces those decisions during the event.
      </P>

      <H2>Overview</H2>
      <P>
        The Tier Offer Composer sits on top of the Dynamic Pricing Engine. While standard dynamic pricing applies automatically to cash customers, motor clubs require a negotiated agreement before you can alter their contracted rates.
      </P>
      <P>
        The Composer automates this negotiation. You create an offer specifying a premium (e.g., 1.5×), a capacity commitment (e.g., 8 trucks), and a time window. The system emails this offer to the motor clubs you select. If they click "Accept," the system automatically applies the multiplier to their jobs during the window. If they click "Decline," your dispatchers are flagged to decline their calls, preserving your limited capacity for the partners who agreed to pay.
      </P>

      <Callout tone="tip" title="The Strategy: Commitment, not Punishment">
        Position your offers as a <Em>commitment</Em> to the motor club, not a penalty. The pitch is: "We are dedicating our fleet to the partners who meet our event pricing." This transforms a difficult conversation into a strategic partnership.
      </Callout>

      <H2>Worked Example: A Level-2 Snow Emergency</H2>
      <P>
        It is Thursday afternoon. The National Weather Service has issued a Level-2 Snow Emergency for your service area, starting Friday at 6:00 AM and ending Saturday at midnight.
      </P>

      <H3>Step 1: Compose the Offer</H3>
      <OrderedList>
        <li>
          Navigate to <Em>Settings → Dynamic Pricing</Em> and click <Code>Compose Offer</Code>.
        </li>
        <li>
          <Em>Select Tier:</Em> Choose your pre-configured "Winter Storm Warning" tier (1.5× multiplier).
        </li>
        <li>
          <Em>Set Time Window:</Em> Enter Friday 6:00 AM to Saturday 11:59 PM.
        </li>
        <li>
          <Em>Commit Capacity:</Em> Enter the number of trucks you are guaranteeing to the accepting clubs (e.g., <Code>8</Code>).
        </li>
        <li>
          <Em>Select Recipients:</Em> Check the boxes next to the motor club accounts you want to send this to (e.g., Agero, AAA, Allstate).
        </li>
        <li>
          Click <Code>Send Offer</Code>.
        </li>
      </OrderedList>

      <H3>Step 2: The Motor Club Experience</H3>
      <P>
        The system instantly emails the selected account managers.
      </P>
      <OrderedList>
        <li>
          The Agero manager receives an email: "US Tow DISPATCH: Severe Weather Capacity Offer from Acme Towing."
        </li>
        <li>
          They click the secure link in the email, which opens a public landing page. They do not need to log in.
        </li>
        <li>
          The page displays your terms: "Acme Towing is committing 8 trucks to partners who accept a 1.5× rate multiplier during the snow emergency."
        </li>
        <li>
          The manager clicks <Code>Accept Offer</Code>. The system logs their IP address and timestamp as a legally binding acceptance.
        </li>
      </OrderedList>

      <H3>Step 3: Dispatch-Time Enforcement</H3>
      <P>
        Friday morning arrives, and the snow emergency begins. The active window opens.
      </P>
      <OrderedList>
        <li>
          A job comes in from Agero. Because Agero accepted the offer, the Live Quote Box automatically applies the 1.5× multiplier to the invoice. The dispatcher processes the job normally.
        </li>
        <li>
          A job comes in from AAA. AAA either clicked "Decline" or never responded to the email.
        </li>
        <li>
          The Live Dispatch Board flashes a prominent warning on the AAA job card: <Em>"Offer Declined/Pending."</Em>
        </li>
        <li>
          The dispatcher clicks the job. A button appears: <Code>Decline Dispatch</Code>. The dispatcher clicks it, and the system automatically rejects the job back to AAA with the reason code: "Capacity unavailable due to severe weather event."
        </li>
      </OrderedList>

      <H3>Step 4: Post-Event Reconciliation</H3>
      <OrderedList>
        <li>
          On Monday, navigate to <Em>Operations → Dynamic Pricing → Reports</Em>.
        </li>
        <li>
          Generate the <Em>Event Reconciliation Report</Em> for the snowstorm.
        </li>
        <li>
          The report shows exactly which clubs accepted, how many jobs you completed for them at the premium rate, and the total revenue uplift generated by the offer.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A motor club manager says the link expired</H4>
          <UnorderedList>
            <li>
              <Em>Has the event window closed?</Em> The magic link sent in the email is cryptographically tied to the event's end date. Once the event is over, the link automatically expires. You cannot retroactively accept an offer for an event that has passed.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A job from an opted-out club wasn't flagged on the dispatch board</H4>
          <UnorderedList>
            <li>
              <Em>Is the event window currently active?</Em> The dispatch board only flags jobs that arrive <Em>during</Em> the specific start/end times defined in the offer. Jobs arriving before or after the window are processed at standard rates without warnings.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can a motor club change their mind mid-event?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. If a club initially declines or ignores the offer, but realizes mid-storm they have no coverage, they can click the link in the original email and accept it. The system will immediately begin applying the multiplier to any new jobs they send.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">Do I have to decline jobs from opted-out clubs?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            No. The system flags the job and provides a one-click decline option, but the final decision rests with your dispatcher. If you have excess capacity and want to take the job at the standard rate as a gesture of goodwill, you can proceed normally.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/advanced-features/dynamic-pricing"
            title="Dynamic Pricing: How to Configure and Activate Tiers"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/advanced-features/account-rate-cards"
            title="Account Rate Cards: Managing Commercial Pricing"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
