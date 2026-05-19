/**
 * TierOfferLifecycleCron — Tier Offer Composer Session 4.
 *
 * Runs every five minutes. Three responsibilities:
 *
 *   1. Walk offer state forward in time:
 *        sent           → event_active when event_window_start <= NOW()
 *        event_active   → event_concluded when event_window_end < NOW()
 *      Catches up correctly when the cron has been disabled overnight —
 *      every offer past its end window flips in the same tick.
 *
 *   2. Expire any tier_offer_recipients row whose offer's
 *      acceptance_deadline_at is in the past AND whose status is one of
 *      pending_send / sent / delivered / opened. These rows go to
 *      `expired`. Recipients who already accepted or declined keep
 *      their response — that row is the contractual record and we
 *      never regress it.
 *
 *      The offer's `default_for_non_responders` decides what happens
 *      to FUTURE jobs from those accounts during the event window:
 *        - `opt_out` → enforcement returns `pending`, dispatch board
 *          flags the job for operator review (existing behavior in
 *          TierOfferEnforcementService — pending status path).
 *        - `accept_at_standard_rate` → enforcement returns
 *          `no_active_offer`, dispatch board doesn't flag (the operator
 *          just runs at the standard rate).
 *      Both behaviors are already implemented in the enforcement service;
 *      the cron's job is just to land the recipient row at `expired`.
 *
 *   3. Cancellation tidy-up: NOT in scope for v1. Stale drafts whose
 *      composer was deleted are an admin-tool concern.
 *
 * Gating: TIER_OFFER_CRON_ENABLED env flag. The @Cron decorator still
 * mounts when the flag is false (so the schedule is registered) but the
 * tick body short-circuits — same pattern as AutoRevertService.
 *
 * Idempotency: every UPDATE has an `IN (...)` source-status whitelist;
 * re-running the cron is safe.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { tierOfferRecipients, tierOffers } from '@ustowdispatch/db';
import { and, eq, inArray, isNull, lt, lte } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';

export interface LifecycleTickResult {
  offersActivated: number;
  offersConcluded: number;
  recipientsExpired: number;
}

@Injectable()
export class TierOfferLifecycleCron {
  private readonly log = new Logger(TierOfferLifecycleCron.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
  ) {}

  /**
   * Five-minute tick. The body short-circuits when the env flag is
   * false so dev / CI don't churn. Public `tick()` lets integration
   * tests drive the cron directly without waiting for the schedule.
   */
  @Cron('*/5 * * * *')
  async cronTick(): Promise<LifecycleTickResult | null> {
    if (!this.config.tierOffer.cronEnabled) {
      this.log.debug('TierOfferLifecycleCron: cron disabled by env flag');
      return null;
    }
    return this.tick();
  }

  /**
   * Public entry point so integration tests can drive the lifecycle
   * walk synchronously without waiting for the @Cron schedule.
   */
  async tick(): Promise<LifecycleTickResult> {
    return this.admin.runAsAdmin({}, async (db) => {
      const now = new Date();
      const result: LifecycleTickResult = {
        offersActivated: 0,
        offersConcluded: 0,
        recipientsExpired: 0,
      };

      // 1. sent → event_active when window start has elapsed.
      const activated = await db
        .update(tierOffers)
        .set({ status: 'event_active', updatedAt: now })
        .where(
          and(
            eq(tierOffers.status, 'sent'),
            isNull(tierOffers.deletedAt),
            lte(tierOffers.eventWindowStart, now),
          ),
        )
        .returning({ id: tierOffers.id });
      result.offersActivated = activated.length;

      // 2. event_active → event_concluded when window end has elapsed.
      const concluded = await db
        .update(tierOffers)
        .set({ status: 'event_concluded', updatedAt: now })
        .where(
          and(
            eq(tierOffers.status, 'event_active'),
            isNull(tierOffers.deletedAt),
            lt(tierOffers.eventWindowEnd, now),
          ),
        )
        .returning({ id: tierOffers.id });
      result.offersConcluded = concluded.length;

      // 3. Expire recipients past the offer's acceptance deadline.
      //    Two-step because the in-flight whitelist plus the deadline
      //    join needs a per-offer subquery; simplest correct path is
      //    to read offers past deadline first and then update their
      //    in-flight recipients in a single batched UPDATE.
      const offersPastDeadline = await db.query.tierOffers.findMany({
        where: and(
          isNull(tierOffers.deletedAt),
          inArray(tierOffers.status, ['sent', 'event_active', 'event_concluded']),
          lt(tierOffers.acceptanceDeadlineAt, now),
        ),
        columns: { id: true },
      });
      if (offersPastDeadline.length > 0) {
        const offerIds = offersPastDeadline.map((o) => o.id);
        const expired = await db
          .update(tierOfferRecipients)
          .set({ status: 'expired', updatedAt: now })
          .where(
            and(
              inArray(tierOfferRecipients.offerId, offerIds),
              inArray(tierOfferRecipients.status, ['pending_send', 'sent', 'delivered', 'opened']),
              isNull(tierOfferRecipients.deletedAt),
            ),
          )
          .returning({ id: tierOfferRecipients.id });
        result.recipientsExpired = expired.length;
      }

      this.log.log({
        msg: 'tier-offer lifecycle tick',
        ...result,
      });
      return result;
    });
  }
}
