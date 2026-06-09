/**
 * Driver Shift Check-In and DVIRs article body.
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
// Article — Driver Shift Check-In and DVIRs
// =====================================================================

export function DriverShiftArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        The driver's day begins before they ever receive a dispatch. US Tow Dispatch enforces a
        structured sign-in workflow that protects your business from liability, ensures FMCSA
        compliance, and keeps your dispatch board accurate.
      </P>
      <P>
        This guide covers the three steps every driver must complete to appear "On Duty": PIN
        authentication, the mandatory daily briefing, and the Pre-Trip DVIR (Driver Vehicle
        Inspection Report).
      </P>

      <H2>Overview</H2>
      <P>
        We designed the driver login process to be fast for the driver but rigorous for the back
        office. Drivers do not type complex passwords; they use a 4-digit PIN. However, they cannot
        simply bypass safety protocols. The system forces them through a mandatory briefing (which
        you control) and a vehicle inspection before they can accept a single job.
      </P>

      <Callout tone="tip" title="Why this matters">
        If a driver is involved in an accident, plaintiff attorneys will immediately subpoena their
        training records and pre-trip inspections. By forcing the driver to acknowledge a safety
        video and sign a DVIR before the system allows them to drive, you create an unassailable,
        timestamped audit trail that proves your company enforces safety standards.
      </Callout>

      <H2>The 3-Step Check-In Workflow</H2>

      <H3>Step 1: PIN Authentication</H3>
      <P>
        When a driver opens the app (or navigates to the driver web portal), they are presented with
        a list of active drivers for your company.
      </P>
      <OrderedList>
        <li>The driver taps their name.</li>
        <li>They enter their unique 4-digit PIN.</li>
        <li>
          If entered incorrectly 5 times, the account locks for 30 minutes (an Admin must unlock it
          in <Em>Settings → Users</Em>).
        </li>
      </OrderedList>

      <H3>Step 2: The Mandatory Daily Briefing</H3>
      <P>
        Upon their <Em>first login of the calendar day</Em>, the driver is intercepted by the Daily
        Briefing screen. This screen is configured by you (the Owner or Admin) in the back office.
      </P>
      <OrderedList>
        <li>
          The driver must read the custom text message (e.g., "Watch out for ice on I-71 North
          today. Chains required.").
        </li>
        <li>
          If you have uploaded a safety video, the driver <Em>must</Em> watch it. The "Acknowledge"
          button remains disabled until the video has played for its minimum required duration
          (usually 60 seconds).
        </li>
        <li>
          The driver taps <Code>Acknowledge</Code>. The system logs their IP address and the exact
          timestamp of their acknowledgment.
        </li>
      </OrderedList>
      <P>
        If the driver logs out and logs back in later the same day, the system skips this step. They
        only see it once per day.
      </P>

      <H3>Step 3: Pre-Trip DVIR (Driver Vehicle Inspection Report)</H3>
      <P>
        Before the driver can mark themselves "Available," they must select the truck they are
        driving and complete a DVIR.
      </P>
      <OrderedList>
        <li>The driver selects their truck from the fleet dropdown.</li>
        <li>They enter the current odometer reading.</li>
        <li>
          They walk around the truck, checking off items (Brakes, Lights, Tires, Fluids,
          Straps/Chains, PTO/Winch).
        </li>
        <li>
          If they mark an item as "Failed," they must upload a photo and type a note explaining the
          defect.
        </li>
        <li>
          They select an overall status: <Code>Pass</Code>, <Code>Fail (Safe to Drive)</Code>, or{' '}
          <Code>Fail (Unsafe)</Code>.
        </li>
        <li>They sign the screen with their finger and submit.</li>
      </OrderedList>

      <Callout tone="warning" title="Failing a DVIR">
        If a driver submits a DVIR with the status <Code>Fail (Unsafe)</Code>, the system{' '}
        <Em>blocks</Em> their shift from starting. They will not appear on the Live Dispatch Board,
        and they cannot be assigned jobs. An Admin or Manager must review the truck, repair it, and
        clear the status before that truck can be dispatched again.
      </Callout>

      <H2>Troubleshooting Tree</H2>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A driver is locked out of their account</H4>
          <UnorderedList>
            <li>
              <Em>Did they forget their PIN?</Em> Navigate to <Em>Settings → Users</Em> (or the
              Fleet Drivers list), find the driver, and click <Code>Reset PIN</Code>. You can assign
              them a new 4-digit PIN immediately.
            </li>
            <li>
              <Em>Did they trigger the brute-force lock?</Em> If they guessed wrong 5 times, the
              system locks them out to prevent unauthorized access. An Admin can click{' '}
              <Code>Clear Lockout</Code> on their profile to let them try again immediately.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The driver says the "Acknowledge" button is broken</H4>
          <UnorderedList>
            <li>
              <Em>Did they watch the video?</Em> The button remains grayed out until the video
              player reports that the required duration has been reached. Tell the driver they
              cannot skip the video.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A driver is clocked in but not on the dispatch board</H4>
          <UnorderedList>
            <li>
              <Em>Did they submit an "Unsafe" DVIR?</Em> Check the <Em>Trucks/Drivers</Em> tab. If
              their truck is flagged red, their shift was aborted for safety.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">
            How do I change the daily briefing video?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Admins can update the active briefing by navigating to <Em>Settings → Driver App</Em>{' '}
            and uploading a new video or editing the text. The new briefing takes effect immediately
            for any driver who hasn't logged in yet today.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">
            Can a driver switch trucks mid-shift?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. The driver must clock out of their current shift (which releases the first truck)
            and clock back in. They will skip the daily briefing (since they already did it today)
            but they <Em>must</Em> complete a new DVIR for the new truck.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/daily-operations/assigning-drivers"
            title="Assigning and Reassigning Drivers"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/company-policies/driver-conduct"
            title="Driver Conduct & Safety Standards"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
