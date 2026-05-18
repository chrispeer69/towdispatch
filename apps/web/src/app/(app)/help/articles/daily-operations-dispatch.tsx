/**
 * Live Dispatch Board article body.
 */
import { CustomerLink, JobLink } from '@/components/ui/entity-link';
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
// Article — Managing the Live Dispatch Board
// =====================================================================

export function LiveDispatchBoardArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        The <Em>Live Dispatch Board</Em> is the nerve center of your towing operation. It is a real-time, self-updating workspace where your dispatchers can see every active job, track driver locations on the map, monitor ETAs, and respond instantly to changing conditions in the field.
      </P>
      <P>
        This guide explains how to read the board, how jobs move through the columns, and how to use the map and grouping tools to optimize your fleet routing.
      </P>

      <H2>Overview</H2>
      <P>
        Unlike legacy systems where you have to constantly hit "Refresh" to see updates, the US Tow DISPATCH board is <Em>reactive</Em>. When a driver marks a job "On Scene" from their mobile app, the job card instantly jumps to the next column on your screen. When a truck moves down the highway, its pin moves on the map.
      </P>
      <P>
        The board is divided into two halves: the <Em>Kanban Columns</Em> (the workflow) and the <Em>Live Map</Em> (the geography).
      </P>

      <Callout tone="tip" title="The Golden Rule of Dispatch">
        Keep the "New" column empty. A job sitting in "New" means the customer is waiting, but no driver has been assigned to head their way. Your primary goal as a dispatcher is to move jobs from left to right as fast as possible.
      </Callout>

      <H2>The Kanban Columns: Understanding Job States</H2>
      <P>
        Every active job lives in exactly one column. The columns represent the state machine of a tow.
      </P>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            1. New
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Jobs just created via Call Intake or the API. They have no driver assigned. They need your attention immediately.
          </p>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            2. Dispatched
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            A driver has been assigned to the job, but they haven't started driving toward the pickup location yet.
          </p>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            3. En Route
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            The driver is actively driving to the pickup. This is when the ETA calculation matters most.
          </p>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            4. On Scene
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            The driver has arrived at the pickup location and is hooking the vehicle or performing the service.
          </p>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            5. In Progress
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            The vehicle is loaded and the driver is actively towing it to the dropoff location.
          </p>
        </div>
        <div className="rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-5">
          <h4 className="font-condensed text-lg font-extrabold uppercase tracking-wide text-text-primary-on-dark">
            6. Recently Completed
          </h4>
          <p className="mt-2 text-sm text-text-secondary-on-dark">
            Jobs finished today. They stay here until midnight, then clear off the board to keep it clean.
          </p>
        </div>
      </div>

      <H2>Worked Example: Managing a Busy Morning</H2>
      <P>
        It's 8:00 AM on a Tuesday. It's raining. You have three drivers on duty and four jobs hit the board simultaneously.
      </P>

      <H3>Step 1: Reading the Board</H3>
      <OrderedList>
        <li>
          Look at the <Em>New</Em> column. You see four job cards. Each card shows the customer name, the vehicle, the pickup address, and the service type.
        </li>
        <li>
          Click the <Code>Group by Driver</Code> toggle at the top of the board. The columns rearrange to show you what each of your three drivers is currently doing. You see that Driver A is empty, Driver B is <Em>En Route</Em> to a jump start, and Driver C is <Em>In Progress</Em> on a long tow.
        </li>
      </OrderedList>

      <H3>Step 2: Assigning the Work</H3>
      <OrderedList>
        <li>
          You need to assign the four new jobs. Click the <Code>Assign</Code> button on the first job card in the <Em>New</Em> column.
        </li>
        <li>
          The <Em>Assignment Workflow</Em> panel slides out. It shows you the pickup location on the map, and lists your three drivers ranked by proximity.
        </li>
        <li>
          You see Driver A is only 2 miles away. You select Driver A and click <Code>Assign</Code>. The job card instantly moves from <Em>New</Em> to <Em>Dispatched</Em>, and is now grouped under Driver A.
        </li>
      </OrderedList>

      <H3>Step 3: Monitoring the Map</H3>
      <OrderedList>
        <li>
          You glance at the <Em>Live Map</Em> on the right half of the screen. You see Driver A's truck pin moving toward the pickup location.
        </li>
        <li>
          The job card updates to show <Em>En Route</Em> (Driver A tapped the button on their phone). A live ETA countdown appears on the card: <Code>ETA: 12 min</Code>.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>
      <P>
        When the board doesn't reflect reality, use this guide to find the disconnect.
      </P>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A driver's truck pin isn't moving on the map</H4>
          <UnorderedList>
            <li>
              <Em>Is the driver's shift active?</Em> The map only tracks drivers who are currently clocked in. Check the <Em>Trucks/Drivers</Em> page to ensure they haven't accidentally clocked out.
            </li>
            <li>
              <Em>Did the driver deny location permissions?</Em> The mobile app (or browser) requires "Always Allow" location access to send GPS pings in the background. If the driver selected "While Using," the pin will stop moving as soon as they put their phone in their pocket.
            </li>
            <li>
              <Em>Are they in a dead zone?</Em> If cellular service drops, the app queues the GPS pings offline and sends them in a burst when service returns. The pin will "jump" to catch up.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A job is stuck in the wrong column</H4>
          <UnorderedList>
            <li>
              <Em>Did the driver forget to tap the button?</Em> Drivers sometimes hook the car and drive off without tapping "In Progress." As a dispatcher, you can manually move the job by clicking the status dropdown on the job card and overriding it.
            </li>
            <li>
              <Em>Was the job cancelled?</Em> If a customer cancels while the driver is en route, you must manually change the status to <Code>Cancelled</Code> or <Code>GOA</Code> (Gone On Arrival). This removes the job from the active columns and frees up the driver.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can I assign multiple jobs to one driver?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. You can stack as many jobs on a driver as you want. They will all appear in the driver's queue. The driver's app will show them in the order they were assigned.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">Where do completed jobs go?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            They stay in the "Recently Completed" column until midnight local time. After that, they clear off the board. You can always find them later by searching the <Em>Tow Jobs</Em> list page or the <Em>A/R Workspace</Em>.
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
            href="/help/daily-operations/call-intake"
            title="The Call Intake Workflow: From Phone Call to Dispatch"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
