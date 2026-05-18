/**
 * Damage Claim article body.
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
// Article — Damage Claim Dispute Procedure
// =====================================================================

export function DamageClaimArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        When a customer or motor club claims your driver damaged a vehicle, the speed and structure of your response dictates whether you pay a $1,200 body shop bill or dismiss the claim entirely. 
      </P>
      <P>
        This guide outlines the standard operating procedure for handling a damage claim using the evidence captured in US Tow DISPATCH, and provides an email template you can use to formally reject false claims.
      </P>

      <H2>Overview</H2>
      <P>
        The key to winning a damage dispute is the <Em>60-second walkaround video</Em> captured by your driver before hooking the vehicle. If the driver followed protocol, you have irrefutable, timestamped, GPS-tagged proof of the vehicle's condition prior to your company taking custody.
      </P>
      <P>
        Never argue with a customer over the phone. Acknowledge their complaint, tell them you will review the driver's video evidence, and move the conversation to email. Written communication prevents escalation and provides a paper trail for your insurance provider if needed.
      </P>

      <Callout tone="tip" title="The Burden of Proof">
        In a damage claim, the burden of proof is on the customer to show that the damage occurred <Em>while the vehicle was in your custody</Em>. By providing a video showing the damage already existed at the pickup location, you shift the burden back to them, ending the dispute 95% of the time.
      </Callout>

      <H2>The 4-Step Dispute Procedure</H2>

      <H3>Step 1: Secure the Evidence</H3>
      <OrderedList>
        <li>
          Navigate to the <Em>Tow Jobs</Em> list and find the specific job.
        </li>
        <li>
          Scroll down to the <Em>Evidence &amp; Attachments</Em> section.
        </li>
        <li>
          Locate the <Code>Video Walkaround</Code> and any <Code>Pickup Photos</Code>.
        </li>
        <li>
          Watch the video carefully. Look for the specific panel or area the customer is claiming was damaged.
        </li>
      </OrderedList>

      <H3>Step 2: Generate a Share Link</H3>
      <P>
        Do not download the video and try to email it as an attachment (it will likely be too large). Instead, use the platform's secure sharing feature.
      </P>
      <OrderedList>
        <li>
          Click the <Code>Share</Code> icon next to the video thumbnail.
        </li>
        <li>
          The system generates a secure, read-only link that expires in 7 days. Copy this link.
        </li>
      </OrderedList>

      <H3>Step 3: Respond in Writing</H3>
      <P>
        Use the template below to respond to the customer or motor club adjuster. Be polite, firm, and factual.
      </P>

      <div className="mt-6 rounded-[10px] border border-divider bg-bg-surface-elevated/20 p-6 font-serif text-sm leading-relaxed text-text-primary-on-dark/80">
        <h4 className="mb-4 text-lg font-bold text-text-primary-on-dark">Damage Claim Rejection Template</h4>
        
        <p className="mb-4">
          Subject: Damage Claim Review - Job #[Job Number] - [Customer Name/Vehicle]
        </p>
        <p className="mb-4">
          Dear [Customer Name / Adjuster Name],
        </p>
        <p className="mb-4">
          We have received your inquiry regarding alleged damage to the [Year Make Model] serviced on [Date of Service]. We take all damage claims seriously and have completed a full review of the dispatch record.
        </p>
        <p className="mb-4">
          As part of our standard operating procedure, our drivers capture a continuous video walkaround of every vehicle prior to hooking or taking custody. We have reviewed the video for this dispatch.
        </p>
        <p className="mb-4">
          The video clearly shows that the damage in question (specifically the [describe damage, e.g., scrape on the front left bumper]) was already present on the vehicle at the time our driver arrived on scene, prior to any service being rendered.
        </p>
        <p className="mb-4">
          You can view the timestamped, GPS-tagged video evidence directly at the secure link below:
        </p>
        <p className="mb-4 text-brand-primary">
          [Insert Secure Share Link Here]
        </p>
        <p className="mb-4">
          Because this damage was pre-existing, we must respectfully deny this claim. We consider this matter closed.
        </p>
        <p className="mb-4">
          Sincerely,<br />
          [Your Name / Title]<br />
          [Company Name]
        </p>
      </div>

      <H3>Step 4: Close the Loop</H3>
      <OrderedList>
        <li>
          If the claim came through a motor club portal (e.g., Agero's network portal), paste the exact same text and link into their dispute resolution form.
        </li>
        <li>
          Add a note to the <Em>Job Detail</Em> page in US Tow DISPATCH documenting that the claim was rejected and the date the email was sent.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The driver did not take a video</H4>
          <UnorderedList>
            <li>
              <Em>Review the photos.</Em> If the driver skipped the video but took photos, review them to see if the pre-existing damage is visible.
            </li>
            <li>
              <Em>If no evidence exists:</Em> You are in a difficult position. If the customer is adamant, you may have to file a claim with your insurance or settle out of pocket. Use this as a training moment: remind the driver that failing to capture a walkaround video makes them personally responsible for explaining the gap in protocol.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: The video shows our driver actually caused the damage</H4>
          <UnorderedList>
            <li>
              <Em>Own it immediately.</Em> Do not try to hide the video. Contact the customer, apologize, and initiate your insurance claim process. Transparency in these rare moments builds long-term trust, especially with commercial accounts.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">Can the customer download the video from the share link?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            No. The share link opens a secure media player in their browser. They can watch it as many times as they want, but there is no direct download button. This prevents the file from being manipulated.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">Will Stripe accept this video for a chargeback dispute?</strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. When responding to a Stripe dispute, you can provide the secure share link in your evidence submission, along with the signed Bill of Lading.
          </p>
        </div>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/daily-operations/capturing-evidence"
            title="Capturing Field Evidence (Photos, Videos, Signatures)"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/company-policies/refund-policy-template"
            title="Standard Refund Policy Template"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
