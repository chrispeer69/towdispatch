/**
 * TierOfferRecipientService — the per-recipient acceptance ledger.
 *
 * Two surfaces:
 *
 *   Operator (tenant-scoped, called by the admin controller):
 *     - addRecipient        — append to an offer's roster, mint a token
 *     - updateRecipient     — correct contact details / notes pre-send
 *     - revokeRecipient     — kill a recipient's link
 *     - markManualResponse  — log an accept/decline taken over the phone
 *
 *   Public (token-resolved, called by the magic-link landing page; NO
 *   tenant context on the wire):
 *     - resolvePublicView   — render the offer to the recipient
 *     - acceptByToken       — recipient accepts
 *     - declineByToken      — recipient declines
 *
 * The public path mirrors PaymentsService: the opaque token is the unit of
 * authorization. We verify the HMAC signature locally, look the recipient
 * up via the ADMIN pool (RLS would hide it — there's no tenant GUC yet) to
 * learn its tenant, then drop into a tenant-scoped transaction so every
 * subsequent read/write is RLS-enforced and audit-trailed.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { tenants, tierOfferRecipients, uuidv7 } from '@ustowdispatch/db';
import {
  type CreateTierOfferRecipientPayload,
  ERROR_CODES,
  type TierOfferRecipientDto,
  type UpdateTierOfferRecipientPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import type { CallerCtx } from './tier-offer-composer.service.js';
import { toTierOfferRecipientDto } from './tier-offer-mappers.js';
import { canRecipientRespond, isRecipientRevocable } from './tier-offer-state.js';
import { TierOfferTokenService } from './tier-offer-token.service.js';
import { TierOfferRepository } from './tier-offer.repository.js';
import type {
  MarkRecipientResponsePayload,
  PublicTierOfferResponseResult,
  PublicTierOfferView,
} from './tier-offers.dtos.js';

const SYSTEM_USER_UUID = '00000000-0000-0000-0000-000000000000';

interface PublicResponseContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class TierOfferRecipientService {
  private readonly log = new Logger(TierOfferRecipientService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly repo: TierOfferRepository,
    private readonly tokens: TierOfferTokenService,
  ) {}

  // =====================================================================
  // Operator surface
  // =====================================================================

  async listForOffer(ctx: CallerCtx, offerId: string): Promise<TierOfferRecipientDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      await this.requireOffer(tx, offerId);
      const rows = await this.repo.listRecipientsForOffer(tx, offerId);
      return rows.map(toTierOfferRecipientDto);
    });
  }

  async addRecipient(
    ctx: CallerCtx,
    input: CreateTierOfferRecipientPayload,
  ): Promise<TierOfferRecipientDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await this.requireOffer(tx, input.offerId);
      // Roster edits are only meaningful while the offer can still be sent
      // or is in flight. Concluded/cancelled offers are frozen.
      if (offer.status === 'event_concluded' || offer.status === 'cancelled') {
        throw new ConflictException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: `Cannot add recipients to a ${offer.status} offer`,
        });
      }

      const recipientId = uuidv7();
      const minted = this.tokens.mint(recipientId, offer.acceptanceDeadlineAt);
      // If the offer was already sent, a freshly added recipient should
      // be live immediately; otherwise it waits in pending_send until the
      // operator sends the offer.
      const status = offer.status === 'draft' ? 'pending_send' : 'sent';

      const row = await this.repo.insertRecipient(tx, {
        id: recipientId,
        tenantId: ctx.tenantId,
        offerId: input.offerId,
        accountId: input.accountId ?? null,
        recipientName: input.recipientName,
        recipientRole: input.recipientRole ?? null,
        recipientEmail: input.recipientEmail,
        recipientPhone: input.recipientPhone ?? null,
        magicLinkToken: minted.token,
        magicLinkExpiresAt: minted.expiresAt,
        status,
        notes: input.notes ?? null,
      });
      return toTierOfferRecipientDto(row);
    });
  }

  async updateRecipient(
    ctx: CallerCtx,
    recipientId: string,
    input: UpdateTierOfferRecipientPayload,
  ): Promise<TierOfferRecipientDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const recipient = await this.requireRecipient(tx, recipientId);
      if (isRecipientRevocableTerminalGuard(recipient.status)) {
        throw new ConflictException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: `Cannot edit a recipient in terminal state "${recipient.status}"`,
        });
      }

      const patch: Record<string, unknown> = {};
      if (input.accountId !== undefined) patch.accountId = input.accountId ?? null;
      if (input.recipientName !== undefined) patch.recipientName = input.recipientName;
      if (input.recipientRole !== undefined) patch.recipientRole = input.recipientRole ?? null;
      if (input.recipientEmail !== undefined) patch.recipientEmail = input.recipientEmail;
      if (input.recipientPhone !== undefined) patch.recipientPhone = input.recipientPhone ?? null;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      if (input.declineReason !== undefined) patch.declineReason = input.declineReason ?? null;

      const updated = await this.repo.updateRecipient(tx, recipientId, patch);
      if (!updated) throw this.recipientNotFound();
      return toTierOfferRecipientDto(updated);
    });
  }

  async revokeRecipient(ctx: CallerCtx, recipientId: string): Promise<TierOfferRecipientDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const recipient = await this.requireRecipient(tx, recipientId);
      if (!isRecipientRevocable(recipient.status)) {
        throw new ConflictException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: `Cannot revoke a recipient in terminal state "${recipient.status}"`,
        });
      }
      const updated = await this.repo.updateRecipient(tx, recipientId, { status: 'revoked' });
      if (!updated) throw this.recipientNotFound();
      return toTierOfferRecipientDto(updated);
    });
  }

  /**
   * Operator records an accept/decline taken over the phone. Same state
   * guard as the public path — only an in-flight recipient can be resolved.
   */
  async markManualResponse(
    ctx: CallerCtx,
    recipientId: string,
    input: MarkRecipientResponsePayload,
  ): Promise<TierOfferRecipientDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const recipient = await this.requireRecipient(tx, recipientId);
      if (!canRecipientRespond(recipient.status)) {
        throw new ConflictException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: `Recipient in state "${recipient.status}" can no longer respond`,
        });
      }
      const now = new Date();
      const patch: Record<string, unknown> = {
        status: input.decision,
        respondedAt: now,
      };
      if (input.decision === 'declined' && input.declineReason)
        patch.declineReason = input.declineReason;
      if (input.notes) patch.notes = input.notes;

      const updated = await this.repo.updateRecipient(tx, recipientId, patch);
      if (!updated) throw this.recipientNotFound();
      return toTierOfferRecipientDto(updated);
    });
  }

  // =====================================================================
  // Public surface (token-resolved)
  // =====================================================================

  /**
   * Resolve a magic-link token to (tenantId, recipientId). Verifies the
   * HMAC + expiry locally, then confirms the recipient row exists and its
   * stored token matches byte-for-byte (defense in depth). Uses the ADMIN
   * pool because no tenant GUC is set yet — RLS would hide the row.
   */
  private async resolveToken(
    token: string,
  ): Promise<{ tenantId: string; recipientId: string } | null> {
    const verified = this.tokens.verify(token);
    if (!verified) return null;
    return this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.tierOfferRecipients.findFirst({
        where: and(
          eq(tierOfferRecipients.id, verified.recipientId),
          eq(tierOfferRecipients.magicLinkToken, token),
          isNull(tierOfferRecipients.deletedAt),
        ),
      });
      if (!row) return null;
      return { tenantId: row.tenantId, recipientId: row.id };
    });
  }

  async resolvePublicView(token: string): Promise<PublicTierOfferView> {
    const resolved = await this.resolveToken(token);
    if (!resolved) throw this.invalidLink();
    return this.db.runInTenantContext(
      { tenantId: resolved.tenantId, userId: SYSTEM_USER_UUID, requestId: 'tier-offer-public' },
      async (tx) => {
        const recipient = await this.repo.findRecipient(tx, resolved.recipientId);
        if (!recipient) throw this.invalidLink();
        const offer = await this.repo.findOffer(tx, recipient.offerId);
        if (!offer) throw this.invalidLink();
        const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, offer.tenantId) });
        return {
          offer: {
            title: offer.title,
            subjectLine: offer.subjectLine,
            narrative: offer.narrative,
            eventWindowStart: offer.eventWindowStart.toISOString(),
            eventWindowEnd: offer.eventWindowEnd.toISOString(),
            committedTruckCount: offer.committedTruckCount,
            acceptanceDeadlineAt: offer.acceptanceDeadlineAt.toISOString(),
            defaultForNonResponders: offer.defaultForNonResponders,
            status: offer.status,
          },
          recipient: {
            recipientName: recipient.recipientName,
            recipientEmail: recipient.recipientEmail,
            status: recipient.status,
            magicLinkExpiresAt: recipient.magicLinkExpiresAt.toISOString(),
            respondedAt: recipient.respondedAt ? recipient.respondedAt.toISOString() : null,
          },
          tenantName: tenant?.name ?? 'US Tow DISPATCH',
        };
      },
    );
  }

  async acceptByToken(
    token: string,
    confirmName: string,
    reqCtx: PublicResponseContext,
  ): Promise<PublicTierOfferResponseResult> {
    return this.respondByToken(token, 'accepted', { confirmName }, reqCtx);
  }

  async declineByToken(
    token: string,
    reason: string,
    reqCtx: PublicResponseContext,
  ): Promise<PublicTierOfferResponseResult> {
    return this.respondByToken(token, 'declined', { reason }, reqCtx);
  }

  private async respondByToken(
    token: string,
    decision: 'accepted' | 'declined',
    detail: { confirmName?: string; reason?: string },
    reqCtx: PublicResponseContext,
  ): Promise<PublicTierOfferResponseResult> {
    const resolved = await this.resolveToken(token);
    if (!resolved) throw this.invalidLink();

    return this.db.runInTenantContext(
      {
        tenantId: resolved.tenantId,
        userId: SYSTEM_USER_UUID,
        requestId: `tier-offer-public-${decision}`,
        ipAddress: reqCtx.ipAddress ?? undefined,
        userAgent: reqCtx.userAgent ?? undefined,
      },
      async (tx) => {
        const recipient = await this.repo.findRecipient(tx, resolved.recipientId);
        if (!recipient) throw this.invalidLink();

        // Idempotent: a recipient who already gave the same answer just
        // sees the confirmation again rather than a 409. A *different*
        // answer after responding is rejected — the first response binds.
        if (recipient.status === decision) {
          return {
            status: decision,
            respondedAt: (recipient.respondedAt ?? recipient.updatedAt).toISOString(),
          };
        }
        if (!canRecipientRespond(recipient.status)) {
          throw new ConflictException({
            code: ERROR_CODES.INVALID_STATE_TRANSITION,
            message:
              recipient.status === 'expired'
                ? 'This offer is no longer accepting responses'
                : `This offer can no longer be ${decision} (current state: ${recipient.status})`,
          });
        }

        const offer = await this.repo.findOffer(tx, recipient.offerId);
        if (!offer) throw this.invalidLink();
        if (offer.status === 'cancelled') {
          throw new ConflictException({
            code: ERROR_CODES.INVALID_STATE_TRANSITION,
            message: 'This offer has been withdrawn',
          });
        }

        const now = new Date();
        const patch: Record<string, unknown> = {
          status: decision,
          respondedAt: now,
          responseIp: reqCtx.ipAddress ?? null,
          responseUserAgent: reqCtx.userAgent ?? null,
        };
        if (decision === 'declined' && detail.reason) patch.declineReason = detail.reason;
        if (decision === 'accepted' && detail.confirmName)
          patch.notes = appendConfirmation(recipient.notes, detail.confirmName, now);

        await this.repo.updateRecipient(tx, recipient.id, patch);
        this.log.log(
          `tier-offer recipient ${recipient.id} ${decision} for tenant ${resolved.tenantId}`,
        );
        return { status: decision, respondedAt: now.toISOString() };
      },
    );
  }

  // ---------- internals ----------

  private async requireOffer(tx: Tx, offerId: string) {
    const offer = await this.repo.findOffer(tx, offerId);
    if (!offer)
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Tier offer not found' });
    return offer;
  }

  private async requireRecipient(tx: Tx, recipientId: string) {
    const recipient = await this.repo.findRecipient(tx, recipientId);
    if (!recipient) throw this.recipientNotFound();
    return recipient;
  }

  private recipientNotFound(): NotFoundException {
    return new NotFoundException({
      code: ERROR_CODES.NOT_FOUND,
      message: 'Tier offer recipient not found',
    });
  }

  private invalidLink(): ForbiddenException {
    // Same opaque error for unknown / tampered / expired token so we don't
    // leak which failure occurred.
    return new ForbiddenException({
      code: ERROR_CODES.TOKEN_INVALID,
      message: 'This link is invalid or has expired',
    });
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

function isRecipientRevocableTerminalGuard(status: TierOfferRecipientDto['status']): boolean {
  // Editing is blocked once a recipient is in any terminal state.
  return !isRecipientRevocable(status);
}

function appendConfirmation(existing: string | null, confirmName: string, at: Date): string {
  const line = `[${at.toISOString()}] Accepted online by "${confirmName}"`;
  return existing ? `${existing}\n${line}` : line;
}
