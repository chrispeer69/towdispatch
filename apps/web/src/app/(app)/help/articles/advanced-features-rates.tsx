/**
 * Account Rate Cards article body.
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
// Article — Account Rate Cards
// =====================================================================

export function AccountRateCardsArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Not all customers pay the same price. Your cash customers pay your standard retail rate, but your motor clubs, local police departments, and commercial fleet accounts all have their own negotiated contracts.
      </P>
      <P>
        The <Em>Account Rate Cards</Em> module allows you to codify these contracts into the platform. Once configured, the Live Quote Box automatically applies the correct base rates, per-mile charges, and free-mile allowances based on the customer selected, eliminating manual pricing errors at dispatch.
      </P>

      <H2>Overview</H2>
      <P>
        The rate engine uses a "fallback" hierarchy. Every tenant has a <Em>Master Rate Sheet</Em> (your retail cash prices). When you create an Account (e.g., Agero), you can define an <Em>Account Rate Card</Em> for them. 
      </P>
      <P>
        You do not have to define every single price for an account. You only define the <Em>overrides</Em>. If Agero pays a custom rate for Light Duty Tows, but standard retail rate for Lockouts, you only set the Tow override. The engine falls back to the Master Rate Sheet for everything else.
      </P>

      <Callout tone="tip" title="The Rule of Specificity">
        The rate engine always uses the most specific price it can find. The hierarchy is: <Em>Account-Specific Rate</Em> &gt; <Em>Master Rate Sheet</Em>. If you override a price on an account, that override always wins.
      </Callout>

      <H2>How to Configure a Rate Card</H2>
      <P>
        Rate cards are managed on the Account detail page.
      </P>

      <H3>Step 1: Open the Account</H3>
      <OrderedList>
        <li>
          Navigate to <Em>Settings → Accounts</Em> (or <Em>Customers → Accounts</Em>).
        </li>
        <li>
          Click on the specific account you want to configure (e.g., "AAA Motor Club").
        </li>
        <li>
          Click the <Code>Contract Terms</Code> tab.
        </li>
      </OrderedList>

      <H3>Step 2: Configure Service Overrides</H3>
      <P>
        The Contract Terms tab displays a grid of every service type (Tow, Jump Start, Lockout, etc.) broken down by Vehicle Class (Light Duty, Medium Duty, Heavy Duty).
      </P>
      <OrderedList>
        <li>
          Find the intersection of the service and class you want to override (e.g., <Em>Tow / Light Duty</Em>).
        </li>
        <li>
          Click the <Code>Edit</Code> icon.
        </li>
        <li>
          Enter the negotiated <Em>Base Rate</Em> (e.g., $45.00).
        </li>
        <li>
          Enter the <Em>Per-Mile Rate</Em> (e.g., $3.50/mi).
        </li>
        <li>
          Enter the <Em>Free Miles Included</Em> (e.g., 5). The rate engine will not charge mileage until the total distance exceeds this number.
        </li>
        <li>
          Click <Code>Save</Code>. The grid updates to show your override in bold, indicating it differs from the Master Rate Sheet.
        </li>
      </OrderedList>

      <H2>Worked Example: Quoting an Account Job</H2>
      <P>
        Let's see the rate card in action on the Call Intake form. You have configured AAA to pay $45 base + $3.50/mi after 5 free miles for Light Duty Tows. Your standard Cash rate is $75 base + $4.00/mi with 0 free miles.
      </P>

      <OrderedList>
        <li>
          A dispatcher opens the Call Intake form.
        </li>
        <li>
          They select <Code>Account / Motor Club</Code> as the Customer Type, and pick <Code>AAA Motor Club</Code> from the dropdown.
        </li>
        <li>
          They select <Code>Tow</Code> and enter a 2020 Toyota Camry (Light Duty).
        </li>
        <li>
          They enter a pickup and dropoff address. The system calculates the distance as 12 miles.
        </li>
      </OrderedList>

      <P>
        <Em>The Live Quote Box instantly calculates:</Em>
      </P>
      <UnorderedList>
        <li><Em>Base Fee:</Em> $45.00 (from the AAA override).</li>
        <li><Em>Mileage:</Em> 12 total miles - 5 free miles = 7 billable miles. 7 miles × $3.50/mi = $24.50.</li>
        <li><Em>Total Quote:</Em> $69.50.</li>
      </UnorderedList>

      <P>
        If the dispatcher had left the Customer Type as "Cash," the quote would have been $123.00 ($75 base + 12 miles × $4.00/mi). The dispatcher didn't have to remember the AAA contract; the system did the math automatically.
      </P>

      <H2>Troubleshooting Tree</H2>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: An account job is quoting at the Cash rate</H4>
          <UnorderedList>
            <li>
              <Em>Did you set the override for the correct Vehicle Class?</Em> If you set the override for Light Duty, but the dispatcher selected a Ford F-450 (Medium Duty) on the intake form, the system falls back to the Master Rate Sheet for Medium Duty because no override exists for that class.
            </li>
            <li>
              <Em>Did you save the override?</Em> Ensure the override actually appears in bold on the Account's Contract Terms tab.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The mileage charge is zero</H4>
          <UnorderedList>
            <li>
              <Em>Did the trip exceed the Free Miles Included?</Em> If you configured 10 free miles, and the trip is 8 miles, the mileage charge is correctly zero.
            </li>
            <li>
              <Em>Did the intake form capture valid GPS coordinates?</Em> If the addresses were typed manually without using the autocomplete dropdown, the system may not have the lat/lng coordinates required to calculate distance.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Do Dynamic Pricing tiers (like Weather) apply to Account Rate Cards?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            No, not automatically. Account rates are contractually fixed. To apply a dynamic pricing multiplier to a motor club or commercial account, you must use the <Em>Tier Offer Composer</Em> to negotiate a temporary event rate with them.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">Can I override the rate for a specific location, like an impound yard?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Not currently. Overrides are set per-Service and per-Vehicle Class. Location-based pricing (e.g., zone pricing) is handled via custom line items added manually by the dispatcher.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/daily-operations/call-intake"
            title="The Call Intake Workflow: From Phone Call to Dispatch"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/advanced-features/dynamic-pricing"
            title="Dynamic Pricing: How to Configure and Activate Tiers"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
