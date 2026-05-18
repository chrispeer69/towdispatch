/**
 * Dynamic Pricing article body.
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
// Article — Dynamic Pricing
// =====================================================================

export function DynamicPricingArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        During a snowstorm, your costs go up. Trucks move slower, drivers take longer on scene, and the risk of an accident multiplies. If you are charging the same flat rate on a sunny Tuesday as you do during a Level-2 snow emergency, you are leaving money on the table.
      </P>
      <P>
        The <Em>Dynamic Pricing Engine</Em> allows you to pre-configure premium pricing tiers for five categories: Weather, Traffic, Calendar (Holidays), Time of Day, and Special Events. When an event hits, you activate the tier with one click, and every cash and account quote instantly reflects the premium rate.
      </P>

      <H2>Overview</H2>
      <P>
        The Dynamic Pricing Engine sits between the Call Intake form and the Rate Engine. When a dispatcher enters a job, the system checks the active tiers, multiplies them together, and applies them to the base rate.
      </P>
      <P>
        Because dynamic pricing is a powerful tool, it is split into two separate screens to prevent accidental changes during a chaotic shift:
      </P>
      <UnorderedList>
        <li><Em>Settings → Dynamic Pricing:</Em> This is where Owners and Admins <Em>configure</Em> the tiers (set the multipliers, define the holidays).</li>
        <li><Em>Operations → Dynamic Pricing (The Control Panel):</Em> This is where Managers and Dispatchers <Em>activate</Em> or deactivate the tiers in real-time.</li>
      </UnorderedList>

      <Callout tone="warning" title="Who gets charged the premium?">
        By default, Dynamic Pricing applies to <Em>Cash Customers</Em> and <Em>Commercial Accounts</Em>. It does <Em>not</Em> automatically apply to Motor Clubs (like Agero or AAA) because their rates are contractually fixed. To charge a Motor Club a dynamic rate, you must use the <Em>Tier Offer Composer</Em> to negotiate an event-specific contract with them first.
      </Callout>

      <H2>The 5 Tier Categories</H2>
      <P>
        You can configure multipliers for any or all of these categories.
      </P>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Weather (NOAA)
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Triggered by severe weather.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Pre-loaded with 12 NOAA alert types (e.g., Winter Storm Warning, Hurricane Warning).</li>
            <li>Default multiplier is 1.5×.</li>
            <li>You activate these manually when the storm hits your service area.</li>
          </ul>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Calendar (Holidays)
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Triggered by the date.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Pre-loaded with 14 US federal holidays.</li>
            <li>Default multiplier is 1.5× (2.0× for Christmas and New Year's Day).</li>
            <li>These activate automatically at midnight on the holiday.</li>
          </ul>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Time of Day
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Triggered by the clock.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Used for "After Hours" or "Night Shift" premiums.</li>
            <li>Example: 1.2× multiplier from 8:00 PM to 6:00 AM.</li>
            <li>Activates automatically on a daily schedule.</li>
          </ul>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Special Events & Traffic
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Triggered by local knowledge.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Used for major concerts, sporting events, or highway closures.</li>
            <li>Example: "OSU Home Game" at 1.4×.</li>
            <li>You create and activate these manually.</li>
          </ul>
        </div>
      </div>

      <H2>Worked Example: Activating a Snowstorm Tier</H2>
      <P>
        It is 2:00 PM on a Friday. A massive winter storm just hit your city. Call volume is spiking and your trucks are crawling at 15 mph. You need to activate your weather pricing.
      </P>

      <H3>Step 1: Open the Control Panel</H3>
      <OrderedList>
        <li>
          Navigate to <Em>Operations → Dynamic Pricing</Em> (the lightning bolt icon in the sidebar).
        </li>
        <li>
          This is the Control Panel. In Section 1 ("Active tiers right now"), you see no weather tiers are currently active.
        </li>
      </OrderedList>

      <H3>Step 2: Activate the Tier</H3>
      <OrderedList>
        <li>
          Scroll down to Section 3 ("Manual Overrides & Activations").
        </li>
        <li>
          Find the <Em>Winter Storm Warning</Em> tier in the list. It shows your pre-configured 1.5× multiplier.
        </li>
        <li>
          Click the <Code>Activate</Code> button next to it.
        </li>
        <li>
          The system prompts you to set an auto-revert time (e.g., "Turn off automatically in 12 hours"). This prevents you from accidentally leaving storm pricing on for three days after the snow melts.
        </li>
        <li>
          Click Confirm. The tier moves to the "Active tiers right now" section.
        </li>
      </OrderedList>

      <H3>Step 3: Take Calls</H3>
      <P>
        You don't have to tell your dispatchers to do anything differently.
      </P>
      <OrderedList>
        <li>
          A dispatcher takes a cash call and enters the details into the Intake form.
        </li>
        <li>
          The Live Quote Box normally calculates $100 for this tow.
        </li>
        <li>
          Because the Winter Storm tier is active, the engine instantly multiplies the base rate by 1.5. The Live Quote Box displays $150.00, with a line item clearly labeled "Dynamic Pricing: Winter Storm Warning (1.5×)".
        </li>
        <li>
          The dispatcher quotes $150.00 to the customer.
        </li>
      </OrderedList>

      <H2>How Multipliers Stack (The 3.0× Cap)</H2>
      <P>
        What happens if it's Christmas Day (2.0×) AND there is a Winter Storm (1.5×)?
      </P>
      <P>
        The engine <Em>multiplies</Em> the active tiers together: 2.0 × 1.5 = 3.0. A $100 tow becomes $300.
      </P>
      <P>
        To protect you from accidentally quoting a customer $800 for a tow because four different tiers stacked, the system enforces a <Em>Global Cap</Em>. By default, this is set to 3.0×. Even if the math says the multiplier should be 4.5×, the engine will stop at 3.0×. You can change this cap in <Em>Settings → Dynamic Pricing</Em>.
      </P>

      <H2>Troubleshooting Tree</H2>
      <P>
        If the quote box isn't showing the premium you expect, check these common issues.
      </P>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: I activated a tier, but the quote didn't change</H4>
          <UnorderedList>
            <li>
              <Em>Is the Customer Type set to Account/Motor Club?</Em> As noted above, Dynamic Pricing does not apply to motor clubs by default. Change the Customer Type to "Cash" to verify the tier is working.
            </li>
            <li>
              <Em>Did you hit the Global Cap?</Em> If you already have a 3.0× holiday active, turning on a 1.5× weather tier won't increase the price further because you've hit the ceiling.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A holiday tier didn't activate automatically</H4>
          <UnorderedList>
            <li>
              <Em>Is the holiday toggled "On" in Settings?</Em> Navigate to <Em>Settings → Dynamic Pricing</Em>, click "Configure" on the Calendar card, and ensure the specific holiday has the green "Enabled" switch turned on. If it's disabled, the system will ignore it.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can I override the dynamic price on a specific call?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. On the Intake form, click the "Edit" icon next to the Total in the Live Quote Box. You can type in any dollar amount you want, overriding both the base rate and the dynamic multipliers. You will be required to select a Reason Code (e.g., "Manager Approved Discount") for the audit log.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">Does the customer see the multiplier on their receipt?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. The invoice generates a specific line item for the premium (e.g., "Event Premium: Winter Storm"). Transparency reduces chargebacks.
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
            href="/help/advanced-features/tier-offer-composer"
            title="The Tier Offer Composer: Negotiating with Motor Clubs"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
