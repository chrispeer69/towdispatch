/**
 * Pricing Decision Guide article body.
 *
 * Operator-facing training for the most common confusion in the product:
 * when to reach for Dynamic Pricing versus when to reach for the Tier
 * Offer Composer. The two systems sit side-by-side in the sidebar and
 * solve adjacent problems; this article exists so an owner can answer
 * "which one do I use right now?" in under sixty seconds.
 */
import type { JSX } from 'react';
import {
  Callout,
  Code,
  Em,
  H2,
  H3,
  OrderedList,
  P,
  RelatedDoc,
  Steps,
  Table,
  UnorderedList,
} from './_blocks';

export function PricingDecisionGuideArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        US Tow DISPATCH gives you two pricing tools that look related, sit next to each other in the
        sidebar, and both use the word <Em>tier</Em>. They are not the same thing. Owners and
        managers consistently confuse them in the first week, then get tangled up about which one to
        reach for when a storm rolls in or when a motor club calls to negotiate. This article is the
        cheat sheet.
      </P>
      <P>Read the next two paragraphs and you can use both systems correctly forever.</P>

      <H2>One-sentence definitions</H2>
      <P>
        <Em>Dynamic Pricing</Em> is the automatic price-engine that adjusts the rate on every job
        depending on conditions you have pre-configured (weather, holidays, time of day, traffic,
        special events). You set the rules once; the engine applies them to every dispatch from that
        moment on, with no further action from you.
      </P>
      <P>
        <Em>Tier Offers</Em> are signed agreements with individual motor clubs covering a specific
        event window. You compose an offer (for example, "8 trucks at 1.5× during the December 21
        snow event"), send it to the account managers at Agero, Allstate, Geico, and so on, and each
        club accepts or declines independently. The acceptance is the contractual record that
        justifies the premium on every job from that club during that window.
      </P>

      <H2>The core distinction</H2>
      <P>
        Dynamic Pricing changes the price of a job <Em>automatically</Em>, based on rules you wrote
        ahead of time. Tier Offers change the price of a job{' '}
        <Em>
          only after the motor club has signed off in writing on the new rate for the specific
          window.
        </Em>{' '}
        The former applies to cash customers and commercial accounts whose contracts permit it; the
        latter is the only path to legitimate premium pricing on calls from contracted motor clubs.
      </P>

      <Callout tone="warning" title="The single most important rule">
        Dynamic Pricing does <Em>not</Em> auto-apply to motor clubs. Their rates are contractually
        fixed. The only path to a premium rate on a motor club dispatch is a Tier Offer that has
        been explicitly accepted by their account manager.
      </Callout>

      <H2>Side-by-side comparison</H2>
      <Table
        head={['Aspect', 'Dynamic Pricing (Moat #1)', 'Tier Offers (Moat #3)']}
        rows={[
          ['What it is', 'A rules engine', 'A negotiation tool'],
          [
            'Who decides',
            'You write rules; engine auto-applies',
            'You propose; motor club accepts or declines',
          ],
          [
            'Output',
            'Price multiplier on every job, all the time',
            'Per-club signed agreement for a specific event window',
          ],
          [
            'Trigger',
            'Weather alert, holiday date, clock, traffic, calendar event',
            'Operator-composed; sent on demand',
          ],
          [
            'Customer consent',
            'Implicit (cash and commercial accept the published rate)',
            'Explicit (signed magic-link acceptance with IP + timestamp)',
          ],
          [
            'Applies to motor clubs?',
            <span key="dp-no">No, never automatically</span>,
            <span key="to-yes">Yes, when the club has accepted</span>,
          ],
          [
            'Lifecycle',
            'Activate / deactivate / auto-revert',
            'Draft → Sent → Event active → Event concluded',
          ],
          [
            'Audit shape',
            'Tier-activation history per tenant',
            'Per-recipient acceptance ledger per offer',
          ],
          ['Typical timing', 'Same hour the storm hits', 'A day or two before a known event'],
          [
            'Reverses when?',
            'When you deactivate or when auto-revert fires',
            'When the event window closes',
          ],
        ]}
      />

      <H2>The decision tree</H2>
      <P>Use this when something happens and you need to figure out which lever to pull.</P>

      <H3>Scenario A — Conditions just changed in your service area</H3>
      <P>
        Snow started falling. A holiday is hours away. A football game is about to let out. The
        clock just hit 8 PM. These are the canonical Dynamic Pricing triggers because the rate
        change should kick in automatically across every cash and commercial dispatch from that
        moment on.
      </P>
      <OrderedList>
        <li>
          Open <Em>Operations → Dynamic Pricing</Em> (the Control Panel).
        </li>
        <li>
          Find the tier that matches the condition. If it doesn't exist, you have not pre-configured
          it; that is owner / admin work in Settings, not real-time operator work.
        </li>
        <li>
          Click <Em>Activate</Em> and set an auto-revert time so the premium turns off when the
          condition ends.
        </li>
      </OrderedList>
      <P>
        You don't need to touch Tier Offers for this. Motor club dispatches arrive at their
        contracted rate as normal.
      </P>

      <H3>Scenario B — A specific motor club is calling about a big event</H3>
      <P>
        Agero's regional manager calls and asks whether you can guarantee eight trucks during the
        December 21 storm. The answer is "yes, at the storm rate." This is the canonical Tier Offer
        scenario because you need an explicit signed agreement before you can legitimately bill the
        premium.
      </P>
      <OrderedList>
        <li>
          Open <Em>Operations → Tier Offers → Compose new offer</Em>.
        </li>
        <li>
          Pick the Dynamic Pricing tier you want to attach (typically the same Level-2 Snow tier you
          would activate automatically for cash customers). If you don't have one, create it in
          Settings first.
        </li>
        <li>
          Fill in the title, narrative, event window, acceptance deadline, committed truck count,
          and the default for non-responders.
        </li>
        <li>
          Add Agero (and any other motor clubs you want to extend the same offer to) as recipients.
        </li>
        <li>
          Click <Em>Send to recipients</Em>. The account managers receive an email with a unique
          magic link.
        </li>
        <li>
          They open the landing page, read the terms, click Accept. Their IP, User-Agent, and
          timestamp are recorded as the contractual record.
        </li>
      </OrderedList>
      <P>
        When the event window opens and a job comes in from Agero's account, the dispatch board
        shows a green <Em>Tier accepted</Em> badge and the elevated rate auto-applies. Clubs that
        declined still get dispatched at the standard rate, but the dispatch board flags those jobs
        amber so the operator can decide whether to take them.
      </P>

      <H3>
        Scenario C — A big event is approaching but you don't know which motor clubs will play
      </H3>
      <P>
        A blizzard is forecast for three days from now. You want to give every motor club a chance
        to opt in to event pricing ahead of time. This is also a Tier Offer situation, with a longer
        lead time.
      </P>
      <OrderedList>
        <li>
          Open <Em>Tier Offers → Compose new offer</Em>.
        </li>
        <li>
          Set the event window to the forecast window (e.g., 48 hours starting Saturday 6 AM).
        </li>
        <li>
          Set the acceptance deadline 12 to 24 hours before the window opens, so you know your
          committed capacity before the storm hits.
        </li>
        <li>
          Add every motor club account contact you have on file. Use the recipient picker;
          motor-club accounts surface first.
        </li>
        <li>
          Pick the default for non-responders: <Em>opt out</Em> if you would rather not take their
          dispatches at all during the storm (you'll flag them on the board), or{' '}
          <Em>accept at standard rate</Em> if you'll still serve them at the regular rate without
          the premium.
        </li>
        <li>Send.</li>
      </OrderedList>
      <P>
        When the storm arrives, Dynamic Pricing automatically handles cash customers (Scenario A).
        The Tier Offer handles the motor clubs that signed off. Two systems, one event.
      </P>

      <H3>Scenario D — A motor club calls during a storm asking to renegotiate</H3>
      <P>
        Allstate's manager calls during the storm and asks if you can pull more trucks for them at
        the elevated rate. They didn't accept the offer you sent them yesterday.
      </P>
      <OrderedList>
        <li>This is a verbal negotiation, but the platform needs a written record.</li>
        <li>
          Open <Em>Tier Offers → Compose new offer</Em> for just Allstate.
        </li>
        <li>
          Title it specifically (e.g., "Allstate addendum — Dec 21 storm — verbal acceptance").
        </li>
        <li>
          Set the event window to the remaining storm hours and the acceptance deadline to thirty
          minutes from now.
        </li>
        <li>
          Send. Tell the manager on the phone to click Accept in their inbox right then; you'll
          watch the row flip on your detail page.
        </li>
        <li>
          From that moment on, Allstate's jobs come in at the elevated rate with the contractual
          record.
        </li>
      </OrderedList>

      <H2>What both tools have in common</H2>
      <P>
        Both Dynamic Pricing and Tier Offers ultimately feed the same Rate Engine. When a job is
        created, the engine asks three questions in order:{' '}
        <Em>(1) is this account on a Tier Offer that they accepted for this window?</Em> If yes,
        apply the offer's tier multiplier.{' '}
        <Em>(2) Is there an active Dynamic Pricing tier this account is eligible for?</Em> If yes,
        apply that. <Em>(3) Otherwise, use the standard rate.</Em>
      </P>
      <P>
        That ordering matters: a Tier Offer always wins because it represents an explicit,
        time-bounded, written agreement. Dynamic Pricing fills in for cash and commercial customers
        who don't get individual contracts.
      </P>

      <H2>Common mistakes (and how to avoid them)</H2>
      <Steps
        items={[
          {
            title: 'Activating a Dynamic Pricing tier and expecting motor clubs to pay it',
            body: (
              <>
                <P>
                  You hear about a Level-2 snow warning, activate the Winter Storm tier, and assume
                  the elevated rate now applies across every dispatch including motor clubs. It
                  doesn't. Motor clubs are explicitly excluded from Dynamic Pricing because their
                  contracts forbid unilateral rate changes.
                </P>
                <P>
                  The fix: compose a Tier Offer for the same window and send it to the motor clubs
                  before or as the storm starts. Their rates only change after they sign off.
                </P>
              </>
            ),
          },
          {
            title: 'Composing a Tier Offer for cash customers',
            body: (
              <>
                <P>
                  You open the composer to "set a storm rate for everyone." Cash customers don't
                  receive Tier Offer emails — there's no individual account manager to negotiate
                  with. Cash pricing is handled by Dynamic Pricing.
                </P>
                <P>
                  The fix: leave the composer alone and just activate the relevant Dynamic Pricing
                  tier in the Control Panel.
                </P>
              </>
            ),
          },
          {
            title: 'Forgetting to set an auto-revert on a Dynamic Pricing tier',
            body: (
              <>
                <P>
                  You activate the Winter Storm tier when the storm starts. Three days later the sun
                  is out and you're still charging the storm rate. Cash customers feel cheated, and
                  your dispatchers may not have noticed.
                </P>
                <P>
                  The fix: always set an auto-revert timestamp when activating a Dynamic Pricing
                  tier. A common pattern is "auto-revert 12 hours from now" — if the storm continues
                  you can re-activate, but the default is off.
                </P>
              </>
            ),
          },
          {
            title: 'Setting a Tier Offer acceptance deadline after the event window opens',
            body: (
              <>
                <P>
                  You give motor clubs until the end of the storm to accept. Half of them accept on
                  day two of the storm, after they've already been sending you jobs at the standard
                  rate. You can't retroactively re-rate those earlier jobs.
                </P>
                <P>
                  The fix: always set the acceptance deadline{' '}
                  <Em>at or before the event window start</Em>. The composer enforces this in the
                  validation layer, but only as a soft check — you can override at your peril.
                </P>
              </>
            ),
          },
          {
            title:
              'Sending a Tier Offer to "all motor clubs" without thinking about who would actually accept',
            body: (
              <>
                <P>
                  You add fifteen recipients to one offer. Twelve of them are clubs you've never
                  done meaningful business with. You spend the morning fielding angry calls from
                  regional managers asking what this is.
                </P>
                <P>
                  The fix: only send to motor-club account managers you have an active business
                  relationship with. The recipient picker shows motor-club accounts you have on
                  file; that's a deliberate constraint, not a limitation. Curate your account list
                  separately in <Em>Customers → Accounts</Em>.
                </P>
              </>
            ),
          },
        ]}
      />

      <H2>Worked example — full storm event</H2>
      <P>
        A Level-2 winter storm warning is issued for your service area, effective tomorrow at 6 AM
        through the following day at 10 PM. You operate a fleet of fifteen trucks. Three motor clubs
        send you the bulk of your contracted volume: Agero, Allstate, and Geico. Walk through how
        the two systems work together.
      </P>

      <H3>The night before</H3>
      <UnorderedList>
        <li>
          You compose a Tier Offer. Title: "Level-2 Snow Event — January 18-19." Tier attached: your
          pre-existing 1.5× Winter Storm tier. Window: 6 AM Jan 18 to 10 PM Jan 19 (40 hours).
          Acceptance deadline: 5 AM Jan 18 (one hour before window). Committed truck count: 8 (you
          keep 7 in reserve for cash). Default for non-responders: <Em>accept at standard rate</Em>{' '}
          (you'll still serve them; you just won't bill the premium).
        </li>
        <li>
          You add Agero, Allstate, and Geico as recipients. The composer typeahead surfaces the
          right account managers from your contact list.
        </li>
        <li>
          You click Send. Three emails go out. The detail page polls in real time; within fifteen
          minutes you see the rows flip from <Em>sent</Em> to <Em>delivered</Em> to <Em>opened</Em>{' '}
          as the managers see them.
        </li>
        <li>
          By 11 PM, Agero has accepted. Allstate has accepted. Geico has not opened the email yet.
        </li>
      </UnorderedList>

      <H3>5 AM — one hour before the storm</H3>
      <UnorderedList>
        <li>
          Geico's acceptance deadline has passed without a response. The lifecycle cron flips their
          recipient row to <Em>expired</Em>. Per the offer's default for non-responders, Geico's
          jobs during the storm will run at the standard rate (no premium, no dispatch-board flag).
        </li>
        <li>
          You open the Dynamic Pricing Control Panel. You activate the Winter Storm tier with an
          auto-revert of <Em>22 hours from now</Em> (the storm ends at 10 PM Jan 19, you give
          yourself a few hours of buffer).
        </li>
      </UnorderedList>

      <H3>6 AM — the storm starts</H3>
      <UnorderedList>
        <li>
          The first call comes in. It's a cash customer needing a winch-out. Dispatcher takes the
          call. The Live Quote Box shows the base rate × 1.5 because the Winter Storm tier is
          active. Quote: $225.
        </li>
        <li>
          The next call is an Agero dispatch. The job creates with{' '}
          <Code>tier_offer_enforcement_status = accepted</Code>. The Rate Engine applies the 1.5×
          tier. The Live Dispatch board shows a green <Em>Tier accepted</Em> badge on that job card.
          The bill goes out at the elevated rate, backed by Agero's signed acceptance.
        </li>
        <li>
          A Geico job comes in. The job creates with{' '}
          <Code>tier_offer_enforcement_status = none</Code> (because their default was{' '}
          <Em>accept at standard rate</Em>). The Rate Engine applies the standard rate. No badge
          appears. The dispatch is handled normally.
        </li>
      </UnorderedList>

      <H3>10 PM Jan 19 — the storm ends</H3>
      <UnorderedList>
        <li>
          The lifecycle cron flips the offer status from <Em>event_active</Em> to{' '}
          <Em>event_concluded</Em>.
        </li>
        <li>
          Two hours later your auto-revert fires on the Winter Storm Dynamic Pricing tier. The
          Control Panel shows the tier as inactive. Cash dispatches return to standard rates.
        </li>
        <li>
          You open the Tier Offer detail page and click <Em>Download CSV</Em>. The reconciliation
          report shows: Agero — 14 jobs, $4,200 billed, $2,800 baseline, $1,400 uplift. Allstate — 9
          jobs, $2,700 billed, $1,800 baseline, $900 uplift. Geico — 11 jobs, $2,200 billed, no
          uplift (expired recipient).
        </li>
        <li>
          You forward the CSV to your bookkeeper. The premium charges are pre-justified by the
          signed acceptance ledger; no disputes.
        </li>
      </UnorderedList>

      <H2>Where to learn more</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/advanced-features/dynamic-pricing"
            title="Dynamic Pricing — Complete Operator Guide"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/advanced-features/tier-offer-composer"
            title="Tier Offer Composer — Complete Operator Guide"
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
            href="/help/advanced-features/understanding-moats"
            title="Understanding Our Moats: What They Are and Why They Matter"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
