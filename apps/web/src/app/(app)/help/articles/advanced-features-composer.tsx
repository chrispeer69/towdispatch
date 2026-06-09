/**
 * Tier Offer Composer article body.
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
// Article — The Tier Offer Composer
// =====================================================================

export function TierOfferComposerArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Motor clubs dictate flat rates. When a severe weather event hits, those flat rates often
        fail to cover the increased cost of operating a heavy-duty fleet in dangerous conditions.
        The <Em>Tier Offer Composer</Em> flips the script: it allows you to proactively offer
        guaranteed truck capacity to motor clubs in exchange for a temporary, event-specific rate
        multiplier.
      </P>
      <P>
        This guide explains how to compose an offer, how motor club managers accept or decline it,
        and how the dispatch board enforces those decisions during the event.
      </P>

      <H2>Overview</H2>
      <P>
        The Tier Offer Composer sits on top of the Dynamic Pricing Engine. While standard dynamic
        pricing applies automatically to cash customers, motor clubs require a negotiated agreement
        before you can alter their contracted rates.
      </P>
      <P>
        The Composer automates this negotiation. You create an offer specifying a premium (e.g.,
        1.5×), a capacity commitment (e.g., 8 trucks), and a time window. The system emails this
        offer to the motor clubs you select. If they click "Accept," the system automatically
        applies the multiplier to their jobs during the window. If they click "Decline," your
        dispatchers are flagged to decline their calls, preserving your limited capacity for the
        partners who agreed to pay.
      </P>

      <Callout tone="tip" title="The Strategy: Commitment, not Punishment">
        Position your offers as a <Em>commitment</Em> to the motor club, not a penalty. The pitch
        is: "We are dedicating our fleet to the partners who meet our event pricing." This
        transforms a difficult conversation into a strategic partnership.
      </Callout>

      <H2>Worked Example: A Level-2 Snow Emergency</H2>
      <P>
        It is Thursday afternoon. The National Weather Service has issued a Level-2 Snow Emergency
        for your service area, starting Friday at 6:00 AM and ending Saturday at midnight.
      </P>

      <H3>Step 1: Compose the Offer</H3>
      <OrderedList>
        <li>
          Navigate to <Em>Settings → Dynamic Pricing</Em> and click <Code>Compose Offer</Code>.
        </li>
        <li>
          <Em>Select Tier:</Em> Choose your pre-configured "Winter Storm Warning" tier (1.5×
          multiplier).
        </li>
        <li>
          <Em>Set Time Window:</Em> Enter Friday 6:00 AM to Saturday 11:59 PM.
        </li>
        <li>
          <Em>Commit Capacity:</Em> Enter the number of trucks you are guaranteeing to the accepting
          clubs (e.g., <Code>8</Code>).
        </li>
        <li>
          <Em>Select Recipients:</Em> Check the boxes next to the motor club accounts you want to
          send this to (e.g., Agero, AAA, Allstate).
        </li>
        <li>
          Click <Code>Send Offer</Code>.
        </li>
      </OrderedList>

      <H3>Step 2: The Motor Club Experience</H3>
      <P>The system instantly emails the selected account managers.</P>
      <OrderedList>
        <li>
          The Agero manager receives an email: "US Tow Dispatch: Severe Weather Capacity Offer from
          Acme Towing."
        </li>
        <li>
          They click the secure link in the email, which opens a public landing page. They do not
          need to log in.
        </li>
        <li>
          The page displays your terms: "Acme Towing is committing 8 trucks to partners who accept a
          1.5× rate multiplier during the snow emergency."
        </li>
        <li>
          The manager clicks <Code>Accept Offer</Code>. The system logs their IP address and
          timestamp as a legally binding acceptance.
        </li>
      </OrderedList>

      <H3>Step 3: Dispatch-Time Enforcement</H3>
      <P>Friday morning arrives, and the snow emergency begins. The active window opens.</P>
      <OrderedList>
        <li>
          A job comes in from Agero. Because Agero accepted the offer, the Live Quote Box
          automatically applies the 1.5× multiplier to the invoice. The dispatcher processes the job
          normally.
        </li>
        <li>
          A job comes in from AAA. AAA either clicked "Decline" or never responded to the email.
        </li>
        <li>
          The Live Dispatch Board flashes a prominent warning on the AAA job card:{' '}
          <Em>"Offer Declined/Pending."</Em>
        </li>
        <li>
          The dispatcher clicks the job. A button appears: <Code>Decline Dispatch</Code>. The
          dispatcher clicks it, and the system automatically rejects the job back to AAA with the
          reason code: "Capacity unavailable due to severe weather event."
        </li>
      </OrderedList>

      <H3>Step 4: Post-Event Reconciliation</H3>
      <OrderedList>
        <li>
          On Monday, navigate to <Em>Operations → Dynamic Pricing → Reports</Em>.
        </li>
        <li>
          Generate the <Em>Event Reconciliation Report</Em> for the snowstorm.
        </li>
        <li>
          The report shows exactly which clubs accepted, how many jobs you completed for them at the
          premium rate, and the total revenue uplift generated by the offer.
        </li>
      </OrderedList>

      <H2>Troubleshooting Tree</H2>

      <div className="mt-6 space-y-4">
        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A motor club manager says the link expired</H4>
          <UnorderedList>
            <li>
              <Em>Has the event window closed?</Em> The magic link sent in the email is
              cryptographically tied to the event's end date. Once the event is over, the link
              automatically expires. You cannot retroactively accept an offer for an event that has
              passed.
            </li>
          </UnorderedList>
        </div>

        <div className="rounded-[10px] border border-divider bg-bg-surface p-5">
          <H4>Symptom: A job from an opted-out club wasn't flagged on the dispatch board</H4>
          <UnorderedList>
            <li>
              <Em>Is the event window currently active?</Em> The dispatch board only flags jobs that
              arrive <Em>during</Em> the specific start/end times defined in the offer. Jobs
              arriving before or after the window are processed at standard rates without warnings.
            </li>
          </UnorderedList>
        </div>
      </div>

      <H2>FAQ</H2>
      <div className="space-y-4 mt-6">
        <div>
          <strong className="block text-text-primary-on-dark">
            Can a motor club change their mind mid-event?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            Yes. If a club initially declines or ignores the offer, but realizes mid-storm they have
            no coverage, they can click the link in the original email and accept it. The system
            will immediately begin applying the multiplier to any new jobs they send.
          </p>
        </div>
        <div>
          <strong className="block text-text-primary-on-dark">
            Do I have to decline jobs from opted-out clubs?
          </strong>
          <p className="mt-1 text-sm text-text-secondary-on-dark">
            No. The system flags the job and provides a one-click decline option, but the final
            decision rests with your dispatcher. If you have excess capacity and want to take the
            job at the standard rate as a gesture of goodwill, you can proceed normally.
          </p>
        </div>
      </div>

      <H2>Negotiation framing — how to talk about this</H2>
      <P>
        Wording matters when explaining the composer to motor-club account managers. The platform is{' '}
        <Em>negotiation infrastructure</Em>, not surge pricing. You propose terms; partners accept
        or decline; the resulting allocation is contractually clean and audit-trailed. Lean on these
        phrases:
      </P>
      <UnorderedList>
        <li>
          <Em>"We're committing capacity."</Em> The offer is a guarantee from you to them, not a
          threat. You're locking in trucks for their use.
        </li>
        <li>
          <Em>"You accept or decline independently."</Em> No motor club is bound by another club's
          decision; each negotiates on its own.
        </li>
        <li>
          <Em>"The acceptance ledger is the contractual record."</Em> If accounting ever pushes
          back, IP + timestamp + signed link is the evidence.
        </li>
        <li>
          <Em>"Clubs that decline still get dispatched."</Em> Decline doesn't end the relationship —
          it just means standard-rate jobs for that window.
        </li>
      </UnorderedList>
      <Callout tone="info" title="Phrases to avoid">
        Do not call this "surge pricing," do not say "we're raising rates," and do not frame the
        alternative to acceptance as "we won't serve you." Those phrases land in the wrong tone and
        damage relationships. The product gives you a way to be transparent and fair; lean into
        that.
      </Callout>

      <H2>Anatomy of a great offer</H2>
      <P>
        Offers vary in how well they land. The pattern of an offer that gets accepted within a few
        hours:
      </P>
      <UnorderedList>
        <li>
          <Em>Subject line is specific and time-bounded.</Em> "Capacity offer — Level-2 Snow Event
          Dec 21" wins over "Pricing update for next storm."
        </li>
        <li>
          <Em>Title carries the event reference.</Em> Same logic; the recipient will see the title
          above the narrative and decide in three seconds whether to read on.
        </li>
        <li>
          <Em>Narrative is four to six sentences.</Em> Long enough to explain what you're committing
          and why; short enough that a busy regional manager reads it on their phone.
        </li>
        <li>
          <Em>Event window is set 24 hours after sending.</Em> Gives the manager a business day to
          respond and you a clean window to staff against.
        </li>
        <li>
          <Em>Acceptance deadline is at least 4 hours before the window opens.</Em> So you know your
          committed capacity before you need to roster trucks.
        </li>
        <li>
          <Em>Truck count is conservative.</Em> Promising 12 and delivering 8 damages trust forever;
          promising 6 and delivering 8 builds it.
        </li>
      </UnorderedList>

      <H2>Recipient strategy</H2>
      <P>Who to send to is the single biggest determinant of acceptance rate. A few patterns:</P>
      <UnorderedList>
        <li>
          <Em>Send to managers you have an active business relationship with.</Em> The recipient
          picker shows only motor-club accounts you have on file in <Em>Customers → Accounts</Em>.
          Curate that list separately — don't try to use the composer to start a new relationship.
        </li>
        <li>
          <Em>One offer per event, not one per club.</Em> If you're sending the same terms to three
          clubs, send one offer with three recipients rather than three separate offers. The
          composer handles per-recipient acceptance independently; the reconciliation report
          aggregates cleanly.
        </li>
        <li>
          <Em>If a manager's contact info has changed, update the account first.</Em> The composer
          pulls email from the account. Sending to a stale address wastes the magic link.
        </li>
        <li>
          <Em>For new clubs, do a small test offer first.</Em> Pick a low-stakes event (an
          after-hours premium for a single weekend), send it to one new account manager, and see how
          they respond. You learn how they negotiate before you stake a storm on it.
        </li>
      </UnorderedList>

      <H2>What happens after you click Send</H2>
      <P>
        The composer fires several things in sequence; understanding them helps when something looks
        off:
      </P>
      <OrderedList>
        <li>
          The offer status flips from <Em>draft</Em> to <Em>sent</Em>.
        </li>
        <li>
          For each recipient, the platform mints a unique magic-link JWT (signed with HS256, 7-day
          expiry, audience-scoped) and writes it to the recipient row.
        </li>
        <li>
          An email goes out via SendGrid containing the recipient's name, the offer narrative, and
          the unique magic link. Each recipient gets a different link — there's no shared URL.
        </li>
        <li>
          The recipient row status flips to <Em>sent</Em> with an <Em>email_sent_at</Em> timestamp.
        </li>
        <li>
          SendGrid posts a <Em>delivered</Em> event to our webhook within seconds; the row flips to{' '}
          <Em>delivered</Em>.
        </li>
        <li>
          When the recipient opens the email, SendGrid posts an <Em>open</Em> event; the row flips
          to <Em>opened</Em>.
        </li>
        <li>
          When the recipient clicks the magic link, the public <Em>/offers/[token]</Em> landing page
          renders with their name and the offer terms.
        </li>
        <li>
          When they click Accept (or Decline), the platform records the response with their IP and
          User-Agent. The row flips to <Em>accepted</Em> (or <Em>declined</Em>) with a{' '}
          <Em>responded_at</Em> timestamp.
        </li>
        <li>
          The Tier Offer detail page in the operator app polls every 30 seconds; the operator sees
          the state changes in near real time without refreshing.
        </li>
      </OrderedList>
      <P>
        If a recipient row is stuck at <Em>sent</Em> for more than 24 hours, the email probably hit
        a spam folder. The detail page surfaces a <Em>Copy magic link</Em> button (visible to OWNER
        and ADMIN only); copy the link and send it through whatever back-channel you have with that
        manager (phone, Slack, text). Manual delivery still results in a valid signed acceptance.
      </P>

      <H2>The lifecycle cron</H2>
      <P>
        Five minutes is the platform's scheduling granularity. A background cron walks every offer
        forward in time:
      </P>
      <UnorderedList>
        <li>
          Offers in <Em>sent</Em> state flip to <Em>event_active</Em> when their event window opens.
        </li>
        <li>
          Offers in <Em>event_active</Em> flip to <Em>event_concluded</Em> when their event window
          closes.
        </li>
        <li>
          Recipients past their offer's <Em>acceptance_deadline_at</Em> in any of (pending_send,
          sent, delivered, opened) flip to <Em>expired</Em>.
        </li>
      </UnorderedList>
      <P>
        The cron is idempotent; if the system was down for an hour, the next tick catches up
        everything past its boundary in one batch. There's no manual cleanup to do.
      </P>
      <Callout tone="warning" title="Already-accepted recipients are never regressed">
        If a recipient accepted at 6:01 AM and the acceptance deadline was 6:00 AM, the system
        honors the acceptance. The deadline only governs rows that <Em>have not</Em> responded;
        explicit acceptance always wins. The reconciliation report flags late acceptances so you can
        see them.
      </Callout>

      <H2>Reconciliation deep-dive</H2>
      <P>
        The reconciliation report (Tier Offer detail → Download CSV) is your post-event financial
        record. Columns:
      </P>
      <UnorderedList>
        <li>
          <Em>recipient_name, recipient_email, account_name</Em> — who, where it went.
        </li>
        <li>
          <Em>status</Em> — accepted, declined, expired, revoked, bounced.
        </li>
        <li>
          <Em>responded_at</Em> — when they hit Accept or Decline (null for expired / bounced rows).
        </li>
        <li>
          <Em>jobs_completed</Em> — number of jobs from that account during the event window.
        </li>
        <li>
          <Em>total_billed_cents</Em> — sum of invoiced amounts (or quoted-at-intake when no invoice
          exists yet).
        </li>
        <li>
          <Em>estimated_standard_cents</Em> — what those jobs would have billed at the standard
          rate.
        </li>
        <li>
          <Em>uplift_cents</Em> — the difference, in cents. Negative values mean the events ran at
          standard or below (e.g., recipient declined).
        </li>
      </UnorderedList>
      <P>
        Run the reconciliation after every offer concludes. Forward the CSV to your bookkeeper. The
        premium charges are pre-justified by the signed acceptance ledger; no disputes.
      </P>

      <H2>Role-by-role permissions</H2>
      <div className="mt-6 overflow-x-auto rounded-[10px] border border-divider">
        <table className="w-full text-sm">
          <thead className="bg-bg-surface-elevated/40">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
                Role
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
                Compose offer
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
                Send / cancel
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
                View list / detail
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
                Copy magic link
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-[0.18em] text-text-secondary-on-dark">
                Download CSV
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-divider">
              <td className="px-4 py-2.5">OWNER</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
            </tr>
            <tr className="border-t border-divider">
              <td className="px-4 py-2.5">ADMIN</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
            </tr>
            <tr className="border-t border-divider">
              <td className="px-4 py-2.5">MANAGER</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">Yes</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">Yes</td>
            </tr>
            <tr className="border-t border-divider">
              <td className="px-4 py-2.5">DISPATCHER</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">Yes (read-only)</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">No</td>
            </tr>
            <tr className="border-t border-divider">
              <td className="px-4 py-2.5">ACCOUNTING</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">Yes (read-only)</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">Yes</td>
            </tr>
            <tr className="border-t border-divider">
              <td className="px-4 py-2.5">AUDITOR</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">Yes (read-only)</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">Yes</td>
            </tr>
            <tr className="border-t border-divider">
              <td className="px-4 py-2.5">DRIVER</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">No</td>
              <td className="px-4 py-2.5">No</td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2>Related Concepts</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/advanced-features/pricing-decision-guide"
            title="Dynamic Pricing vs. Tier Offers — Which One Do I Use When?"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/advanced-features/pricing-quickstart"
            title="Your First 30 Minutes Setting Up Pricing"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/advanced-features/dynamic-pricing"
            title="Dynamic Pricing: How to Configure and Activate Tiers"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/advanced-features/account-rate-cards"
            title="Account Rate Cards: Managing Commercial Pricing"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
