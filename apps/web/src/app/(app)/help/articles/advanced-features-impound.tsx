/**
 * Impound Yard article body.
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
// Article — Impound & Storage Yard Operations
// =====================================================================

export function ImpoundYardArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        The Impound & Storage Yard module is currently in active development (Phase 2). This guide outlines the capabilities that will be available when the module launches.
      </P>
      <P>
        Roadside dispatch generates cash flow, but impound recovery generates margin. A single vehicle held for 30 days generates significant storage fees, and the eventual auction proceeds represent the longest revenue tail in the industry. The US Tow DISPATCH Impound module is designed to automate the most error-prone parts of this process: daily fee accruals and statutory lien notices.
      </P>

      <H2>Overview of Upcoming Features</H2>
      
      <H3>1. Multi-Yard Inventory Management</H3>
      <P>
        Track vehicles across multiple physical storage lots. You will be able to define yards, zones, and specific stalls. When a driver drops a vehicle, they log its exact location, eliminating the "walking the yard" search.
      </P>

      <H3>2. Automated Daily Storage Accruals</H3>
      <P>
        Instead of manually calculating how many days a vehicle has been on the lot when the owner arrives to claim it, the system runs a midnight cron job that automatically posts the daily storage fee to the vehicle's running tab, respecting the specific rate sheet for that yard and vehicle class.
      </P>

      <H3>3. Hold Types and Legal Clocks</H3>
      <P>
        Different impounds have different legal rules. The system will track the specific "Hold Type" (e.g., Police Hold, Abandoned Vehicle, Repossession, Motor Club Wait). If a vehicle is on a Police Hold, the system prevents it from being released or advancing down the lien pipeline until the hold is officially lifted in the system.
      </P>

      <H3>4. The Lien Notice Ladder</H3>
      <P>
        This is the core moat of the module. Every state has strict statutory requirements for when and how you must notify a registered owner before you can auction their vehicle.
      </P>
      <UnorderedList>
        <li>The system tracks the exact hour the vehicle entered the yard.</li>
        <li>It automatically generates the 7-day, 14-day, or 30-day notice letters formatted to your specific state's legal requirements.</li>
        <li>It tracks certified mail tracking numbers to prove compliance.</li>
        <li>Once the statutory waiting period expires and all notices are sent, the vehicle is automatically flagged as "Lien Eligible."</li>
      </UnorderedList>

      <H3>5. Auction Preparation</H3>
      <P>
        Vehicles that clear the lien process are grouped into Auction Batches. The system generates the necessary paperwork (e.g., Ohio BMV forms) and prepares the data export required by major auction houses like Copart or IAA.
      </P>

      <Callout tone="info" title="Early Access">
        We are currently interviewing operators in Ohio, Florida, and Texas to ensure the state-specific lien notice ladders are legally perfect before launch. If your operation handles high-volume police impounds or private property towing (PPI) and you want to participate in the beta, contact <a href="mailto:support@towcommand.cloud" className="text-brand-primary hover:underline">support@towcommand.cloud</a>.
      </Callout>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can I use the current system for impounds?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes, but manually. You can create a job with the Service Type <Code>Impound</Code>, drop the vehicle at your yard address, and manually add line items for storage days when you generate the invoice. The automated daily accruals and lien tracking will replace this manual process when the module launches.
          </p>
        </div>
      </div>
    </div>
  );
}
