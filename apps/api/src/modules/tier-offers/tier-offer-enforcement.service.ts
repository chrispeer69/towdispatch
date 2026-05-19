/**
 * TierOfferEnforcementService — read-only resolver consumed at job
 * creation time by JobsService.
 *
 * Given a tenant + account_id + job-started-at timestamp, decides which
 * tier offer (if any) governs the dispatch and reports the per-recipient
 * acceptance status. The output drives both the elevated-tier-applies
 * branch (status === 'accepted') and the dispatch-board badge that asks
 * the operator whether to accept the dispatch at standard rate or decline
 * with a structured "capacity unavailable" reason.
 *
 * The service is intentionally pure-read; no rows are mutated. JobsService
 * passes the result back to its insert path so the new job carries the
 * tier_offer_id / tier_offer_recipient_id / tier_offer_enforcement_status
 * columns introduced by migration 0035.
 */
import { Injectable } from '@nestjs/common';
import { tierOfferRecipients, tierOffers } from '@ustowdispatch/db';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';

export type TierOfferEnforcementResolution =
  | { kind: 'no_active_offer' }
  | { kind: 'accepted'; offerId: string; recipientId: string; tierId: string }
  | { kind: 'declined'; offerId: string; recipientId: string }
  | { kind: 'pending'; offerId: string; recipientId: string };

@Injectable()
export class TierOfferEnforcementService {
  constructor(private readonly db: TenantAwareDb) {}

  /**
   * Convenience entry point used by JobsService when it already holds an
   * open transaction — avoids re-entering the tenant context.
   */
  async resolveForJob(
    tx: Tx,
    args: {
      tenantId: string;
      accountId: string | null;
      jobStartedAt: Date;
    },
  ): Promise<TierOfferEnforcementResolution> {
    if (!args.accountId) return { kind: 'no_active_offer' };
    // Find any active or sent offer whose event window covers jobStartedAt.
    // We accept both `sent` and `event_active` to give the cron a soft
    // window to flip status — enforcement should not depend on the cron
    // being on time.
    const offer = await tx.query.tierOffers.findFirst({
      where: and(
        eq(tierOffers.tenantId, args.tenantId),
        isNull(tierOffers.deletedAt),
        // We accept either 'sent' or 'event_active' below; the cron that
        // moves sent -> event_active runs every 5 minutes (Session 4) so
        // enforcement should not depend on it being on time. The status
        // check is done after the find rather than via inArray to keep
        // the where clause readable.
        lte(tierOffers.eventWindowStart, args.jobStartedAt),
        gte(tierOffers.eventWindowEnd, args.jobStartedAt),
      ),
    });
    if (!offer) return { kind: 'no_active_offer' };
    if (offer.status !== 'sent' && offer.status !== 'event_active') {
      return { kind: 'no_active_offer' };
    }
    const recipient = await tx.query.tierOfferRecipients.findFirst({
      where: and(
        eq(tierOfferRecipients.tenantId, args.tenantId),
        eq(tierOfferRecipients.offerId, offer.id),
        eq(tierOfferRecipients.accountId, args.accountId),
        isNull(tierOfferRecipients.deletedAt),
      ),
    });
    if (!recipient) return { kind: 'no_active_offer' };
    if (recipient.status === 'accepted') {
      return {
        kind: 'accepted',
        offerId: offer.id,
        recipientId: recipient.id,
        tierId: offer.tierId,
      };
    }
    if (
      recipient.status === 'declined' ||
      recipient.status === 'expired' ||
      recipient.status === 'revoked' ||
      recipient.status === 'bounced'
    ) {
      return { kind: 'declined', offerId: offer.id, recipientId: recipient.id };
    }
    // pending_send / sent / delivered / opened — recipient hasn't taken
    // an action yet.
    return { kind: 'pending', offerId: offer.id, recipientId: recipient.id };
  }
}
