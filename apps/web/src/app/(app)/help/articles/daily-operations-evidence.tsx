/**
 * Capturing Field Evidence article body.
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
// Article — Capturing Field Evidence
// =====================================================================

export function CapturingEvidenceArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Damage disputes are the most expensive leak in a towing operation. When a customer or a motor club claims your driver scratched a bumper, the difference between paying a $1,200 body shop bill and dismissing the claim is having irrefutable, timestamped evidence from the scene.
      </P>
      <P>
        This guide explains how US Tow DISPATCH handles field evidence—specifically the 60-second walkaround video—how it uploads in the background so drivers aren't delayed, and how dispatchers can review it.
      </P>

      <H2>Overview</H2>
      <P>
        Legacy software forces drivers to take 20+ individual photos of a vehicle, which clutters their phone and often misses the exact angle needed to prove a pre-existing scratch. US Tow DISPATCH solves this with <Em>Video Evidence Capture</Em>.
      </P>
      <P>
        A continuous 60-to-90-second video of the driver walking around the vehicle is categorically better evidence than photos. It proves chain of custody, establishes the exact condition of every panel, and takes less time for the driver to complete.
      </P>

      <Callout tone="tip" title="The Offline Queue">
        Drivers frequently lose cell service on highways or in parking garages. The evidence capture system is "Offline-First." When a driver records a video, the app saves it locally and queues it. The driver can immediately drive away. When the phone reconnects to a cell tower—even an hour later—the app silently uploads the video in the background.
      </Callout>

      <H2>The Driver Workflow: Capturing Evidence</H2>
      <P>
        When a driver arrives on scene, they follow a standard procedure before hooking the vehicle.
      </P>

      <H3>Step 1: The Walkaround Video</H3>
      <OrderedList>
        <li>
          On the active job screen, the driver taps <Code>Document Damage</Code>.
        </li>
        <li>
          The app opens the camera in video mode. The driver walks a slow circle around the vehicle, narrating what they see (e.g., "Scrape on the left front bumper, missing hubcap on the right rear").
        </li>
        <li>
          The driver taps Stop. The app displays a thumbnail and a <Code>Confirm + Upload</Code> button.
        </li>
        <li>
          The driver taps Confirm. The app instantly returns to the job screen so the driver can begin the hookup. The video upload happens invisibly in the background.
        </li>
      </OrderedList>

      <H3>Step 2: Required Photos</H3>
      <P>
        While video covers the body panels, some motor clubs require specific still photos for payment compliance.
      </P>
      <OrderedList>
        <li>
          The driver taps <Code>Add Photo</Code> and selects a category (e.g., <Em>Hookup</Em>, <Em>Dropoff</Em>, <Em>Paperwork</Em>).
        </li>
        <li>
          The driver snaps the photo. Like the video, it queues for background upload.
        </li>
      </OrderedList>

      <H3>Step 3: Customer Signature (Digital BOL)</H3>
      <P>
        If the customer is on scene, the driver can capture their signature on the glass.
      </P>
      <OrderedList>
        <li>
          The driver taps <Code>Collect Signature</Code>.
        </li>
        <li>
          The customer reviews the digital Bill of Lading (BOL) and signs with their finger.
        </li>
        <li>
          The signature is converted to a secure vector graphic and attached to the job record.
        </li>
      </OrderedList>

      <H2>The Dispatcher Workflow: Reviewing Evidence</H2>
      <P>
        As soon as the driver's phone completes the background upload, the evidence is available to the back office.
      </P>

      <OrderedList>
        <li>
          Open the <Em>Job Detail</Em> page for any active or completed job.
        </li>
        <li>
          Scroll down to the <Em>Evidence &amp; Attachments</Em> section.
        </li>
        <li>
          You will see thumbnails for all videos, photos, and signatures attached to the job.
        </li>
        <li>
          Click a thumbnail to open the media viewer. Videos stream directly in the browser—no downloading required.
        </li>
      </OrderedList>

      <Callout tone="info" title="Direct-to-S3 Architecture">
        To handle thousands of large video files without slowing down the platform, US Tow DISPATCH uses "Presigned URLs." The driver's phone uploads the video directly to secure Amazon S3 cloud storage, bypassing our API servers entirely. This means your dispatch board stays lightning-fast even if fifty drivers are uploading storm-damage videos at the exact same time.
      </Callout>

      <H2>Troubleshooting Tree</H2>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A driver took a video, but it's not showing up on the Job Detail page</H4>
          <UnorderedList>
            <li>
              <Em>Is the driver still in a dead zone?</Em> The video is likely sitting safely in the driver's offline queue. As soon as their phone regains 4G/5G service, it will upload automatically.
            </li>
            <li>
              <Em>Did the driver force-close the app?</Em> If the driver swiped up and killed the app while the upload was in progress, the background transfer may have paused. It will resume the next time they open the app.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The video plays, but the quality is low</H4>
          <UnorderedList>
            <li>
              <Em>This is intentional.</Em> To save your drivers' cellular data plans and ensure fast uploads from the side of the highway, the app compresses the video to 720p resolution before uploading. This is more than enough clarity to prove a scratch to an insurance adjuster, while keeping the file size under 15MB.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can I share a damage video with a motor club?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. On the Job Detail page, you can click the "Share" icon next to any piece of evidence to generate a secure, read-only link that expires in 7 days. You can email this link to a claims adjuster.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">How long are videos stored?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Videos are kept in "hot" storage for instant playback for 90 days. After 90 days, they are automatically moved to "cold" archive storage to keep your platform costs low. They are never deleted, but retrieving an archived video may take a few hours.
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
            href="/help/company-policies/damage-claim-procedure"
            title="Damage Claim Dispute Procedure"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
