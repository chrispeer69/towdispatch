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
// Article — Assigning and Reassigning Drivers
// =====================================================================

export function AssigningDriversArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Assigning the right driver to the right job is the core of dispatching. US Tow DISPATCH
        provides two ways to do this: the <Em>Live Dispatch Board</Em> for rapid, map-assisted
        assignments, and the dedicated <Em>Assign Jobs</Em> page for batching and queue management.
      </P>
      <P>
        This guide covers both methods, explains how the system ranks drivers by proximity, and
        walks through the process of pulling a job off one driver and giving it to another when
        plans change.
      </P>

      <H2>Overview</H2>
      <P>
        When a job is created, it starts in the <Em>New</Em> state with no driver attached. To move
        it to <Em>Dispatched</Em>, you must select an active driver shift.
      </P>
      <P>
        The system only allows you to assign jobs to drivers who are currently <Em>On Duty</Em>{' '}
        (they have an active shift). If a driver is not clocked in, they will not appear in the
        assignment list.
      </P>

      <Callout tone="tip" title="Proximity Ranking">
        When you open the assignment panel for a job, the system automatically ranks your on-duty
        drivers by their distance to the pickup location. This uses the driver's last known GPS
        ping. The closest driver is always at the top of the list.
      </Callout>

      <H2>When to use what</H2>
      <P>You can assign jobs from two different screens depending on your workflow.</P>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Live Dispatch Board
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Use this for immediate, one-off assignments while watching the map.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Best for hot calls that need a driver right now.</li>
            <li>Shows the pickup location on the map alongside driver pins.</li>
            <li>Keeps you in the main operational view.</li>
          </ul>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            Assign Jobs Page
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Use this for queue management and batch assignments.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary-on-dark">
            <li>Best for morning rollout when assigning 10+ jobs at once.</li>
            <li>Dedicated full-screen list of unassigned work.</li>
            <li>Clearer view of each driver's current backlog.</li>
          </ul>
        </div>
      </div>

      <H2>Worked Example: Reassigning a Broken-Down Truck</H2>
      <P>
        Let's walk through a common scenario. Driver A is en route to a tow, but calls in to say
        their truck blew a tire. You need to pull the job off Driver A and give it to Driver B.
      </P>

      <H3>Step 1: Unassign Driver A</H3>
      <OrderedList>
        <li>
          On the Live Dispatch Board, find the job card under the <Em>En Route</Em> column (or under
          Driver A's column if you are grouped by driver).
        </li>
        <li>
          Click the <Code>Reassign</Code> button on the job card.
        </li>
        <li>
          The assignment panel slides out. Click the <Code>Unassign</Code> button next to Driver A's
          name.
        </li>
        <li>
          The job instantly moves back to the <Em>New</Em> column, and its status resets from En
          Route back to New.
        </li>
      </OrderedList>

      <H3>Step 2: Assign Driver B</H3>
      <OrderedList>
        <li>
          Now that the job is back in the <Em>New</Em> column, click the <Code>Assign</Code> button
          on it.
        </li>
        <li>
          The assignment panel opens. The system shows you that Driver B is 4 miles away, and Driver
          C is 12 miles away.
        </li>
        <li>
          Click <Code>Assign</Code> next to Driver B.
        </li>
        <li>
          The job moves to the <Em>Dispatched</Em> column. Driver B receives a push notification on
          their phone with the new job details.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>
      <P>When you can't assign a job, check these common causes.</P>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A specific driver doesn't appear in the assignment list</H4>
          <UnorderedList>
            <li>
              <Em>Are they clocked in?</Em> The list only shows drivers with an active shift. Go to{' '}
              <Em>Trucks/Drivers</Em> and check if they have a shift open. If not, they need to log
              in to the driver app and start their shift.
            </li>
            <li>
              <Em>Did they just clock out?</Em> If they ended their shift, they immediately
              disappear from the assignment pool to prevent accidental dispatches to off-duty staff.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The distance rankings say "Unknown" for everyone</H4>
          <UnorderedList>
            <li>
              <Em>Does the job have a valid pickup address?</Em> If the job was created with a vague
              address that couldn't be geocoded (no lat/lng), the system cannot calculate the
              distance from the drivers to the pickup.
            </li>
            <li>
              <Em>Are the drivers sending GPS?</Em> If the drivers have denied location permissions
              on their devices, the system doesn't know where they are, so it cannot rank them by
              proximity.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">
            Does reassigning a job notify the customer?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            If the customer is watching the live tracking link, the map will instantly update to
            show the new driver's truck and the new ETA. They do not receive a new SMS text message
            unless you manually trigger one.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">
            Can I assign a job to a driver who is already on a call?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. The job will be added to their queue. When they finish their current job, this one
            will be waiting for them as their next task.
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
            href="/help/daily-operations/driver-shift-dvir"
            title="Driver Shift Check-In and DVIRs"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
