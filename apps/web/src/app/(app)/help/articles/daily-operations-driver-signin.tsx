/**
 * Daily Operations article bodies. Each article follows the standard
 * five-section template (Purpose / Prerequisites / Step-by-Step / Common
 * Mistakes / Related Documents).
 */
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

function H2({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="font-condensed mt-8 text-2xl font-extrabold uppercase tracking-tight text-text-primary-on-dark">
      {children}
    </h2>
  );
}
function H3({ children }: { children: ReactNode }): JSX.Element {
  return <h3 className="mt-6 text-base font-semibold text-text-primary-on-dark">{children}</h3>;
}
function P({ children }: { children: ReactNode }): JSX.Element {
  return <p className="mt-3 text-sm leading-7 text-text-primary-on-dark/90">{children}</p>;
}
function Em({ children }: { children: ReactNode }): JSX.Element {
  return <strong className="font-semibold text-text-primary-on-dark">{children}</strong>;
}
function Code({ children }: { children: ReactNode }): JSX.Element {
  return (
    <code className="rounded bg-bg-surface-elevated px-1 py-0.5 font-mono text-[12px] text-brand-primary">
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
    <div className={`mt-4 rounded-[10px] border ${accent} p-4`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark">
        {title}
      </p>
      <div className="mt-1 text-sm leading-7 text-text-primary-on-dark/90">{children}</div>
    </div>
  );
}
function OrderedList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm leading-7 text-text-primary-on-dark/90">
      {children}
    </ol>
  );
}
function UnorderedList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-7 text-text-primary-on-dark/90">
      {children}
    </ul>
  );
}
function RelatedDoc({ href, title }: { href: string; title: string }): JSX.Element {
  return (
    <Link href={href} className="text-brand-primary hover:underline">
      {title}
    </Link>
  );
}

export function DriverSigninAndBriefingArticle(): JSX.Element {
  return (
    <article>
      <H2>Purpose</H2>
      <P>
        Every shift in US Tow DISPATCH starts in the same place: the driver signs into the in-truck
        app with a 4-digit PIN, acknowledges the daily briefing if one has been published, and
        completes a pre-trip vehicle inspection. This article walks a driver through that 90-second
        sequence and shows managers exactly what's recorded on the office side so the audit trail
        holds up under DOT or insurance scrutiny.
      </P>
      <P>
        The driver app lives at <Code>/driver</Code> in a browser. It works on any phone or tablet
        running iOS Safari or Chrome — Android Chrome is the dispatcher-issued default. Sign-in is a
        separate session from the operator dashboard; a driver who is also a dispatcher will sign
        into each surface independently with different credentials.
      </P>

      <H2>Prerequisites</H2>
      <UnorderedList>
        <li>
          The driver record exists in{' '}
          <RelatedDoc href="/admin/drivers" title="Settings → Drivers" /> and is marked active.
        </li>
        <li>
          A 4-digit PIN has been enrolled by an OWNER/ADMIN/MANAGER on the office side. New drivers
          receive a "Set your PIN" prompt the first time they sign in — they tell dispatch the
          digits in person.
        </li>
        <li>
          The driver knows the <Em>workshop slug</Em>. It's the short lowercase identifier for the
          towing company — typically the same slug used on the dispatcher login page.
        </li>
        <li>
          The driver is qualified to operate at least one truck (Settings → Fleet → Trucks → Driver
          Qualifications).
        </li>
      </UnorderedList>

      <H2>Step-by-Step Guide</H2>

      <H3>1. Open the driver app</H3>
      <P>
        On the phone or dashboard tablet, open the browser and navigate to the company's URL
        followed by <Code>/driver</Code>. Example: <Code>https://app.ustowdispatch.com/driver</Code>
        . Bookmark this for one-tap access. Drivers should add this to the home screen so it
        launches in full-screen mode.
      </P>

      <H3>2. Enter the workshop slug</H3>
      <P>
        First-time use only — the slug is remembered between sessions. Type the slug exactly
        (lowercase, dashes allowed) and tap <Em>Next</Em>. If the slug is wrong the app surfaces a
        friendly <Em>"We couldn't find that workshop"</Em> error.
      </P>
      <Callout tone="tip" title="Tip">
        Dispatchers should print the slug on a sticker stuck to the dashboard mount. Drivers
        shouldn't have to memorize a URL.
      </Callout>

      <H3>3. Tap your name</H3>
      <P>
        The picker shows every active driver for the workshop, alphabetized by last name. Each row
        is a 56-pixel tap target — designed for use with gloves on. Tap your name (or the "Not me"
        link to go back).
      </P>

      <H3>4. Enter your 4-digit PIN</H3>
      <P>
        The on-screen keypad replaces the native keyboard so the driver doesn't fight predictive
        text. Five wrong PINs in a fifteen-minute window locks the account for 30 minutes — the app
        shows a countdown and a <Em>Call dispatch</Em> button so dispatch can clear the lock
        immediately (Settings → Drivers → Clear PIN lockout).
      </P>

      <H3>5. Acknowledge the daily briefing</H3>
      <P>
        If an admin published a briefing for today, the driver sees an unmissable banner. The banner
        shows the admin's written message, an embedded video (if any), and a single checkbox:{' '}
        <Em>"I have read and watched the briefing for today."</Em> The acknowledge button is
        disabled until that box is checked.
      </P>
      <P>
        Acknowledgment records the driver's id, the briefing id, the timestamp, IP, and user agent.
        That ledger is the legal proof that the driver saw the safety alert — keep it intact in
        audits.
      </P>
      <Callout tone="info" title="What if no briefing is shown?">
        That just means the admin hasn't published one for the day. Drivers proceed straight to the
        shift control card. A green pill (<Em>✓ Today's briefing acknowledged</Em>) appears at the
        top of the workspace once the day's briefing has been acknowledged.
      </Callout>

      <H3>6. Start your shift</H3>
      <P>
        Tap <Em>Start shift</Em>. A dialog lists every truck the driver is qualified to operate. Tap
        the truck for the day. The app calls
        <Code>POST /driver-shifts/check-in</Code> with the chosen truck id; GPS tracking begins
        immediately and the dispatcher sees the truck light up on the dispatch board.
      </P>

      <H3>7. Capture the pre-trip inspection</H3>
      <P>
        Until the DVIR is captured for the active shift, the driver
        <Em>cannot</Em> open jobs. The pre-trip page walks through four accordions:
      </P>
      <UnorderedList>
        <li>
          <Em>Exterior:</Em> lights, mirrors, body damage.
        </li>
        <li>
          <Em>Tires, brakes, wheels:</Em> tread, pressure, brake hold.
        </li>
        <li>
          <Em>Wrecker equipment:</Em> boom, cables, hooks, warning lights.
        </li>
        <li>
          <Em>Safety & cab:</Em> horn, wipers, fluids, first-aid kit.
        </li>
      </UnorderedList>
      <P>
        Each item is one tap: <Em>Pass</Em>, <Em>N/A</Em>, or <Em>Fail</Em>. A <Em>Fail</Em> opens a
        note field and a camera capture — both are required to record the fail. If any{' '}
        <Em>brakes</Em>, <Em>tires</Em>, <Em>warning lights</Em>, or <Em>cables/chains</Em> item
        fails, the truck is flagged <Em>DVIR fail — see admin</Em> and the driver is hard-blocked
        from jobs until dispatch clears the truck.
      </P>

      <H3>8. Take your first job</H3>
      <P>
        With the DVIR captured and the briefing acknowledged, the workspace shows the active job
        list. Tap a job to open the job execution screen — that's where state transitions, photo
        evidence, signature capture, and field payment live.
      </P>

      <H2>Common Mistakes & Troubleshooting</H2>

      <H3>"My PIN keeps failing"</H3>
      <P>
        After five wrong attempts the account locks for 30 minutes. The driver sees a countdown on{' '}
        <Code>/driver/locked</Code>. To unlock immediately, dispatch opens the driver record and
        clicks <Em>Clear PIN lockout</Em>. If the driver has actually forgotten the PIN, dispatch
        rotates it (Settings → Drivers → Rotate PIN) and tells the driver the new digits in person.
      </P>

      <H3>"I can't see any trucks in the Start Shift dialog"</H3>
      <P>
        The driver isn't qualified on any active truck. Dispatch adds the qualification at Settings
        → Fleet → Trucks → Driver Qualifications, or from the driver's profile page. Refresh the
        workspace once added.
      </P>

      <H3>"The pre-trip page says 'Start a shift before submitting'"</H3>
      <P>
        The DVIR is bound to a shift. Pick the truck from the workspace first; then tap{' '}
        <Em>Start DVIR</Em>.
      </P>

      <H3>"I marked something as Fail but the app won't let me submit"</H3>
      <P>
        Failed items require a free-text note (max 500 characters) and at least one photo (camera
        capture). Scroll inside the accordion and complete both.
      </P>

      <H3>"My connection dropped mid-shift"</H3>
      <P>
        Every mutation — status transitions, photo uploads, payment intents — is buffered to the
        local queue when offline. The pending count shows up as a chip at the top of every page.
        When the connection comes back the queue replays automatically; the driver can also tap
        <Em>Offline queue → Retry all</Em> from the workspace quick actions.
      </P>

      <H2>Related Documents</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/daily-operations/driver-shift-dvir"
            title="Driver Shift Check-In and DVIRs (deep-dive)"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/daily-operations/capturing-evidence"
            title="Capturing Field Evidence (Photos, Videos, Signatures)"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/getting-started/inviting-users"
            title="Inviting Users (and enrolling drivers)"
          />
        </li>
      </UnorderedList>
    </article>
  );
}
