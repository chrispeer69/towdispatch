/**
 * Daily Operations article bodies.
 *
 * Each export is a React component rendered inside the article surface
 * wrapper. Articles follow the Manus-grade deep structure template:
 *   1. Overview (the concept and the why)
 *   2. When to use what (decision panels)
 *   3. Worked Examples (step-by-step with real-world context)
 *   4. Troubleshooting Tree (branching diagnoses)
 *   5. FAQ
 *   6. Related Concepts
 */
import { CustomerLink, JobLink } from '@/components/ui/entity-link';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

// =====================================================================
// Shared building blocks (copied from getting-started.tsx for isolation)
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
// Article 1 — The Call Intake Workflow
// =====================================================================

export function CallIntakeArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        The <Em>Call Intake</Em> form is the front door of your operation. It is designed for speed: when a customer is stranded on the side of a highway, your dispatcher needs to capture the vehicle, location, and service type, generate an accurate price quote, and dispatch a truck in under 60 seconds.
      </P>
      <P>
        This guide covers the concepts behind the intake flow, when to use different intake paths, and provides a complete worked example of a live call.
      </P>

      <H2>Overview</H2>
      <P>
        US Tow DISPATCH separates the <Em>quote</Em> from the <Em>job</Em>. As you type into the intake form, the <Em>Live Quote Box</Em> on the right side of the screen updates instantly. It reads the customer type (Cash vs. Account), the vehicle class (Light Duty vs. Heavy Duty), the service type, and the computed road miles, then runs them through your rate engine. 
      </P>
      <P>
        You can quote a customer without saving anything. Only when you click <Code>Create Job</Code> does the system generate a job number, save the customer record, and push the call to the Live Dispatch Board.
      </P>

      <Callout tone="tip" title="The Golden Rule of Intake">
        Start with the <Em>Phone Number</Em>. When you type a phone number, the system instantly searches your database. If the customer has called before, their name, email, and previous vehicles populate automatically. This saves 20 seconds of typing on repeat callers.
      </Callout>

      <H2>When to use what</H2>
      <P>
        The intake form adapts to the type of customer calling. The very first choice you make—the <Em>Customer Type</Em> toggle—changes how the rest of the form behaves.
      </P>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Cash Customer
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Use for private individuals paying out of pocket.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Uses your default Master Rate Sheet.</li>
            <li>Dynamic Pricing tiers (weather, time of day) apply automatically.</li>
            <li>Payment is expected at the scene or via emailed checkout link.</li>
          </ul>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Account / Motor Club
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Use for Agero, Allstate, AAA, police departments, or commercial fleets.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Requires selecting the specific Account from a dropdown.</li>
            <li>Uses the Account's custom rate card (overriding the Master Rate Sheet).</li>
            <li>Bypasses standard Dynamic Pricing unless the account has specifically opted in to a Tier Offer.</li>
            <li>Billed via invoice on net terms.</li>
          </ul>
        </div>
      </div>

      <H2>Worked Example: A Cash Tow Call</H2>
      <P>
        Let's walk through a real-world scenario. The phone rings. The caller is Maria, whose 2020 Toyota Camry broke down at Easton Town Center and needs a tow to Buckeye Auto Repair.
      </P>

      <H3>Step 1: Customer Identity</H3>
      <OrderedList>
        <li>
          Leave the Customer Type as <Code>Cash</Code>.
        </li>
        <li>
          Ask for her phone number and type it into the <Em>Phone</Em> field: <Code>614-555-0199</Code>.
        </li>
        <li>
          Because she hasn't called before, no record pops up. Type her name: <Code>Maria Sanchez</Code>.
        </li>
      </OrderedList>

      <H3>Step 2: Vehicle Details</H3>
      <OrderedList>
        <li>
          Ask for the vehicle year, make, and model. Type <Code>2020</Code>, <Code>Toyota</Code>, <Code>Camry</Code>.
        </li>
        <li>
          <Em>Optional but recommended:</Em> Ask for the license plate and state. Type <Code>OH</Code> and <Code>AAA1234</Code>. This is crucial if the vehicle ends up in your impound yard later.
        </li>
        <li>
          The system automatically classifies a Camry as <Code>Light Duty</Code>. You do not need to change the Vehicle Class dropdown.
        </li>
      </OrderedList>

      <H3>Step 3: Service and Location</H3>
      <OrderedList>
        <li>
          Select <Code>Tow</Code> from the Service Type buttons.
        </li>
        <li>
          In the <Em>Pickup</Em> field, start typing <Code>Easton Town</Code>. The Mapbox autocomplete dropdown appears. Click the suggestion for Easton Town Center. The system instantly captures the GPS coordinates.
        </li>
        <li>
          In the <Em>Dropoff</Em> field, start typing <Code>Buckeye Auto Repair</Code> and select the matching address.
        </li>
      </OrderedList>

      <H3>Step 4: The Live Quote</H3>
      <P>
        Look at the right side of your screen. The Live Quote Box has already done the math:
      </P>
      <UnorderedList>
        <li>It added the Light Duty Tow base fee.</li>
        <li>It calculated the road miles from Easton Town Center to Buckeye Auto Repair.</li>
        <li>It subtracted your "free miles included" and applied your per-mile rate to the remainder.</li>
        <li>If it's currently raining and you have a Weather tier active, it applied the 1.2× multiplier.</li>
      </UnorderedList>
      <P>
        You can now read the total to Maria: <Em>"Maria, the total for that tow will be $145.00. Should I send a truck?"</Em>
      </P>

      <H3>Step 5: Dispatch</H3>
      <OrderedList>
        <li>
          Maria says yes. Click the <Code>Create Job</Code> button.
        </li>
        <li>
          The screen clears, a success toast appears with the new Job Number, and the job instantly appears on the Live Dispatch Board in the <Em>New</Em> column, ready for a driver assignment.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>
      <P>
        When things don't behave as expected during a fast-moving call, use this branching guide to find the fix.
      </P>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The Live Quote says $0.00</H4>
          <UnorderedList>
            <li>
              <Em>Is the Customer Type set to Account?</Em> If yes, you must select an Account from the dropdown. If the selected account has no rate card configured, the quote defaults to zero.
            </li>
            <li>
              <Em>Is the Service Type selected?</Em> The quote engine cannot run until it knows whether it's pricing a Tow, a Jump Start, or a Lockout.
            </li>
            <li>
              <Em>Are the addresses complete?</Em> If you typed an address manually without clicking a dropdown suggestion, the system may not have captured the GPS coordinates required to calculate mileage.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The mileage seems wrong</H4>
          <UnorderedList>
            <li>
              <Em>Did you enter a Dispatch Yard in your Company Profile?</Em> The system calculates "Enroute Miles" (deadhead from your yard to the pickup). If you haven't set your yard's address in <Em>Settings → Company</Em>, the system cannot calculate enroute miles and will only bill for the in-tow leg.
            </li>
            <li>
              <Em>Is it an air-mile vs. road-mile difference?</Em> The intake form displays a quick "straight-line" distance hint next to the address box for speed. The actual invoice and rate quote use true road miles calculated via the Mapbox Directions API, which accounts for roads and one-ways. The quote box is always the accurate number.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: I need to override the quoted price</H4>
          <P>
            Sometimes the engine quotes $145, but the customer only has $120 cash and your manager approves the discount. 
          </P>
          <UnorderedList>
            <li>
              Click the <Code>Edit</Code> icon next to the Total in the Live Quote Box.
            </li>
            <li>
              Enter <Code>120.00</Code> as the new total.
            </li>
            <li>
              Select a Reason Code (e.g., "Manager Approved Discount"). This ensures the discrepancy is logged for the accounting team and won't trigger an audit flag later.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Do I have to enter the VIN?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            No. The VIN is optional at intake. If you don't have it, the driver can scan the VIN barcode with their mobile app when they arrive on scene, and the system will automatically decode the year, make, and model and update the job record.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">What if the customer doesn't know the exact address?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            The Mapbox autocomplete supports landmarks and intersections. You can type "I-71 North MM 110" or "Target at Easton" and the system will resolve the closest GPS coordinates.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">Can I send an SMS tracking link from intake?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. By default, when you click Create Job, the system sends an SMS to the customer's phone number with a magic link to track their tow. If the caller is not the vehicle owner (e.g., a parent calling for a child), you can check the "Skip SMS" box before creating the job to prevent confusing texts.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/daily-operations/live-dispatch-board"
            title="Managing the Live Dispatch Board"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/advanced-features/account-rate-cards"
            title="Account Rate Cards: Managing Commercial Pricing"
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
