/**
 * TierOfferService — Tier Offer Composer (Moat #3) Session 2.
 *
 * The composer is negotiation infrastructure: the operator proposes terms
 * (tier multiplier × event window × committed truck count), each motor
 * club account manager accepts or declines independently via signed
 * magic link, and the resulting allocation is contractually clean and
 * audit-trailed.
 *
 * This service owns the full server-side orchestration:
 *   - createDraft / updateDraft / softDeleteDraft           (operator-side)
 *   - addRecipient / removeRecipient                         (operator-side)
 *   - send  (mints magic-link JWTs, dispatches per-recipient emails,
 *            transitions tier_offers.status draft → sent, recipients
 *            pending_send → sent)
 *   - cancel (transitions tier_offers.status sent → cancelled,
 *             recipient rows pending_send/sent/delivered/opened → revoked)
 *   - acceptByToken / declineByToken (token-validating, IP/UA-capturing,
 *                                     idempotent, used by the public
 *                                     landing-page controller)
 *   - getTokenPayload (verifies a magic-link token + asserts the
 *                      assignment still matches the database; returns
 *                      everything the public landing page needs to
 *                      render or null on failure)
 *
 * RLS / RBAC notes:
 *   - All operator-side methods run inside `runInTenantContext` so RLS
 *     keeps tenants isolated. Controllers gate each method by Role.
 *   - The two token-by-token methods (acceptByToken, declineByToken,
 *     getTokenPayload) MUST run as admin-pool tx (no tenant context yet)
 *     because the JWT carries the tenant id; we then verify the row's
 *     tenant_id matches the JWT's tenant_id. RLS would force-block these
 *     under app_user pool because the unauthenticated request never sets
 *     `app.current_tenant_id`.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  dynamicPricingTiers,
  tenants,
  tierOfferRecipients,
  tierOffers,
  users,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type CreateTierOfferPayload,
  type CreateTierOfferRecipientPayload,
  type TierOfferDto,
  type TierOfferRecipientDto,
  type UpdateTierOfferPayload,
  type UpdateTierOfferRecipientPayload,
} from '@ustowdispatch/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { EmailService } from '../email/email.service.js';
import { signMagicLink, verifyMagicLink } from './magic-link.js';

interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

const MAGIC_LINK_TTL_DAYS = 7;
const MAGIC_LINK_TTL_SECONDS = MAGIC_LINK_TTL_DAYS * 24 * 60 * 60;

@Injectable()
export class TierOfferService {
  private readonly log = new Logger(TierOfferService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // -----------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------

  async list(ctx: CallerCtx, filter: { status?: string }): Promise<TierOfferDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.tierOffers.findMany({
        where: filter.status
          ? and(
              isNull(tierOffers.deletedAt),
              eq(tierOffers.status, filter.status as TierOfferDto['status']),
            )
          : isNull(tierOffers.deletedAt),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
      return rows.map(toOfferDto);
    });
  }

  async getOne(
    ctx: CallerCtx,
    offerId: string,
  ): Promise<{ offer: TierOfferDto; recipients: TierOfferRecipientDto[] }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await tx.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)),
      });
      if (!offer) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });
      }
      const recipients = await tx.query.tierOfferRecipients.findMany({
        where: and(eq(tierOfferRecipients.offerId, offerId), isNull(tierOfferRecipients.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      });
      return {
        offer: toOfferDto(offer),
        recipients: recipients.map(toRecipientDto),
      };
    });
  }

  // -----------------------------------------------------------------
  // Operator-side writes
  // -----------------------------------------------------------------

  async createDraft(ctx: CallerCtx, input: CreateTierOfferPayload): Promise<TierOfferDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // Sanity: tier must belong to this tenant. RLS guarantees we cannot
      // even see another tenant's tiers, but a cleaner 404 is friendlier
      // than a constraint failure.
      const tier = await tx.query.dynamicPricingTiers.findFirst({
        where: and(eq(dynamicPricingTiers.id, input.tierId), isNull(dynamicPricingTiers.deletedAt)),
      });
      if (!tier) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Tier not found in this tenant',
        });
      }
      const id = uuidv7();
      const [row] = await tx
        .insert(tierOffers)
        .values({
          id,
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
        })
        .returning();
      if (!row) throw new Error('createDraft: insert returning() yielded no row');
      return toOfferDto(row);
    });
  }

  async updateDraft(
    ctx: CallerCtx,
    offerId: string,
    input: UpdateTierOfferPayload,
  ): Promise<TierOfferDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)),
      });
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });
      }
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: `Cannot edit an offer in '${existing.status}' state. Only drafts may be updated.`,
        });
      }
      const patch: Partial<typeof tierOffers.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
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
      const [row] = await tx
        .update(tierOffers)
        .set(patch)
        .where(and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)))
        .returning();
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });
      return toOfferDto(row);
    });
  }

  async softDeleteDraft(ctx: CallerCtx, offerId: string): Promise<void> {
    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)),
      });
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });
      }
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: `Cannot delete an offer in '${existing.status}' state. Use cancel for sent offers.`,
        });
      }
      await tx.update(tierOffers).set({ deletedAt: new Date() }).where(eq(tierOffers.id, offerId));
    });
  }

  async addRecipient(
    ctx: CallerCtx,
    offerId: string,
    input: CreateTierOfferRecipientPayload,
  ): Promise<TierOfferRecipientDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await tx.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)),
      });
      if (!offer) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });
      }
      if (offer.status !== 'draft') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: `Recipients can only be added to a draft offer (was '${offer.status}').`,
        });
      }
      // Stage a placeholder magic-link token; we'll re-mint it at send time
      // because the recipient id needs to be in the JWT and we don't have
      // it until the row lands. The pending_send status flag means it's
      // never queryable as an active token.
      const id = uuidv7();
      const placeholderToken = `pending-send:${id}`;
      const placeholderExpires = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000);
      const [row] = await tx
        .insert(tierOfferRecipients)
        .values({
          id,
          tenantId: ctx.tenantId,
          offerId,
          accountId: input.accountId ?? null,
          recipientName: input.recipientName,
          recipientRole: input.recipientRole ?? null,
          recipientEmail: input.recipientEmail.toLowerCase(),
          recipientPhone: input.recipientPhone ?? null,
          magicLinkToken: placeholderToken,
          magicLinkExpiresAt: placeholderExpires,
          status: 'pending_send',
          notes: input.notes ?? null,
        })
        .returning();
      if (!row) throw new Error('addRecipient: insert returning() yielded no row');
      return toRecipientDto(row);
    });
  }

  async updateRecipient(
    ctx: CallerCtx,
    recipientId: string,
    input: UpdateTierOfferRecipientPayload,
  ): Promise<TierOfferRecipientDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.tierOfferRecipients.findFirst({
        where: and(eq(tierOfferRecipients.id, recipientId), isNull(tierOfferRecipients.deletedAt)),
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Recipient not found',
        });
      }
      const patch: Partial<typeof tierOfferRecipients.$inferInsert> & {
        updatedAt: Date;
      } = { updatedAt: new Date() };
      if (input.accountId !== undefined) patch.accountId = input.accountId ?? null;
      if (input.recipientName !== undefined) patch.recipientName = input.recipientName;
      if (input.recipientRole !== undefined) patch.recipientRole = input.recipientRole ?? null;
      if (input.recipientEmail !== undefined)
        patch.recipientEmail = input.recipientEmail.toLowerCase();
      if (input.recipientPhone !== undefined) patch.recipientPhone = input.recipientPhone ?? null;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      if (input.declineReason !== undefined) patch.declineReason = input.declineReason ?? null;
      const [row] = await tx
        .update(tierOfferRecipients)
        .set(patch)
        .where(eq(tierOfferRecipients.id, recipientId))
        .returning();
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recipient not found' });
      return toRecipientDto(row);
    });
  }

  async removeRecipient(ctx: CallerCtx, recipientId: string): Promise<void> {
    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.tierOfferRecipients.findFirst({
        where: and(eq(tierOfferRecipients.id, recipientId), isNull(tierOfferRecipients.deletedAt)),
      });
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recipient not found' });
      }
      const offer = await tx.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, existing.offerId), isNull(tierOffers.deletedAt)),
      });
      if (offer && offer.status !== 'draft') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'Recipients can only be removed from a draft offer.',
        });
      }
      await tx
        .update(tierOfferRecipients)
        .set({ deletedAt: new Date() })
        .where(eq(tierOfferRecipients.id, recipientId));
    });
  }

  // -----------------------------------------------------------------
  // Send + cancel
  // -----------------------------------------------------------------

  /**
   * Send a draft offer to its recipient roster. Idempotent: if the offer
   * is already in 'sent' state we do not re-dispatch the emails; we just
   * return the existing roster with `alreadySent: true`. This protects
   * against double-clicking Send and against a retried request that races
   * the original.
   */
  async send(
    ctx: CallerCtx,
    offerId: string,
  ): Promise<{
    offer: TierOfferDto;
    recipients: TierOfferRecipientDto[];
    alreadySent: boolean;
    dispatchedCount: number;
  }> {
    // Phase 1 — read offer, recipients, tier, tenant, and operator user
    // inside the tenant tx; mint magic links; flip statuses. Email send
    // is performed outside the tx so a slow SendGrid retry doesn't hold a
    // pg connection open.
    const prepared = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await tx.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)),
      });
      if (!offer) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });
      }
      if (
        offer.status === 'sent' ||
        offer.status === 'event_active' ||
        offer.status === 'event_concluded'
      ) {
        const recipients = await tx.query.tierOfferRecipients.findMany({
          where: and(
            eq(tierOfferRecipients.offerId, offerId),
            isNull(tierOfferRecipients.deletedAt),
          ),
        });
        return {
          alreadySent: true as const,
          offer,
          recipients,
          tier: null as null | typeof dynamicPricingTiers.$inferSelect,
          tenant: null as null | typeof tenants.$inferSelect,
          composedBy: null as null | typeof users.$inferSelect,
          mintingResults: [] as { recipientId: string; token: string; expiresAt: Date }[],
        };
      }
      if (offer.status !== 'draft') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: `Cannot send an offer in '${offer.status}' state.`,
        });
      }
      const tier = await tx.query.dynamicPricingTiers.findFirst({
        where: eq(dynamicPricingTiers.id, offer.tierId),
      });
      if (!tier) {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'The tier referenced by this offer no longer exists.',
        });
      }
      const tenant = await tx.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenantId),
      });
      if (!tenant) {
        // Should never happen — RLS would have already short-circuited.
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'Tenant lookup failed during send.',
        });
      }
      const composedBy = offer.composedBy
        ? await tx.query.users.findFirst({ where: eq(users.id, offer.composedBy) })
        : null;
      const recipients = await tx.query.tierOfferRecipients.findMany({
        where: and(eq(tierOfferRecipients.offerId, offerId), isNull(tierOfferRecipients.deletedAt)),
      });
      if (recipients.length === 0) {
        throw new BadRequestException({
          code: 'INVALID_STATE',
          message: 'Cannot send an offer with no recipients. Add at least one recipient first.',
        });
      }
      const now = new Date();
      const sentAt = now;
      const mintingResults: { recipientId: string; token: string; expiresAt: Date }[] = [];
      for (const r of recipients) {
        const { token, expiresAt } = await signMagicLink(
          { recipientId: r.id, offerId: offer.id, tenantId: ctx.tenantId },
          MAGIC_LINK_TTL_SECONDS,
          this.config.config.JWT_SECRET,
        );
        await tx
          .update(tierOfferRecipients)
          .set({
            magicLinkToken: token,
            magicLinkExpiresAt: expiresAt,
            status: 'sent',
            emailSentAt: sentAt,
            updatedAt: now,
          })
          .where(eq(tierOfferRecipients.id, r.id));
        mintingResults.push({ recipientId: r.id, token, expiresAt });
      }
      // Flip the offer to sent; auto-expiry cron (Session 4) will move
      // it on to event_active and event_concluded as time advances.
      const [updatedOffer] = await tx
        .update(tierOffers)
        .set({ status: 'sent', sentAt, updatedAt: now })
        .where(eq(tierOffers.id, offerId))
        .returning();
      if (!updatedOffer) throw new Error('send: update returning() yielded no row');
      const updatedRecipients = await tx.query.tierOfferRecipients.findMany({
        where: and(eq(tierOfferRecipients.offerId, offerId), isNull(tierOfferRecipients.deletedAt)),
      });
      return {
        alreadySent: false as const,
        offer: updatedOffer,
        recipients: updatedRecipients,
        tier,
        tenant,
        composedBy,
        mintingResults,
      };
    });

    // Phase 2 — dispatch the per-recipient emails. Outside the tx so the
    // pg connection is released; logged-and-counted so a partial-send
    // event is investigable. Failures are logged but do not roll back
    // the recipient row's state — the row already shows status=sent,
    // and the SendGrid bounce/dropped webhook (Session 4) will flip it
    // to bounced if delivery actually failed.
    if (prepared.alreadySent || !prepared.tier || !prepared.tenant) {
      return {
        offer: toOfferDto(prepared.offer),
        recipients: prepared.recipients.map(toRecipientDto),
        alreadySent: prepared.alreadySent,
        dispatchedCount: 0,
      };
    }
    const dispatchedCount = await this.dispatchEmailsForOffer({
      offer: prepared.offer,
      tenantName: prepared.tenant.name,
      tierName: prepared.tier.name,
      operatorName: prepared.composedBy
        ? `${prepared.composedBy.firstName} ${prepared.composedBy.lastName}`.trim() ||
          prepared.tenant.name
        : prepared.tenant.name,
      recipients: prepared.recipients,
      mintingResults: prepared.mintingResults,
    });
    return {
      offer: toOfferDto(prepared.offer),
      recipients: prepared.recipients.map(toRecipientDto),
      alreadySent: false,
      dispatchedCount,
    };
  }

  async cancel(ctx: CallerCtx, offerId: string, reason: string | null): Promise<TierOfferDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)),
      });
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });
      }
      if (existing.status === 'cancelled') {
        return toOfferDto(existing);
      }
      if (existing.status === 'event_concluded') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'A concluded offer cannot be cancelled.',
        });
      }
      const now = new Date();
      const [updated] = await tx
        .update(tierOffers)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledReason: reason,
          updatedAt: now,
        })
        .where(eq(tierOffers.id, offerId))
        .returning();
      if (!updated) throw new Error('cancel: update returning() yielded no row');
      // Revoke any recipients still in flight. Already-accepted /
      // already-declined recipients are NOT regressed — their response
      // remains the contractual record.
      // SQL-level UPDATE with a status whitelist so we do this in one
      // round trip; rows already in 'accepted', 'declined', 'expired',
      // 'revoked', or 'bounced' are excluded by the inArray clause.
      await tx
        .update(tierOfferRecipients)
        .set({ status: 'revoked', updatedAt: now })
        .where(
          and(
            eq(tierOfferRecipients.offerId, offerId),
            inArray(tierOfferRecipients.status, ['pending_send', 'sent', 'delivered', 'opened']),
          ),
        );
      return toOfferDto(updated);
    });
  }

  // -----------------------------------------------------------------
  // Public, token-based: read + accept + decline
  // -----------------------------------------------------------------

  async getTokenPayload(token: string): Promise<{
    offer: typeof tierOffers.$inferSelect;
    recipient: typeof tierOfferRecipients.$inferSelect;
    tenant: typeof tenants.$inferSelect;
  } | null> {
    const payload = await verifyMagicLink(token, this.config.config.JWT_SECRET);
    if (!payload) return null;
    return this.admin.runAsAdmin({}, async (db) => {
      const recipient = await db.query.tierOfferRecipients.findFirst({
        where: and(
          eq(tierOfferRecipients.id, payload.recipientId),
          isNull(tierOfferRecipients.deletedAt),
        ),
      });
      if (!recipient || recipient.tenantId !== payload.tenantId) return null;
      // We must verify the token row still has THIS exact token. Otherwise
      // an attacker who captured an older token (post-cancel re-send, etc.)
      // could keep using it. Token-rotation isn't planned for v1, but this
      // future-proofs the check.
      if (recipient.magicLinkToken !== token) return null;
      const offer = await db.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, payload.offerId), isNull(tierOffers.deletedAt)),
      });
      if (!offer || offer.tenantId !== payload.tenantId) return null;
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, payload.tenantId),
      });
      if (!tenant) return null;
      return { offer, recipient, tenant };
    });
  }

  async acceptByToken(args: {
    token: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ status: 'accepted' | 'declined' | 'revoked' | 'cancelled' | 'expired' }> {
    const payload = await verifyMagicLink(args.token, this.config.config.JWT_SECRET);
    if (!payload) throw badRequestExpired();
    return this.admin.runAsAdmin({}, async (db) => {
      const recipient = await db.query.tierOfferRecipients.findFirst({
        where: and(
          eq(tierOfferRecipients.id, payload.recipientId),
          isNull(tierOfferRecipients.deletedAt),
        ),
      });
      if (!recipient || recipient.tenantId !== payload.tenantId)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recipient not found' });
      if (recipient.magicLinkToken !== args.token) throw badRequestExpired();
      const offer = await db.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, payload.offerId), isNull(tierOffers.deletedAt)),
      });
      if (!offer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });

      if (offer.status === 'cancelled') return { status: 'cancelled' as const };
      if (recipient.status === 'revoked') return { status: 'revoked' as const };
      if (recipient.status === 'expired') return { status: 'expired' as const };
      // Idempotent: re-clicking accept is a no-op success.
      if (recipient.status === 'accepted') return { status: 'accepted' as const };
      if (recipient.status === 'declined') return { status: 'declined' as const };

      const now = new Date();
      await db
        .update(tierOfferRecipients)
        .set({
          status: 'accepted',
          respondedAt: now,
          responseIp: args.ipAddress,
          responseUserAgent: args.userAgent,
          // Clicking the accept button is itself proof of open, in case
          // SendGrid's open pixel was blocked. First open wins.
          emailOpenedAt: recipient.emailOpenedAt ?? now,
          updatedAt: now,
        })
        .where(eq(tierOfferRecipients.id, recipient.id));
      this.log.log({
        msg: 'tier-offer accepted',
        tenantId: recipient.tenantId,
        offerId: offer.id,
        recipientId: recipient.id,
        ip: args.ipAddress,
      });
      return { status: 'accepted' as const };
    });
  }

  async declineByToken(args: {
    token: string;
    ipAddress: string | null;
    userAgent: string | null;
    reason: string | null;
  }): Promise<{ status: 'accepted' | 'declined' | 'revoked' | 'cancelled' | 'expired' }> {
    const payload = await verifyMagicLink(args.token, this.config.config.JWT_SECRET);
    if (!payload) throw badRequestExpired();
    return this.admin.runAsAdmin({}, async (db) => {
      const recipient = await db.query.tierOfferRecipients.findFirst({
        where: and(
          eq(tierOfferRecipients.id, payload.recipientId),
          isNull(tierOfferRecipients.deletedAt),
        ),
      });
      if (!recipient || recipient.tenantId !== payload.tenantId)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recipient not found' });
      if (recipient.magicLinkToken !== args.token) throw badRequestExpired();
      const offer = await db.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, payload.offerId), isNull(tierOffers.deletedAt)),
      });
      if (!offer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });

      if (offer.status === 'cancelled') return { status: 'cancelled' as const };
      if (recipient.status === 'revoked') return { status: 'revoked' as const };
      if (recipient.status === 'expired') return { status: 'expired' as const };
      if (recipient.status === 'declined') return { status: 'declined' as const };
      if (recipient.status === 'accepted') return { status: 'accepted' as const };

      const now = new Date();
      await db
        .update(tierOfferRecipients)
        .set({
          status: 'declined',
          respondedAt: now,
          responseIp: args.ipAddress,
          responseUserAgent: args.userAgent,
          declineReason: args.reason,
          emailOpenedAt: recipient.emailOpenedAt ?? now,
          updatedAt: now,
        })
        .where(eq(tierOfferRecipients.id, recipient.id));
      this.log.log({
        msg: 'tier-offer declined',
        tenantId: recipient.tenantId,
        offerId: offer.id,
        recipientId: recipient.id,
        ip: args.ipAddress,
        reason: args.reason,
      });
      return { status: 'declined' as const };
    });
  }

  // -----------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------

  private async dispatchEmailsForOffer(args: {
    offer: typeof tierOffers.$inferSelect;
    tenantName: string;
    tierName: string;
    operatorName: string;
    recipients: (typeof tierOfferRecipients.$inferSelect)[];
    mintingResults: { recipientId: string; token: string; expiresAt: Date }[];
  }): Promise<number> {
    const tokenById = new Map(args.mintingResults.map((m) => [m.recipientId, m]));
    const webBase = this.config.webPublicUrl;
    const fmt = (d: Date | string | null | undefined): string => {
      if (!d) return 'TBD';
      const date = d instanceof Date ? d : new Date(d);
      // Locale-friendly formatting; UTC suffix to avoid ambiguity in
      // motor-club inboxes that span time zones.
      return `${date.toUTCString()}`;
    };
    const defaultHuman =
      args.offer.defaultForNonResponders === 'opt_out'
        ? 'opt out (no premium dispatches accepted)'
        : 'accept dispatches at the standard rate (no premium)';
    let dispatched = 0;
    for (const r of args.recipients) {
      const minted = tokenById.get(r.id);
      if (!minted) continue;
      const acceptUrl = `${webBase}/offers/${minted.token}?action=accept`;
      const declineUrl = `${webBase}/offers/${minted.token}?action=decline`;
      try {
        await this.email.sendTierOfferInvitationEmail({
          to: r.recipientEmail,
          subjectLine: args.offer.subjectLine,
          operatorName: args.operatorName,
          title: args.offer.title,
          narrative: args.offer.narrative,
          recipientName: r.recipientName,
          recipientRole: r.recipientRole,
          tierName: args.tierName,
          committedTruckCount: args.offer.committedTruckCount,
          eventWindowStartFormatted: fmt(args.offer.eventWindowStart),
          eventWindowEndFormatted: fmt(args.offer.eventWindowEnd),
          acceptanceDeadlineFormatted: fmt(args.offer.acceptanceDeadlineAt),
          defaultForNonRespondersHuman: defaultHuman,
          acceptUrl,
          declineUrl,
          magicLinkExpiresFormatted: fmt(minted.expiresAt),
        });
        dispatched++;
      } catch (err) {
        this.log.error({
          msg: 'tier-offer email dispatch failed',
          tenantId: r.tenantId,
          offerId: r.offerId,
          recipientId: r.id,
          err: (err as Error).message,
        });
        // Do not throw — the row is already in `sent` status with a
        // valid token. The SendGrid webhook handler in Session 4 will
        // catch the bounce. Logging is enough for now.
      }
    }
    return dispatched;
  }

  private toTenantCtx(ctx: CallerCtx): { tenantId: string; userId: string; requestId: string } {
    return { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId };
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function badRequestExpired(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_TOKEN',
    message: 'This offer link is invalid, expired, or has been revoked.',
  });
}

function toOfferDto(row: typeof tierOffers.$inferSelect): TierOfferDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tierId: row.tierId,
    composedBy: row.composedBy,
    title: row.title,
    subjectLine: row.subjectLine,
    narrative: row.narrative,
    eventWindowStart: row.eventWindowStart.toISOString(),
    eventWindowEnd: row.eventWindowEnd.toISOString(),
    committedTruckCount: row.committedTruckCount,
    acceptanceDeadlineAt: row.acceptanceDeadlineAt.toISOString(),
    defaultForNonResponders: row.defaultForNonResponders,
    status: row.status,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledReason: row.cancelledReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toRecipientDto(row: typeof tierOfferRecipients.$inferSelect): TierOfferRecipientDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    offerId: row.offerId,
    accountId: row.accountId,
    recipientName: row.recipientName,
    recipientRole: row.recipientRole,
    recipientEmail: row.recipientEmail,
    recipientPhone: row.recipientPhone,
    magicLinkToken: row.magicLinkToken,
    magicLinkExpiresAt: row.magicLinkExpiresAt.toISOString(),
    status: row.status,
    emailSentAt: row.emailSentAt ? row.emailSentAt.toISOString() : null,
    emailDeliveredAt: row.emailDeliveredAt ? row.emailDeliveredAt.toISOString() : null,
    emailOpenedAt: row.emailOpenedAt ? row.emailOpenedAt.toISOString() : null,
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    responseIp: row.responseIp,
    responseUserAgent: row.responseUserAgent,
    declineReason: row.declineReason,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
