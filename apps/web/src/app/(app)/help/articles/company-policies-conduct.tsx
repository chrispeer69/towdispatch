/**
 * Driver Conduct article body.
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
// Article — Driver Conduct & Safety Standards
// =====================================================================

export function DriverConductArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Your drivers are the face of your business. Their conduct on the scene determines whether a
        customer leaves a 5-star review or files a damage claim. Establishing clear, enforceable
        standards protects your brand and your liability.
      </P>
      <P>
        This document provides a standard Driver Conduct &amp; Safety Policy template. You can copy
        this text, customize it for your operation, and use it as the script for your mandatory
        Daily Briefing video.
      </P>

      <H2>Overview</H2>
      <P>
        A conduct policy is only effective if you can prove the driver read it. US Tow Dispatch
        enforces this through the <Em>Daily Briefing</Em> module. When you upload a safety video or
        post a text briefing, the system forces the driver to acknowledge it before they can start
        their shift, logging their IP address and timestamp as an unassailable audit trail.
      </P>

      <Callout tone="tip" title="How to use this template">
        Copy the text in the gray box below. Adapt it to your specific company rules. You can paste
        the text directly into the <Em>Daily Briefing</Em> message box in US Tow Dispatch, or read
        it aloud while recording a video on your phone, then upload that video to the platform.
      </Callout>

      <H2>The Policy Template</H2>

      <div className="mt-6 rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-6 font-serif text-sm leading-relaxed text-text-primary-on-dark/80">
        <h4 className="mb-4 text-lg font-bold text-text-primary-on-dark">
          [Company Name] Driver Conduct &amp; Safety Standards
        </h4>

        <p className="mb-4">
          As a driver for [Company Name], you represent our brand to every customer, motor club, and
          law enforcement officer you interact with. Your safety, and the safety of the public, is
          our highest priority. By clocking in today, you agree to adhere to the following
          standards:
        </p>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">1. Safety First, Always</h5>
        <ul className="mb-4 list-disc pl-5">
          <li>
            You will wear your high-visibility Class 3 safety vest at all times when outside the cab
            on any active roadway.
          </li>
          <li>
            You will engage all emergency lighting (lightbar, strobes, flashers) before exiting the
            vehicle on a highway shoulder.
          </li>
          <li>
            You will never attempt a recovery if you believe the scene is unsafe. You have the
            authority to request police traffic control before proceeding.
          </li>
        </ul>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">
          2. The 60-Second Walkaround
        </h5>
        <ul className="mb-4 list-disc pl-5">
          <li>
            Before attaching any hook, chain, or strap to a customer's vehicle, you <Em>must</Em>{' '}
            complete a 60-second video walkaround using the US Tow Dispatch app.
          </li>
          <li>
            You will narrate the video, clearly pointing out any pre-existing damage, scrapes, or
            missing parts.
          </li>
          <li>
            Failure to capture a walkaround video makes you personally responsible for explaining
            any subsequent damage claims.
          </li>
        </ul>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">3. Professional Conduct</h5>
        <ul className="mb-4 list-disc pl-5">
          <li>
            You will treat every customer with respect, regardless of their demeanor. De-escalate
            conflicts; do not engage in arguments.
          </li>
          <li>
            You will not smoke or vape inside the cab of the truck or while interacting with
            customers.
          </li>
          <li>Your uniform will be clean and presentable at the start of your shift.</li>
        </ul>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">
          4. Vehicle and Equipment Care
        </h5>
        <ul className="mb-4 list-disc pl-5">
          <li>
            You will complete an honest and thorough Pre-Trip Inspection (DVIR) before moving the
            truck.
          </li>
          <li>
            If a critical safety component (brakes, lights, steering, tires) fails the DVIR, you
            will mark the truck <Code>Fail (Unsafe)</Code> and notify dispatch immediately. Do not
            drive an unsafe truck.
          </li>
          <li>
            You are responsible for ensuring all straps, chains, and snatch blocks are stowed
            securely before leaving a scene.
          </li>
        </ul>

        <h5 className="mt-6 mb-2 font-bold text-text-primary-on-dark">5. Compliance</h5>
        <ul className="mb-4 list-disc pl-5">
          <li>You will obey all traffic laws, speed limits, and DOT regulations.</li>
          <li>
            You will not use a handheld mobile device while driving. All dispatch interactions must
            occur while parked or via a hands-free mount.
          </li>
        </ul>
      </div>

      <H2>How to Enforce This in US Tow Dispatch</H2>

      <H3>Setting the Daily Briefing</H3>
      <OrderedList>
        <li>
          Navigate to <Em>Settings → Driver App</Em> (requires Owner or Admin role).
        </li>
        <li>
          Paste the customized policy into the <Em>Briefing Message</Em> field.
        </li>
        <li>
          (Optional but recommended) Upload a video of yourself reading the policy. Set the{' '}
          <Em>Minimum Watch Time</Em> to match the video length.
        </li>
        <li>
          Click <Code>Publish Briefing</Code>.
        </li>
      </OrderedList>
      <P>
        The next time a driver attempts to clock in, they will be blocked until they scroll to the
        bottom of the policy, watch the video, and click <Code>Acknowledge</Code>.
      </P>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">
            Do I have to make them read this every single day?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            You don't have to use the full policy every day. A common best practice is to use the
            full policy on Mondays, and use shorter, specific safety reminders (e.g., "Check your
            winch cables today") Tuesday through Friday. You can update the active briefing as often
            as you like.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/daily-operations/driver-shift-dvir"
            title="Driver Shift Check-In and DVIRs"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/daily-operations/capturing-evidence"
            title="Capturing Field Evidence (Photos, Videos, Signatures)"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
