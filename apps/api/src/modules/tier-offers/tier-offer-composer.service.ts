/**
 * TierOfferComposerService — owns the tier_offers lifecycle.
 *
 * Responsibilities:
 *   - compose a draft offer from a dynamic_pricing_tier (+ optional inline roster)
 *   - update a draft before it's sent
 *   - send (draft → sent): flips every pending recipient to in-flight
 *   - markEventActive (sent → event_active)
 *   - conclude (sent|event_active → event_concluded)
 *   - cancel (any live state → cancelled): revokes all in-flight recipients
 *   - soft-delete a draft
 *
 * Every state change runs inside a single tenant-scoped transaction, so
 * the DB audit trigger (fn_audit_log) captures the actor + before/after.
 * The state transitions are validated against the pure machine in
 * tier-offer-state.ts before any write.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { dynamicPricingTiers, uuidv7 } from '@ustowdispatch/db';
import {
  type CreateTierOfferPayload,
  ERROR_CODES,
  type TierOfferDto,
  type UpdateTierOfferPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { toTierOfferDto, toTierOfferRecipientDto } from './tier-offer-mappers.js';
import { canTransitionOffer, isRecipientRevocable } from './tier-offer-state.js';
import { TierOfferTokenService } from './tier-offer-token.service.js';
import { TierOfferRepository } from './tier-offer.repository.js';
import type { ComposeAndSendInlineRecipient } from './tier-offers.dtos.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ComposeTierOfferInput extends CreateTierOfferPayload {
  recipients?: ComposeAndSendInlineRecipient[];
}

@Injectable()
export class TierOfferComposerService {
  private readonly log = new Logger(TierOfferComposerService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly repo: TierOfferRepository,
    private readonly tokens: TierOfferTokenService,
  ) {}

  async list(ctx: CallerCtx): Promise<TierOfferDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await this.repo.listOffers(tx);
      return rows.map(toTierOfferDto);
    });
  }

  async compose(ctx: CallerCtx, input: ComposeTierOfferInput): Promise<TierOfferDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // Tier must exist, belong to this tenant (RLS guarantees scope), and
      // not be soft-deleted. Composing an offer off a dead tier is a
      // 400 — the operator picked a tier that's gone.
      const tier = await tx.query.dynamicPricingTiers.findFirst({
        where: and(eq(dynamicPricingTiers.id, input.tierId), isNull(dynamicPricingTiers.deletedAt)),
      });
      if (!tier) {
        throw new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: 'tierId does not reference a live dynamic pricing tier',
        });
      }

      const offer = await this.repo.insertOffer(tx, {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        tierId: input.tierId,
        composedBy: ctx.userId,
        title: input.title,
        subjectLine: input.subjectLine,
        narrative: input.narrative,
        eventWindowStart: new Date(input.eventWindowStart),
        eventWindowEnd: new Date(input.eventWindowEnd),
        committedTruckCount: input.committedTruckCount,
        acceptanceDeadlineAt: new Date(input.acceptanceDeadlineAt),
        defaultForNonResponders: input.defaultForNonResponders,
        status: 'draft',
      });

      // Optional inline roster — mint a magic-link token per recipient.
      if (input.recipients && input.recipients.length > 0) {
        for (const r of input.recipients) {
          const recipientId = uuidv7();
          const minted = this.tokens.mint(recipientId, offer.acceptanceDeadlineAt);
          await this.repo.insertRecipient(tx, {
            id: recipientId,
            tenantId: ctx.tenantId,
            offerId: offer.id,
            accountId: r.accountId ?? null,
            recipientName: r.recipientName,
            recipientRole: r.recipientRole ?? null,
            recipientEmail: r.recipientEmail,
            recipientPhone: r.recipientPhone ?? null,
            magicLinkToken: minted.token,
            magicLinkExpiresAt: minted.expiresAt,
            status: 'pending_send',
            notes: r.notes ?? null,
          });
        }
      }

      return toTierOfferDto(offer);
    });
  }

  async updateDraft(
    ctx: CallerCtx,
    offerId: string,
    input: UpdateTierOfferPayload,
  ): Promise<TierOfferDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await this.requireOffer(tx, offerId);
      if (offer.status !== 'draft') {
        throw new ConflictException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'Only draft offers can be edited; send, cancel, or conclude instead',
        });
      }

      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.subjectLine !== undefined) patch.subjectLine = input.subjectLine;
      if (input.narrative !== undefined) patch.narrative = input.narrative;
      if (input.eventWindowStart !== undefined)
        patch.eventWindowStart = new Date(input.eventWindowStart);
      if (input.eventWindowEnd !== undefined) patch.eventWindowEnd = new Date(input.eventWindowEnd);
      if (input.committedTruckCount !== undefined)
        patch.committedTruckCount = input.committedTruckCount;
      if (input.acceptanceDeadlineAt !== undefined)
        patch.acceptanceDeadlineAt = new Date(input.acceptanceDeadlineAt);
      if (input.defaultForNonResponders !== undefined)
        patch.defaultForNonResponders = input.defaultForNonResponders;

      const updated = await this.repo.updateOffer(tx, offerId, patch);
      if (!updated) throw this.notFound();
      return toTierOfferDto(updated);
    });
  }

  /**
   * draft → sent. Requires at least one recipient on the roster (an offer
   * with nobody to send to is a no-op). Recipients in pending_send flip to
   * 'sent' — they become live/clickable now. The actual SendGrid dispatch
   * + emailSentAt stamping lands in Session 3; here 'sent' means "offer
   * dispatched, awaiting response", which is what the expiry sweep keys on.
   */
  async send(ctx: CallerCtx, offerId: string): Promise<TierOfferDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await this.requireOffer(tx, offerId);
      this.assertTransition(offer.status, 'sent');

      const pending = await this.repo.listRecipientsForOfferByStatus(tx, offerId, ['pending_send']);
      const allRecipients = await this.repo.listRecipientsForOffer(tx, offerId);
      if (allRecipients.length === 0) {
        throw new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: 'Cannot send an offer with no recipients',
        });
      }

      const now = new Date();
      for (const r of pending) {
        await this.repo.updateRecipient(tx, r.id, { status: 'sent' });
      }

      const updated = await this.repo.updateOffer(tx, offerId, {
        status: 'sent',
        sentAt: now,
      });
      if (!updated) throw this.notFound();
      this.log.log(
        `tier-offer ${offerId} sent to ${pending.length} recipient(s) for tenant ${ctx.tenantId}`,
      );
      return toTierOfferDto(updated);
    });
  }

  /** sent → event_active. */
  async markEventActive(ctx: CallerCtx, offerId: string): Promise<TierOfferDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await this.requireOffer(tx, offerId);
      this.assertTransition(offer.status, 'event_active');
      const updated = await this.repo.updateOffer(tx, offerId, { status: 'event_active' });
      if (!updated) throw this.notFound();
      return toTierOfferDto(updated);
    });
  }

  /** sent|event_active → event_concluded. */
  async conclude(ctx: CallerCtx, offerId: string): Promise<TierOfferDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await this.requireOffer(tx, offerId);
      this.assertTransition(offer.status, 'event_concluded');
      const updated = await this.repo.updateOffer(tx, offerId, { status: 'event_concluded' });
      if (!updated) throw this.notFound();
      return toTierOfferDto(updated);
    });
  }

  /**
   * any live state → cancelled. Revokes every non-terminal recipient so a
   * stale magic link can't be clicked after the operator pulls the offer.
   */
  async cancel(ctx: CallerCtx, offerId: string, reason: string): Promise<TierOfferDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await this.requireOffer(tx, offerId);
      this.assertTransition(offer.status, 'cancelled');

      const now = new Date();
      const recipients = await this.repo.listRecipientsForOffer(tx, offerId);
      for (const r of recipients) {
        if (isRecipientRevocable(r.status)) {
          await this.repo.updateRecipient(tx, r.id, { status: 'revoked' });
        }
      }

      const updated = await this.repo.updateOffer(tx, offerId, {
        status: 'cancelled',
        cancelledAt: now,
        cancelledReason: reason,
      });
      if (!updated) throw this.notFound();
      return toTierOfferDto(updated);
    });
  }

  async softDelete(ctx: CallerCtx, offerId: string): Promise<void> {
    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await this.requireOffer(tx, offerId);
      // Only drafts and cancelled offers may be removed — a live/sent offer
      // is a contractual record and must be cancelled (not deleted) first.
      if (offer.status !== 'draft' && offer.status !== 'cancelled') {
        throw new ConflictException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'Only draft or cancelled offers can be deleted; cancel a live offer first',
        });
      }
      await this.repo.softDeleteOffer(tx, offerId);
    });
  }

  /** Full detail (offer + roster) for the admin detail view. */
  async getDetail(
    ctx: CallerCtx,
    offerId: string,
  ): Promise<{ offer: TierOfferDto; recipients: ReturnType<typeof toTierOfferRecipientDto>[] }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await this.requireOffer(tx, offerId);
      const recipients = await this.repo.listRecipientsForOffer(tx, offerId);
      return {
        offer: toTierOfferDto(offer),
        recipients: recipients.map(toTierOfferRecipientDto),
      };
    });
  }

  // ---------- internals ----------

  private async requireOffer(tx: Tx, offerId: string) {
    const offer = await this.repo.findOffer(tx, offerId);
    if (!offer) throw this.notFound();
    return offer;
  }

  private assertTransition(
    from: Parameters<typeof canTransitionOffer>[0],
    to: Parameters<typeof canTransitionOffer>[1],
  ): void {
    if (!canTransitionOffer(from, to)) {
      throw new ConflictException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message: `Cannot transition offer from "${from}" to "${to}"`,
      });
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Tier offer not found' });
  }

  private toTenantCtx(ctx: CallerCtx) {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}
