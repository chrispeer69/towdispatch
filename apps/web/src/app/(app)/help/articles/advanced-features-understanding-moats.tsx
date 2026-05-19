/**
 * Understanding Our Moats — foundational article in the Advanced
 * Features Powered by AI & Moats category. Frames what a moat is, why
 * most towing platforms don't have one, and how each of US Tow
 * DISPATCH + ClaimShield's six moats reinforce each other.
 */
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

// =====================================================================
// Shared building blocks (mirrored from advanced-features-dynamic-pricing.tsx)
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
function Related({ href, title }: { href: string; title: string }): JSX.Element {
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
// Article — Understanding Our Moats
// =====================================================================

export function UnderstandingMoatsArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Most towing software is parity software. It does what every other vendor's product does,
        only with a slightly different button arrangement. When two products do roughly the same
        thing, the only thing left to compete on is price, and the operator becomes the loser of
        every conversation. US Tow DISPATCH and CLAIM SHIELD are deliberately built the other way.
      </P>
      <P>
        A <Em>moat</Em>, in business strategy, is a structural advantage that makes it hard for a
        competitor to take your customer back. The deepest moats are not features — features can be
        copied. The deepest moats are the things that <Em>can't</Em> be copied without rebuilding
        your business from scratch: collective bargaining infrastructure, decades of expert
        knowledge, audit-grade evidence trails, exclusive data, and integrations the platform was
        designed for from day one.
      </P>
      <P>
        This article explains the six moats inside the alliance ecosystem, why each one is
        structurally defensible, and how to use them in your day-to-day operation.
      </P>

      <H2>Why most towing platforms have no moat</H2>
      <P>
        Walk the floor of any towing trade show and the demos blur together. Every dispatch board
        looks like every other dispatch board. Every invoice export looks like every other invoice
        export. The reason is that incumbents are competing inside the same constraint: they were
        built as <Em>workflow software for individual operators</Em>. They have no way to make the
        operator stronger relative to the people on the other side of the negotiation — the motor
        clubs, the insurers, the dealerships, the storage-yard claimants.
      </P>
      <P>
        Three things follow from that. First, every operator has to fight every battle alone.
        Second, the platform never preserves money it didn't directly process — chargebacks,
        deductions, settlements, and damage disputes all happen offline, off-platform, with no audit
        trail. Third, the operator's pricing power is permanently capped at whatever the motor
        club's flat rate sheet allows.
      </P>
      <P>
        The US Tow Alliance ecosystem rejects all three. It treats the operator as one node in a
        federation, not a lonely buyer. It captures every dispute as structured data with a chain of
        custody. And it equips the operator to negotiate, not just to invoice.
      </P>

      <H2>The Six Moats</H2>
      <P>
        Two of the six are live in production today. Two are partially shipped and being expanded.
        Two are queued. Each section below explains what the moat is, why competitors can't ship it
        casually, and how an operator uses it.
      </P>

      <H3>1. The Monday RED ALERT past-due email</H3>
      <P>
        Every Monday morning at 6:00 a.m. Eastern, the platform sends every owner and admin a
        structured digest of their past-due invoices. It includes the dollar amount, the customer,
        the days overdue, and the payment-channel last attempted. No competitor in the towing
        industry does this proactively. Towbook, Tracker, and Omadi all expect the operator to
        remember to look.
      </P>
      <P>
        The moat is not the email itself. The moat is the operating cadence the email creates.
        Operators who get the digest collect 4-12% more of their A/R because the friction between "I
        forgot" and "I'm collecting today" goes to zero. Over a year, that is real money. And
        because the cron is wired into the platform's audit log, every send is timestamped and
        traceable for compliance.
      </P>
      <Callout tone="tip" title="What to do with it">
        Open it on Monday before your first cup of coffee. The email lists every aging invoice in
        priority order. Tap into the platform from any line and start the dunning sequence: SMS,
        then call, then a formal demand letter (the platform composes all three). Operators who
        treat the digest as a Monday ritual collect noticeably faster.
      </Callout>
      <P>
        Read the operator playbook in{' '}
        <Related href="/help/billing-finance/red-alert-workflow" title="The RED ALERT Workflow" />.
      </P>

      <H3>2. The Dynamic Pricing Engine</H3>
      <P>
        US Tow DISPATCH has a five-category pricing engine — Weather, Traffic, Calendar (Holidays),
        Time of Day, and Special Events — that lets an operator pre-configure premium pricing tiers
        and activate any combination with a single click during a high-cost-to-serve event. The
        categories stack multiplicatively, with a 3.0× hard cap so nothing accidentally runs away.
        Cash and account customers are quoted the surge rate automatically; motor clubs are
        unaffected unless and until the operator negotiates the surge with them through the Tier
        Offer Composer.
      </P>
      <P>
        The defensible part is not the math. The math is{' '}
        <Code>base × weather × traffic × calendar × time × event</Code> — anyone can write that.
        What competitors cannot ship in a quarter is the <Em>workflow integration</Em>: the
        activation control panel separated from the configuration panel so a panicked dispatcher
        can't accidentally re-write rates during a storm; the per-job override with reason codes;
        the quote-save funnel that captures customers who hung up after seeing the surge price; the
        audit row attached to every invoice line that explains exactly which tiers were active when
        this customer was quoted. Building all of that takes months of design decisions only an
        operator-aware product team makes correctly.
      </P>
      <Callout tone="info" title="Why motor clubs are exempt by default">
        Motor club rates are contractually fixed. Surging them without consent would breach the
        operator's service-level agreement and the platform refuses to let that happen by default.
        The Tier Offer Composer (covered below) is the consent mechanism: the operator{' '}
        <Em>proposes</Em> a surge to specific motor clubs in writing, the clubs accept or decline,
        and only the accepting clubs see the higher rate. The platform turns surge pricing from a
        unilateral act into a structured negotiation.
      </Callout>
      <P>
        Operator playbook:{' '}
        <Related
          href="/help/advanced-features/dynamic-pricing"
          title="Dynamic Pricing — How to Configure and Activate Tiers"
        />
        .
      </P>

      <H3>3. The Tier Offer Composer (motor club negotiation)</H3>
      <P>
        The Composer is the technical expression of the alliance's collective-bargaining strategy.
        The operator drafts a tier offer that says, in effect:{' '}
        <em>
          "Snow emergency declared. We commit eight trucks during the event window in exchange for a
          1.5× premium on the standard ARES rate. Reply by 18:00 to lock in capacity."
        </em>{' '}
        The platform sends that offer to every named account manager at every motor club the
        operator works with. Each recipient accepts or declines independently with a signed magic
        link.
      </P>
      <P>
        The contract is then enforced at dispatch time. When a job comes in from a motor club that{' '}
        <Em>accepted</Em> the offer, the platform applies the elevated rate automatically. When a
        job comes in from a motor club that <Em>declined</Em> or didn't respond, the operator has a
        clear in-product choice — accept at the standard rate, or decline the dispatch with a
        "capacity unavailable due to severe weather" reason code. Either way the operator's trucks
        are committed to the partners who agreed to pay the storm rate.
      </P>
      <Callout tone="tip" title="Why this is the alliance moat">
        Individually, every operator is one voice the motor club can ignore. Through US Tow
        Alliance, every operator submits their event-pricing offer to the same account manager on
        the same morning. That is not surge pricing — it is the first organized counter-party the
        motor clubs have ever faced. The alliance is the social architecture, not the software.
        Towbook has 24,000 unaffiliated operators and could ship every feature we just built and
        they still couldn't ship the alliance.
      </Callout>
      <P>
        Operator playbook:{' '}
        <Related
          href="/help/advanced-features/tier-offer-composer"
          title="The Tier Offer Composer — Negotiating with Motor Clubs"
        />
        .
      </P>

      <H3>4. End-to-end Impound and Lien Processing</H3>
      <P>
        The platform's Phase 2 module captures the entire impound life cycle: storage rate sheets
        per yard, hold types (police hold, abandoned vehicle, unauthorized parking), tow bill
        generation, statutory notice ladders per state, lien certification, and the auction queue
        when ownership transfers to the operator. Today most operators run this on a paper folder
        system or a spreadsheet, lose 10-20% of recoverable revenue to clerical mistakes, and risk
        lawsuits when statutory notices go out late.
      </P>
      <P>
        The defensible part is the <Em>state-specific compliance metadata</Em>. Each US state has
        its own notice timing, its own definition of an abandoned vehicle, its own auction-licensing
        rules, and its own preferred service-of-process channels. Encoding all of that correctly is
        years of legal research per state. The platform ships with the top-ten states locked in and
        adds states on a published roadmap. Competitors cannot copy the legal layer — they would
        have to redo the research from zero.
      </P>
      <Callout tone="warning" title="Phase 2 status">
        The full impound and lien processing module ships in Phase 2. The Phase 1 platform supports
        basic impound tracking; the statutory notice ladders and auction integrations are scheduled.
        See the preview at{' '}
        <Related
          href="/help/advanced-features/impound-yard-operations"
          title="Impound and Storage Yard Operations"
        />
        .
      </Callout>

      <H3>5. The Driver Capabilities Pipeline</H3>
      <P>
        Every claim, dispute, and chargeback is won or lost on the evidence the driver captured at
        the scene. The platform turns the driver's phone or tablet into a structured
        evidence-capture device: a 60-second walkaround video at pickup, geo-tagged photos at every
        state transition, BOL signatures on a finger-drawn signature pad, in-field card payments
        through Stripe Terminal, and a daily briefing video the driver must acknowledge before their
        first job each day.
      </P>
      <P>
        The defensible part is again the chain of custody. Photos uploaded to a Dropbox folder are
        evidence. Photos with a server-signed timestamp, GPS location, an upload IP, and a job-state
        transition row tying them to the customer's signed BOL are <Em>court-admissible</Em>{' '}
        evidence. Towbook can ship a photo button. They cannot ship the audit pipeline that turns
        the photos into a legal weapon.
      </P>
      <Callout tone="info" title="Damage video as the wedge">
        Most damage disputes are won by the operator who can produce a 60-second walkaround video at
        pickup that clearly shows the contested damage was already there. This single feature has
        the highest measured ROI of any driver-side capability in the platform — operators who
        require a walkaround video on every tow report 30-50% fewer paid damage claims within six
        months.
      </Callout>
      <P>
        Operator playbooks:{' '}
        <Related
          href="/help/daily-operations/driver-shift-dvir"
          title="Driver Shift Check-In and DVIRs"
        />{' '}
        and{' '}
        <Related
          href="/help/daily-operations/capturing-evidence"
          title="Capturing Field Evidence"
        />
        .
      </P>

      <H3>6. CLAIM SHIELD by US Tow Alliance — damage claim ecosystem</H3>
      <P>
        ClaimShield is a separate, alliance-branded product that captures every motor-club damage
        claim as a first-class object: the claim file, the event ledger, the evidence locker, the
        negotiation tracker, the settlement schedule (capped at twelve weekly installments to
        protect operator cash flow), and the unauthorized-deduction widget that flags every dollar a
        motor club takes without written authorization. Every member of the alliance gets free claim
        consultation by Chris Peer, the lead expert, who reviews the operator's file and tells them
        whether to fight, settle, or escalate.
      </P>
      <P>
        The defensible part is the human expertise layer. Towbook can hire engineers. They cannot
        hire thirty years of motor-club negotiation knowledge. The first version of ClaimShield is{' '}
        <Em>Chris in the loop, on demand</Em>. The second version is the platform learning from his
        patterns. The third is an Expert Network with Chris setting the standards. No competitor can
        replicate this without acquiring the human.
      </P>
      <P>
        ClaimShield is also a public-policy moat: as more operators feed claims into the system, the
        alliance accumulates anonymized industry-wide data on motor-club deduction practices. That
        data is ammunition for legislative advocacy. No vendor in towing today has comparable
        evidence; the platform produces it as a byproduct of its day-to-day workflow.
      </P>

      <H2>How the Moats Reinforce Each Other</H2>
      <P>
        The moats are not independent features that happen to ship in the same product. They
        compound. A few examples worth understanding.
      </P>
      <UnorderedList>
        <li>
          <Em>Driver Capabilities feeds ClaimShield.</Em> The walkaround video the driver shoots at
          pickup becomes evidence in the Evidence Locker the moment a damage dispute opens. The
          chain of custody is unbroken because both surfaces are the same platform.
        </li>
        <li>
          <Em>Dynamic Pricing feeds the Tier Offer Composer.</Em> The five-category engine is the
          substrate the Composer offers to motor clubs. Without the engine, the Composer would have
          nothing concrete to negotiate. With both, the operator can extend a specific premium to
          specific clubs for a specific event, with full audit trail.
        </li>
        <li>
          <Em>RED ALERT feeds ClaimShield.</Em> When an operator's A/R has an unauthorized
          motor-club deduction, the Monday digest flags it. The flagged amount becomes a ClaimShield
          claim with a single click, dropping into Chris's expert review queue.
        </li>
        <li>
          <Em>Impound feeds Lien feeds Auctions.</Em> Once the impound module is shipped, the
          platform owns the entire revenue tail of an abandoned vehicle from the moment it enters
          the yard to the moment it sells at auction. No competitor handles that whole arc.
        </li>
        <li>
          <Em>Every moat is multi-tenant.</Em> Every alliance member benefits from the same shared
          infrastructure: the motor-club directory, the boilerplate legal language, the lien notice
          templates, the dynamic pricing tier library. The cost of building a moat is amortized
          across the alliance.
        </li>
      </UnorderedList>

      <H2>Using the Moats in Your Day-to-Day Operation</H2>
      <P>
        The moats are not abstract strategy. They map to specific actions the operator takes on
        specific days. Here is the recommended cadence.
      </P>
      <OrderedList>
        <li>
          <Em>Every morning before dispatch.</Em> Open the Driver Briefing in the operator portal
          and confirm today's message and video. Drivers cannot start a shift until they have
          acknowledged it. This single ritual prevents the most common driver-conduct claims.
        </li>
        <li>
          <Em>Every Monday at 6 a.m. Eastern.</Em> Open the RED ALERT email. Walk the past-due list.
          Start dunning the top three.
        </li>
        <li>
          <Em>Every snowstorm or major event.</Em> Compose a Tier Offer through the Composer. Send
          to your motor-club account managers the night before. Activate the surge tier at the start
          of the event for accepting clubs only.
        </li>
        <li>
          <Em>Every damage claim.</Em> Open a ClaimShield file the moment the motor club emails you.
          Upload the walkaround video, the BOL, and the driver's photos. Click "Request Expert
          Review" if the claim is more than $500 or the motor club is being unreasonable.
        </li>
        <li>
          <Em>Every motor-club deduction.</Em> Use the Unauthorized Deduction widget on the
          ClaimShield claim file to flag the amount the moment you see the shortfall on your check.
          This is the single highest-leverage two-minute action in the platform — it preserves your
          right to dispute the deduction in writing and feeds the alliance's collective audit data.
        </li>
        <li>
          <Em>Every quarter.</Em> Review your Account Rate Cards. The platform supports per-account
          base rates, per-mile rates, and override hierarchies. Most operators leave money on the
          table by quoting commercial accounts on default rates instead of negotiated cards.
        </li>
      </OrderedList>

      <H2>What's Coming Next</H2>
      <P>
        Two of the six moats are still building. The Tier Offer Composer's full state machine
        (compose, send, accept/decline, reconciliation report) is shipping in stages — Session 1 has
        shipped, Sessions 2–4 are queued. The Impound and Lien Processing module is queued for Phase
        2 and will land state-by-state starting with the top ten by tow volume. The ClaimShield
        Insurance Pool — a per-tow premium pool that pays out small damage claims so the operator
        doesn't absorb them out of pocket — is in product design and will ship behind a feature flag
        once the actuarial model is finalized.
      </P>
      <P>
        Each of these expansions deepens the moat rather than widening it. We are deliberately
        resisting the temptation to add adjacent features that look like commodity towing software.
        The strategic discipline is that every line of code we ship makes the alliance harder to
        displace.
      </P>

      <Callout tone="tip" title="One sentence to remember">
        Most towing platforms help you take photos. Ours wins the dispute, collects the past-due,
        negotiates the storm rate, and feeds the alliance's evidence against unauthorized motor-club
        deductions. The moats are the difference.
      </Callout>

      <H2>Related Concepts You Should Understand</H2>
      <UnorderedList>
        <li>
          <Related
            href="/help/advanced-features/dynamic-pricing"
            title="Dynamic Pricing — How to Configure and Activate Tiers"
          />
        </li>
        <li>
          <Related
            href="/help/advanced-features/tier-offer-composer"
            title="The Tier Offer Composer — Negotiating with Motor Clubs"
          />
        </li>
        <li>
          <Related
            href="/help/advanced-features/account-rate-cards"
            title="Account Rate Cards — Managing Commercial Pricing"
          />
        </li>
        <li>
          <Related
            href="/help/advanced-features/impound-yard-operations"
            title="Impound and Storage Yard Operations"
          />
        </li>
        <li>
          <Related href="/help/billing-finance/red-alert-workflow" title="The RED ALERT Workflow" />
        </li>
        <li>
          <Related
            href="/help/daily-operations/capturing-evidence"
            title="Capturing Field Evidence"
          />
        </li>
        <li>
          <Related
            href="/help/company-policies/damage-claim-procedure"
            title="Damage Claim Dispute Procedure"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
