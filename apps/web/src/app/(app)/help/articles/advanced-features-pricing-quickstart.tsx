/**
 * Pricing Quickstart article — first 30 minutes setting up pricing.
 *
 * Time-boxed walkthrough for a brand-new owner. The goal: from a fresh
 * tenant to a fully operational pricing setup (Dynamic Pricing tiers
 * configured AND a first Tier Offer drafted) in half an hour.
 */
import type { JSX } from 'react';
import {
  Callout,
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

export function PricingQuickstartArticle(): JSX.Element {
  return (
    <div className="pb-12">
      <P>
        Most new owners skip pricing setup, run a few weeks of standard-rate dispatches, and then
        realize after the first storm that they left thousands of dollars on the table. This
        walkthrough gets you from a fresh tenant to a fully operational pricing setup in thirty
        minutes flat.
      </P>
      <P>
        You will end the half hour with five Dynamic Pricing tiers configured, the Tier Offer
        Composer pre-checked for the next storm, and a written record of what's set up so your
        dispatchers can refer back to it.
      </P>

      <Callout tone="tip" title="Prerequisites">
        Tenant created, Company Profile filled in, and at least one motor club account on file in{' '}
        <Em>Customers → Accounts</Em>. The integration with QuickBooks and Stripe is not required
        for this walkthrough — pricing is independent of payment processing.
      </Callout>

      <H2>Minute 0–5 — Open the configuration screen</H2>
      <Steps
        items={[
          {
            title: 'Sign in as an OWNER or ADMIN',
            body: (
              <P>
                Dynamic Pricing configuration is gated to OWNER and ADMIN roles. MANAGER and
                DISPATCHER can activate and deactivate tiers in real time but cannot edit the
                multipliers or create new ones.
              </P>
            ),
          },
          {
            title: 'Navigate to Settings → Dynamic Pricing',
            body: (
              <P>
                The left sidebar has a <Em>Dynamic Pricing</Em> entry under Operations — that's the
                Control Panel where you activate live tiers. For configuration you want{' '}
                <Em>Settings → Dynamic Pricing</Em> (a different screen with a yellow construction
                icon).
              </P>
            ),
          },
          {
            title: 'Familiarize yourself with the five categories',
            body: (
              <>
                <P>
                  Five cards across the top: Weather, Traffic, Calendar (Holidays), Time of Day,
                  Special Events. Each card holds the tiers you've configured for that category.
                </P>
                <P>
                  Holidays and Time-of-Day tiers can be configured to activate{' '}
                  <Em>automatically</Em> on a schedule. Weather, Traffic, and Special-Event tiers
                  require an operator to click Activate when the condition occurs — they are too
                  important to leave to a forecast API.
                </P>
              </>
            ),
          },
        ]}
      />

      <H2>Minute 5–15 — Create your five core tiers</H2>
      <P>
        These are the five tiers every towing operation should have at minimum. Numbers below are
        starting points; adjust them to your market.
      </P>

      <Table
        head={['Tier', 'Category', 'Multiplier', 'Activation', 'Why']}
        rows={[
          [
            <Em key="t1">Level-1 Snow</Em>,
            'Weather',
            '1.25×',
            'Manual',
            'Light snow makes every job take 30% longer; this covers your driver overtime.',
          ],
          [
            <Em key="t2">Level-2 Snow</Em>,
            'Weather',
            '1.5×',
            'Manual',
            'Storm conditions; risk of accidents to your trucks and drivers goes up substantially.',
          ],
          [
            <Em key="t3">Federal Holiday</Em>,
            'Calendar',
            '1.5×',
            'Automatic (date-based)',
            'Pre-loaded with 14 US federal holidays. Christmas and New Year default to 2.0×.',
          ],
          [
            <Em key="t4">After Hours</Em>,
            'Time of Day',
            '1.2×',
            'Automatic (clock-based, 8 PM–6 AM)',
            'Overnight tows cost more to staff and have higher cancellation rates.',
          ],
          [
            <Em key="t5">Special Event</Em>,
            'Special Events',
            '1.3×',
            'Manual',
            'Local football games, concerts, festivals — anything that snarls traffic predictably.',
          ],
        ]}
      />

      <P>
        For each tier, click the <Em>+ Add tier</Em> button on the relevant category card and fill
        in the name, multiplier, and (if applicable) the time window or holiday set. Save. Repeat.
      </P>

      <Callout tone="warning" title="Don't go crazy with the multiplier">
        Stick to multipliers in the 1.2× to 2.0× range for individual tiers. The system enforces a{' '}
        <Em>3.0× global cap</Em> across all stacked tiers, but a 2.5× single tier reads as
        price-gouging to customers and increases chargeback risk. Premium pricing earns trust when
        it's reasonable and transparent; it loses trust when it looks opportunistic.
      </Callout>

      <H2>Minute 15–20 — Test your tiers</H2>
      <P>Before relying on a tier in a real storm, prove it works.</P>
      <OrderedList>
        <li>
          Navigate to <Em>Operations → Dynamic Pricing</Em> (the Control Panel).
        </li>
        <li>
          Find your <Em>Level-1 Snow</Em> tier in the "All tiers" section. Click <Em>Activate</Em>.
          When the auto-revert prompt appears, pick "Turn off in 30 minutes" — this is a test, not a
          live storm.
        </li>
        <li>The tier moves to "Active tiers right now."</li>
        <li>
          Open a new browser tab. Navigate to <Em>Operations → Intake</Em>.
        </li>
        <li>
          Fill in a fake intake: cash customer, a basic tow service type, a pickup and dropoff
          address.
        </li>
        <li>
          Watch the Live Quote Box on the right. The base rate should be multiplied by 1.25, with a
          clearly labeled line item showing "Dynamic Pricing: Level-1 Snow (1.25×)."
        </li>
        <li>Close the intake without dispatching (click Cancel). The test is done.</li>
        <li>
          Back in the Control Panel, click <Em>Deactivate</Em> on the Level-1 Snow tier. The
          auto-revert would fire eventually, but you don't need to wait.
        </li>
      </OrderedList>

      <P>
        If the Live Quote Box did not reflect the 1.25× multiplier, troubleshoot. The most common
        cause is that the customer type defaulted to "Account / Motor Club" — Dynamic Pricing only
        applies to cash and commercial accounts. Change the customer type and refresh.
      </P>

      <H2>Minute 20–30 — Compose your first Tier Offer (draft only)</H2>
      <P>
        You won't send this yet. The goal is to have a fully drafted offer sitting in the system so
        that when the next forecast comes in, you click Send instead of starting from scratch.
      </P>
      <OrderedList>
        <li>
          Navigate to <Em>Operations → Tier Offers → Compose new offer</Em>.
        </li>
        <li>
          Pick your <Em>Level-2 Snow</Em> tier from the Dynamic Pricing dropdown. (If you don't see
          it, you didn't save it in the previous step — go back and finish that.)
        </li>
        <li>
          Title: <Em>"Level-2 Snow Event Template"</Em>. Subject line:{' '}
          <Em>"Capacity offer — Level-2 Snow Event"</Em>. Narrative: see the template below.
        </li>
        <li>
          Event window: leave the defaults; you'll edit before sending. Acceptance deadline: same.
        </li>
        <li>
          Committed truck count: enter whatever you can realistically commit during a Level-2 storm.
          Be conservative — under-committing and then increasing is fine; over-committing and
          pulling back damages relationships.
        </li>
        <li>
          Default for non-responders: <Em>accept at standard rate</Em>. (You can change this
          per-offer when sending.)
        </li>
        <li>
          Recipient picker: add your top three motor club account managers. Use the typeahead;
          motor-club accounts surface first.
        </li>
        <li>
          Click <Em>Save draft</Em>. <Em>Do not click Send</Em>. The offer lands in Drafts.
        </li>
      </OrderedList>

      <H3>Sample narrative template</H3>
      <Callout tone="info" title="Suggested wording for the narrative field">
        <P>
          Hi <Em>{'{recipient.name}'}</Em>,
        </P>
        <P>
          A Level-2 winter storm warning has been issued for our service area, effective{' '}
          <Em>[window dates]</Em>. Conditions will be hazardous and we expect to be running near
          capacity throughout.
        </P>
        <P>
          We're committing <Em>[X] trucks</Em> to your account during this window at our Level-2
          Snow tier (1.5× our standard rate). This protects our ability to staff appropriately and
          gives your drivers priority dispatch during the event.
        </P>
        <P>
          Please reply by <Em>[deadline]</Em> with Accept or Decline so we can finalize our
          allocations.
        </P>
        <P>
          Thank you,
          <br />
          <Em>[your name]</Em>
        </P>
      </Callout>

      <P>
        The actual recipient sees their own name auto-substituted; you write the narrative once and
        it personalizes per recipient.
      </P>

      <H2>The 30-minute scorecard</H2>
      <P>
        At the end of this walkthrough you should have all of the following in place. Check them
        off; if any are missing, go back.
      </P>
      <UnorderedList>
        <li>
          Five Dynamic Pricing tiers configured (Level-1 Snow, Level-2 Snow, Federal Holiday, After
          Hours, Special Event).
        </li>
        <li>Tested at least one tier against a fake intake and watched the multiplier apply.</li>
        <li>One Tier Offer saved as a draft, with your motor-club recipients pre-selected.</li>
        <li>Narrative template populated so future sends are mostly date edits.</li>
        <li>
          You've shown a dispatcher where to find the Control Panel and how to Activate a tier.
        </li>
      </UnorderedList>

      <H2>What to do when the storm actually hits</H2>
      <OrderedList>
        <li>
          Open the draft Tier Offer. Edit the event window to match the forecast. Adjust truck count
          if needed. Click <Em>Send to recipients</Em>.
        </li>
        <li>
          Open the Control Panel. Activate the relevant Dynamic Pricing tier (Level-1 or Level-2
          depending on severity). Set the auto-revert.
        </li>
        <li>Watch the Tier Offer detail page as accept / decline events roll in.</li>
        <li>Take calls. The Live Quote Box reflects the correct rate per customer type.</li>
        <li>
          When the storm ends, the Dynamic Pricing tier auto-reverts. The Tier Offer auto-concludes
          when the window closes. Download the reconciliation CSV.
        </li>
      </OrderedList>

      <H2>What to do every quarter</H2>
      <P>Pricing is a living system. Review it on a regular cadence so it stays current.</P>
      <UnorderedList>
        <li>
          <Em>Review your tier multipliers</Em>. Are they still appropriate? Have your costs gone
          up?
        </li>
        <li>
          <Em>Audit your tier history</Em>. The Dynamic Pricing Control Panel surfaces "Recent tier
          history (last 24 hours)" and a longer history view. Look for tiers you activated and
          forgot to deactivate, or tiers you never activated at all.
        </li>
        <li>
          <Em>Check your Tier Offer acceptance rate</Em>. The list page filters by status. If motor
          clubs consistently decline, the rate is too high for your market or you're sending it too
          late.
        </li>
        <li>
          <Em>Update the narrative template</Em>. Storms last year and storms this year are
          different; your written framing should reflect current conditions.
        </li>
      </UnorderedList>

      <H2>Where to go next</H2>
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
            href="/help/advanced-features/pricing-decision-guide"
            title="Dynamic Pricing vs. Tier Offers — Which One Do I Use When?"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/getting-started/company-profile"
            title="Setting Up Your Company Profile"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
