/**
 * AuctionService — Auction & Remarketing Marketplace (Session 33).
 *
 * Owns both surfaces of the per-tenant remarketing marketplace:
 *   - staff (operator) : create / publish / withdraw / end / award listings,
 *                        read bids, list lien-cleared vehicles eligible to
 *                        list, and the staff reports.
 *   - bidder / public  : place a bid (race-guarded + anti-snipe), browse
 *                        live listings, and read a bidder's own bids.
 *
 * Staff + bidder writes run inside `runInTenantContext` so RLS isolates
 * tenants and the audit trigger captures the actor. Public reads (the
 * unauthenticated marketplace browse) use the admin pool with an EXPLICIT
 * `tenant_id = $resolved` filter — the same deliberate cross-tenant seam
 * the impound accrual cron uses — because there is no bidder/staff token to
 * establish a tenant context for an anonymous browser.
 *
 * All decision logic (bid validation, anti-snipe, close outcome) lives in
 * the pure helpers in auction-bid.logic.ts; this service is data access +
 * transaction boundaries + notifications.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type AuctionBid,
  type AuctionBidder,
  type AuctionListing,
  type AuctionListingPhoto,
  auctionBidders,
  auctionBids,
  auctionListingPhotos,
  auctionListings,
  impoundRecords,
  tenants,
  users,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  AuctionBidDto,
  AuctionBidWithBidder,
  AuctionBidderDto,
  AuctionEligibleVehicleDto,
  AuctionListingDetailDto,
  AuctionListingDto,
  AuctionListingPhotoDto,
  AwardAuctionListingPayload,
  CreateAuctionListingPayload,
  ListAuctionListingsFilter,
  PublicAuctionListingDto,
  PublishAuctionListingPayload,
  UpdateAuctionListingPayload,
} from '@ustowdispatch/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { EmailService } from '../email/email.service.js';
import { computeAntiSnipeExtension, evaluateClose, validateBid } from './auction-bid.logic.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

/** Identity of a bidder placing a bid (from the bidder JWT). */
export interface BidderCtx {
  tenantId: string;
  bidderId: string;
  requestId?: string | undefined;
  ipAddress?: string | undefined;
}

const ACTIVE_LISTING_STATUSES = ['draft', 'live', 'ended', 'sold'] as const;
const INELIGIBLE_IMPOUND_STATUSES = ['released', 'transferred', 'disposed'] as const;

@Injectable()
export class AuctionService {
  private readonly log = new Logger(AuctionService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly email: EmailService,
  ) {}

  // ===================================================================
  // Staff — listings
  // ===================================================================

  async listListings(
    ctx: CallerCtx,
    filter: ListAuctionListingsFilter,
  ): Promise<AuctionListingDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [isNull(auctionListings.deletedAt)];
      if (filter.status) clauses.push(eq(auctionListings.status, filter.status));
      if (filter.from) clauses.push(gte(auctionListings.createdAt, new Date(filter.from)));
      if (filter.to) clauses.push(lte(auctionListings.createdAt, new Date(filter.to)));
      const rows = await tx.query.auctionListings.findMany({
        where: and(...clauses),
        orderBy: (t, { desc: d }) => [d(t.createdAt)],
      });
      return rows.map(toListingDto);
    });
  }

  async getListingDetail(ctx: CallerCtx, id: string): Promise<AuctionListingDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const listing = await tx.query.auctionListings.findFirst({
        where: and(eq(auctionListings.id, id), isNull(auctionListings.deletedAt)),
      });
      if (!listing) throw notFound('Listing not found');
      return this.composeDetail(tx, listing);
    });
  }

  /**
   * Vehicles eligible to be listed: lien-cleared impound records not yet
   * released/transferred/disposed and not already on an active listing.
   *
   * Eligibility currently gates on impound_records.lien_eligible. When
   * Session 23 (lien_cases) merges, tighten to lien_cases.status='completed'
   * for the linked record — see 0038_auction_marketplace.sql.
   */
  async listEligibleVehicles(ctx: CallerCtx): Promise<AuctionEligibleVehicleDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const candidates = await tx.query.impoundRecords.findMany({
        where: and(eq(impoundRecords.lienEligible, true), isNull(impoundRecords.deletedAt)),
        orderBy: (t, { asc: a }) => [a(t.lienEligibleAt)],
      });
      const usable = candidates.filter(
        (r) =>
          !INELIGIBLE_IMPOUND_STATUSES.includes(
            r.status as (typeof INELIGIBLE_IMPOUND_STATUSES)[number],
          ),
      );
      if (usable.length === 0) return [];

      const listed = await tx.query.auctionListings.findMany({
        where: and(
          inArray(auctionListings.status, [...ACTIVE_LISTING_STATUSES]),
          isNull(auctionListings.deletedAt),
        ),
        columns: { impoundRecordId: true },
      });
      const usedIds = new Set(listed.map((l) => l.impoundRecordId).filter((x): x is string => !!x));

      return usable
        .filter((r) => !usedIds.has(r.id))
        .map((r) => ({
          impoundRecordId: r.id,
          vin: r.vehicleVin,
          vehicleYear: r.vehicleYear,
          make: r.vehicleMake,
          model: r.vehicleModel,
          licensePlate: r.licensePlate,
          accruedFeeCents: Number(r.accruedFeeCents),
          lienEligibleAt: r.lienEligibleAt ? r.lienEligibleAt.toISOString() : null,
        }));
    });
  }

  async createListing(
    ctx: CallerCtx,
    input: CreateAuctionListingPayload,
  ): Promise<AuctionListingDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      let seed: {
        vin: string | null;
        vehicleYear: number | null;
        make: string | null;
        model: string | null;
        mileage: number | null;
      } = { vin: null, vehicleYear: null, make: null, model: null, mileage: null };

      if (input.impoundRecordId) {
        const record = await tx.query.impoundRecords.findFirst({
          where: and(
            eq(impoundRecords.id, input.impoundRecordId),
            isNull(impoundRecords.deletedAt),
          ),
        });
        if (!record) throw notFound('Impound record not found in this tenant');
        if (!record.lienEligible) {
          throw new ConflictException({
            code: 'auction_ineligible',
            message: 'This impound record has not cleared lien processing.',
          });
        }
        if (
          INELIGIBLE_IMPOUND_STATUSES.includes(
            record.status as (typeof INELIGIBLE_IMPOUND_STATUSES)[number],
          )
        ) {
          throw new ConflictException({
            code: 'auction_ineligible',
            message: `Cannot list a record in status "${record.status}".`,
          });
        }
        const existing = await tx.query.auctionListings.findFirst({
          where: and(
            eq(auctionListings.impoundRecordId, input.impoundRecordId),
            inArray(auctionListings.status, [...ACTIVE_LISTING_STATUSES]),
            isNull(auctionListings.deletedAt),
          ),
        });
        if (existing) {
          throw new ConflictException({
            code: 'auction_ineligible',
            message: 'This vehicle is already on an active listing.',
          });
        }
        // Snapshot vehicle details from the impound record as defaults.
        seed = {
          vin: record.vehicleVin,
          vehicleYear: record.vehicleYear,
          make: record.vehicleMake,
          model: record.vehicleModel,
          mileage: record.intakeMileage,
        };
      }

      const id = uuidv7();
      const [row] = await tx
        .insert(auctionListings)
        .values({
          id,
          tenantId: ctx.tenantId,
          impoundRecordId: input.impoundRecordId ?? null,
          lienCaseId: input.lienCaseId ?? null,
          vin: input.vin ?? seed.vin,
          vehicleYear: input.vehicleYear ?? seed.vehicleYear,
          make: input.make ?? seed.make,
          model: input.model ?? seed.model,
          mileage: input.mileage ?? seed.mileage,
          conditionGrade: input.conditionGrade ?? null,
          reservePriceCents: input.reservePriceCents ?? null,
          startingBidCents: input.startingBidCents,
          listStartsAt: input.listStartsAt ? new Date(input.listStartsAt) : null,
          listEndsAt: input.listEndsAt ? new Date(input.listEndsAt) : null,
          status: 'draft',
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('createListing: insert returning() yielded no row');

      if (input.photoKeys.length > 0) {
        await tx.insert(auctionListingPhotos).values(
          input.photoKeys.map((key, idx) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            listingId: id,
            photoKey: key,
            sortOrder: idx,
          })),
        );
      }
      return toListingDto(row);
    });
  }

  async updateListing(
    ctx: CallerCtx,
    id: string,
    input: UpdateAuctionListingPayload,
  ): Promise<AuctionListingDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const listing = await tx.query.auctionListings.findFirst({
        where: and(eq(auctionListings.id, id), isNull(auctionListings.deletedAt)),
      });
      if (!listing) throw notFound('Listing not found');
      if (listing.status !== 'draft') {
        throw new ConflictException({
          code: 'invalid_state_transition',
          message: 'Only draft listings can be edited.',
        });
      }

      const patch: Partial<typeof auctionListings.$inferInsert> = {};
      if (input.vin !== undefined) patch.vin = input.vin;
      if (input.vehicleYear !== undefined) patch.vehicleYear = input.vehicleYear;
      if (input.make !== undefined) patch.make = input.make;
      if (input.model !== undefined) patch.model = input.model;
      if (input.mileage !== undefined) patch.mileage = input.mileage;
      if (input.conditionGrade !== undefined) patch.conditionGrade = input.conditionGrade;
      if (input.reservePriceCents !== undefined) patch.reservePriceCents = input.reservePriceCents;
      if (input.startingBidCents !== undefined) patch.startingBidCents = input.startingBidCents;
      if (input.listStartsAt !== undefined) patch.listStartsAt = new Date(input.listStartsAt);
      if (input.listEndsAt !== undefined) patch.listEndsAt = new Date(input.listEndsAt);

      const effectiveStart = patch.startingBidCents ?? listing.startingBidCents;
      const effectiveReserve = patch.reservePriceCents ?? listing.reservePriceCents ?? null;
      if (effectiveReserve !== null && effectiveReserve < effectiveStart) {
        throw new BadRequestException({
          code: 'bad_request',
          message: 'Reserve price must be at least the starting bid.',
        });
      }

      if (Object.keys(patch).length > 0) {
        await tx.update(auctionListings).set(patch).where(eq(auctionListings.id, id));
      }

      if (input.photoKeys !== undefined) {
        await tx
          .update(auctionListingPhotos)
          .set({ deletedAt: new Date() })
          .where(
            and(eq(auctionListingPhotos.listingId, id), isNull(auctionListingPhotos.deletedAt)),
          );
        if (input.photoKeys.length > 0) {
          await tx.insert(auctionListingPhotos).values(
            input.photoKeys.map((key, idx) => ({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              listingId: id,
              photoKey: key,
              sortOrder: idx,
            })),
          );
        }
      }

      const fresh = await tx.query.auctionListings.findFirst({
        where: eq(auctionListings.id, id),
      });
      return toListingDto(fresh as AuctionListing);
    });
  }

  async publishListing(
    ctx: CallerCtx,
    id: string,
    input: PublishAuctionListingPayload,
  ): Promise<AuctionListingDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const listing = await tx.query.auctionListings.findFirst({
        where: and(eq(auctionListings.id, id), isNull(auctionListings.deletedAt)),
      });
      if (!listing) throw notFound('Listing not found');
      if (listing.status !== 'draft') {
        throw new ConflictException({
          code: 'invalid_state_transition',
          message: 'Only draft listings can be published.',
        });
      }
      const startsAt = input.listStartsAt ? new Date(input.listStartsAt) : new Date();
      const endsAt = new Date(input.listEndsAt);
      if (endsAt.getTime() <= startsAt.getTime()) {
        throw new BadRequestException({
          code: 'bad_request',
          message: 'listEndsAt must be after listStartsAt.',
        });
      }
      const [row] = await tx
        .update(auctionListings)
        .set({ status: 'live', listStartsAt: startsAt, listEndsAt: endsAt })
        .where(eq(auctionListings.id, id))
        .returning();
      if (!row) throw notFound('Listing not found');
      return toListingDto(row);
    });
  }

  async withdrawListing(ctx: CallerCtx, id: string): Promise<AuctionListingDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const listing = await tx.query.auctionListings.findFirst({
        where: and(eq(auctionListings.id, id), isNull(auctionListings.deletedAt)),
      });
      if (!listing) throw notFound('Listing not found');
      if (listing.status !== 'draft' && listing.status !== 'live') {
        throw new ConflictException({
          code: 'invalid_state_transition',
          message: 'Only draft or live listings can be withdrawn.',
        });
      }
      const [row] = await tx
        .update(auctionListings)
        .set({ status: 'withdrawn' })
        .where(eq(auctionListings.id, id))
        .returning();
      if (!row) throw notFound('Listing not found');
      return toListingDto(row);
    });
  }

  /**
   * Close a live listing immediately (manual or cron). Awards the highest
   * bid when it clears reserve; otherwise ends unsold for manual review.
   * Returns the updated listing. Notifications are best-effort.
   */
  async endListing(ctx: CallerCtx, id: string): Promise<AuctionListingDto> {
    const { dto, notify } = await this.db.runInTenantContext(ctx, async (tx) =>
      this.closeLiveListing(tx, id, new Date()),
    );
    await this.flushCloseNotifications(notify);
    return dto;
  }

  /**
   * Manually award an ended listing to a specific bid (e.g. a reserve-not-met
   * negotiation concluded off-platform). Sets winning_bid_id + is_winning.
   */
  async awardWinner(
    ctx: CallerCtx,
    id: string,
    input: AwardAuctionListingPayload,
  ): Promise<AuctionListingDto> {
    const result = await this.db.runInTenantContext(ctx, async (tx) => {
      const listing = await tx.query.auctionListings.findFirst({
        where: and(eq(auctionListings.id, id), isNull(auctionListings.deletedAt)),
      });
      if (!listing) throw notFound('Listing not found');
      if (listing.status !== 'ended') {
        throw new ConflictException({
          code: 'invalid_state_transition',
          message: 'Only ended listings can be awarded manually.',
        });
      }
      const bid = await tx.query.auctionBids.findFirst({
        where: and(
          eq(auctionBids.id, input.bidId),
          eq(auctionBids.listingId, id),
          isNull(auctionBids.deletedAt),
        ),
      });
      if (!bid) throw notFound('Bid not found on this listing');

      await tx
        .update(auctionBids)
        .set({ isWinning: false })
        .where(and(eq(auctionBids.listingId, id), eq(auctionBids.isWinning, true)));
      await tx.update(auctionBids).set({ isWinning: true }).where(eq(auctionBids.id, bid.id));
      const [row] = await tx
        .update(auctionListings)
        .set({ status: 'sold', winningBidId: bid.id })
        .where(eq(auctionListings.id, id))
        .returning();
      if (!row) throw notFound('Listing not found');

      const winnerBidder = await tx.query.auctionBidders.findFirst({
        where: eq(auctionBidders.id, bid.bidderId),
      });
      return {
        dto: toListingDto(row),
        winnerBidder,
        amountCents: Number(bid.bidAmountCents),
        tenantSlug: await this.tenantSlug(tx, ctx.tenantId),
      };
    });

    if (result.winnerBidder) {
      await this.safeSend(() =>
        this.email.sendAuctionResultEmail({
          to: result.winnerBidder!.email,
          bidderName: result.winnerBidder!.name,
          listingLabel: listingLabel(result.dto),
          won: true,
          amountFormatted: formatCents(result.amountCents),
          listingUrl: this.listingUrl(result.tenantSlug, result.dto.id),
        }),
      );
    }
    return result.dto;
  }

  // ===================================================================
  // Bidder — place bid (race-guarded + anti-snipe)
  // ===================================================================

  async placeBid(
    ctx: BidderCtx,
    listingId: string,
    bidAmountCents: number,
  ): Promise<AuctionBidDto> {
    const tenantCtx: CallerCtx = {
      tenantId: ctx.tenantId,
      userId: ctx.bidderId,
      requestId: ctx.requestId ?? '',
    };
    const now = new Date();

    const outcome = await this.db.runInTenantContext(tenantCtx, async (tx) => {
      // Confirm the bidder is in good standing.
      const bidder = await tx.query.auctionBidders.findFirst({
        where: and(eq(auctionBidders.id, ctx.bidderId), isNull(auctionBidders.deletedAt)),
      });
      if (!bidder) throw notFound('Bidder not found');
      if (bidder.blockedAt) {
        throw new ConflictException({
          code: 'bidder_blocked',
          message: 'This bidder account is blocked.',
        });
      }
      if (!bidder.verifiedAt) {
        throw new ConflictException({
          code: 'bidder_email_not_verified',
          message: 'Verify your email before bidding.',
        });
      }

      // Lock the listing row for the duration of the bid evaluation so two
      // bidders racing at the current top cannot both win.
      const locked = await tx
        .select()
        .from(auctionListings)
        .where(and(eq(auctionListings.id, listingId), isNull(auctionListings.deletedAt)))
        .for('update');
      const listing = locked[0];
      if (!listing) throw notFound('Listing not found');

      const topBids = await tx
        .select()
        .from(auctionBids)
        .where(and(eq(auctionBids.listingId, listingId), isNull(auctionBids.deletedAt)))
        .orderBy(desc(auctionBids.bidAmountCents), asc(auctionBids.placedAt))
        .limit(1);
      const prevTop = topBids[0] ?? null;
      const prevHighCents = prevTop ? Number(prevTop.bidAmountCents) : null;

      const verdict = validateBid({
        listingStatus: listing.status,
        listStartsAt: listing.listStartsAt,
        listEndsAt: listing.listEndsAt,
        startingBidCents: Number(listing.startingBidCents),
        currentHighBidCents: prevHighCents,
        bidAmountCents,
        now,
      });
      if (!verdict.ok) {
        throw new ConflictException({ code: verdict.code, message: verdict.message });
      }

      const bidId = uuidv7();
      const [bidRow] = await tx
        .insert(auctionBids)
        .values({
          id: bidId,
          tenantId: ctx.tenantId,
          listingId,
          bidderId: ctx.bidderId,
          bidAmountCents,
          placedAt: now,
          ipAddress: ctx.ipAddress ?? null,
        })
        .returning();
      if (!bidRow) throw new Error('placeBid: insert returning() yielded no row');

      // Anti-snipe: a bid in the final 60s pushes the close out 5 minutes.
      const extendedEnd = computeAntiSnipeExtension(listing.listEndsAt, now);
      if (extendedEnd) {
        await tx
          .update(auctionListings)
          .set({ listEndsAt: extendedEnd })
          .where(eq(auctionListings.id, listingId));
      }

      // Gather notification recipients while still in the tx.
      const reserve = listing.reservePriceCents === null ? null : Number(listing.reservePriceCents);
      const reserveMetNow =
        reserve !== null &&
        bidAmountCents >= reserve &&
        (prevHighCents === null || prevHighCents < reserve);

      let outbid: { email: string; name: string } | null = null;
      if (prevTop && prevTop.bidderId !== ctx.bidderId) {
        const prevBidder = await tx.query.auctionBidders.findFirst({
          where: eq(auctionBidders.id, prevTop.bidderId),
        });
        if (prevBidder) outbid = { email: prevBidder.email, name: prevBidder.name };
      }

      let staffEmail: { email: string; name: string } | null = null;
      if (reserveMetNow && listing.createdBy) {
        const staff = await tx.query.users.findFirst({ where: eq(users.id, listing.createdBy) });
        if (staff)
          staffEmail = { email: staff.email, name: `${staff.firstName}`.trim() || 'there' };
      }

      return {
        bid: toBidDto(bidRow),
        listing: toListingDto(listing),
        tenantSlug: await this.tenantSlug(tx, ctx.tenantId),
        bidder: { email: bidder.email, name: bidder.name },
        outbid,
        staffEmail,
        reserveMetNow,
        bidAmountCents,
      };
    });

    // Best-effort notifications, after commit.
    await this.safeSend(() =>
      this.email.sendAuctionBidPlacedEmail({
        to: outcome.bidder.email,
        bidderName: outcome.bidder.name,
        listingLabel: listingLabel(outcome.listing),
        bidAmountFormatted: formatCents(outcome.bidAmountCents),
        listingUrl: this.listingUrl(outcome.tenantSlug, outcome.listing.id),
      }),
    );
    if (outcome.outbid) {
      await this.safeSend(() =>
        this.email.sendAuctionOutbidEmail({
          to: outcome.outbid!.email,
          bidderName: outcome.outbid!.name,
          listingLabel: listingLabel(outcome.listing),
          newHighFormatted: formatCents(outcome.bidAmountCents),
          listingUrl: this.listingUrl(outcome.tenantSlug, outcome.listing.id),
        }),
      );
    }
    if (outcome.staffEmail) {
      await this.safeSend(() =>
        this.email.sendAuctionStaffNotificationEmail({
          to: outcome.staffEmail!.email,
          staffName: outcome.staffEmail!.name,
          headline: 'Reserve met on an auction listing',
          message: `A bid of ${formatCents(outcome.bidAmountCents)} has met or exceeded the reserve.`,
          listingLabel: listingLabel(outcome.listing),
          listingUrl: this.listingUrl(outcome.tenantSlug, outcome.listing.id),
        }),
      );
    }
    return outcome.bid;
  }

  // ===================================================================
  // Public (unauthenticated marketplace) — admin pool, explicit tenant filter
  // ===================================================================

  /**
   * Resolve a tenant's id from its public slug. Uses the admin pool because
   * an anonymous marketplace visitor has no tenant context yet — the same
   * "login lookup-by-email-and-slug" seam noted in tenant-aware-db.service.ts.
   */
  async resolveTenantIdBySlug(slug: string): Promise<string | null> {
    return this.admin.runAsAdmin({}, async (db) => {
      const row = await db.query.tenants.findFirst({
        where: and(eq(tenants.slug, slug), eq(tenants.status, 'active')),
        columns: { id: true },
      });
      return row?.id ?? null;
    });
  }

  async publicListLiveListings(tenantId: string): Promise<PublicAuctionListingDto[]> {
    return this.admin.runAsAdmin({}, async (db) => {
      const rows = await db
        .select()
        .from(auctionListings)
        .where(
          and(
            eq(auctionListings.tenantId, tenantId),
            eq(auctionListings.status, 'live'),
            isNull(auctionListings.deletedAt),
          ),
        )
        .orderBy(asc(auctionListings.listEndsAt));
      const result: PublicAuctionListingDto[] = [];
      for (const listing of rows) {
        result.push(await this.composePublic(db, listing));
      }
      return result;
    });
  }

  async publicGetListing(tenantId: string, id: string): Promise<PublicAuctionListingDto> {
    return this.admin.runAsAdmin({}, async (db) => {
      const rows = await db
        .select()
        .from(auctionListings)
        .where(
          and(
            eq(auctionListings.id, id),
            eq(auctionListings.tenantId, tenantId),
            isNull(auctionListings.deletedAt),
          ),
        )
        .limit(1);
      const listing = rows[0];
      if (
        !listing ||
        (listing.status !== 'live' && listing.status !== 'ended' && listing.status !== 'sold')
      ) {
        throw notFound('Listing not found');
      }
      return this.composePublic(db, listing);
    });
  }

  async listBidderBids(ctx: BidderCtx): Promise<AuctionBidDto[]> {
    const tenantCtx: CallerCtx = {
      tenantId: ctx.tenantId,
      userId: ctx.bidderId,
      requestId: ctx.requestId ?? '',
    };
    return this.db.runInTenantContext(tenantCtx, async (tx) => {
      const rows = await tx.query.auctionBids.findMany({
        where: and(eq(auctionBids.bidderId, ctx.bidderId), isNull(auctionBids.deletedAt)),
        orderBy: (t, { desc: d }) => [d(t.placedAt)],
      });
      return rows.map(toBidDto);
    });
  }

  // ===================================================================
  // Lifecycle close (shared by manual end + cron)
  // ===================================================================

  /**
   * Close one live listing inside an existing tx. Returns the updated DTO
   * plus the notification payload to flush after commit. Caller owns the tx.
   */
  async closeLiveListing(
    tx: Tx,
    id: string,
    now: Date,
  ): Promise<{ dto: AuctionListingDto; notify: CloseNotification }> {
    const locked = await tx
      .select()
      .from(auctionListings)
      .where(and(eq(auctionListings.id, id), isNull(auctionListings.deletedAt)))
      .for('update');
    const listing = locked[0];
    if (!listing) throw notFound('Listing not found');
    if (listing.status !== 'live') {
      throw new ConflictException({
        code: 'invalid_state_transition',
        message: 'Only live listings can be ended.',
      });
    }

    const topBids = await tx
      .select()
      .from(auctionBids)
      .where(and(eq(auctionBids.listingId, id), isNull(auctionBids.deletedAt)))
      .orderBy(desc(auctionBids.bidAmountCents), asc(auctionBids.placedAt))
      .limit(1);
    const top = topBids[0] ?? null;
    const reserve = listing.reservePriceCents === null ? null : Number(listing.reservePriceCents);
    const close = evaluateClose(
      reserve,
      top ? { id: top.id, amountCents: Number(top.bidAmountCents) } : null,
    );

    const [row] = await tx
      .update(auctionListings)
      .set({ status: close.outcome, winningBidId: close.winningBidId })
      .where(eq(auctionListings.id, id))
      .returning();
    if (!row) throw notFound('Listing not found');
    if (close.winningBidId) {
      await tx
        .update(auctionBids)
        .set({ isWinning: true })
        .where(eq(auctionBids.id, close.winningBidId));
    }

    const dto = toListingDto(row);
    const notify: CloseNotification = {
      listingLabel: listingLabel(dto),
      listingId: dto.id,
      tenantSlug: await this.tenantSlug(tx, listing.tenantId),
      sold: close.outcome === 'sold',
      winningBidCents: close.winningBidCents,
      winner: null,
      losers: [],
      staff: null,
    };

    // Resolve recipients.
    const allBidders = await tx.query.auctionBids.findMany({
      where: and(eq(auctionBids.listingId, id), isNull(auctionBids.deletedAt)),
      columns: { bidderId: true },
    });
    const bidderIds = [...new Set(allBidders.map((b) => b.bidderId))];
    if (bidderIds.length > 0) {
      const bidders = await tx.query.auctionBidders.findMany({
        where: inArray(auctionBidders.id, bidderIds),
      });
      const winnerBidderId = top?.bidderId ?? null;
      for (const b of bidders) {
        if (close.outcome === 'sold' && b.id === winnerBidderId) {
          notify.winner = { email: b.email, name: b.name };
        } else {
          notify.losers.push({ email: b.email, name: b.name });
        }
      }
    }
    if (listing.createdBy) {
      const staff = await tx.query.users.findFirst({ where: eq(users.id, listing.createdBy) });
      if (staff)
        notify.staff = { email: staff.email, name: `${staff.firstName}`.trim() || 'there' };
    }
    return { dto, notify };
  }

  async flushCloseNotifications(n: CloseNotification): Promise<void> {
    if (n.winner) {
      await this.safeSend(() =>
        this.email.sendAuctionResultEmail({
          to: n.winner!.email,
          bidderName: n.winner!.name,
          listingLabel: n.listingLabel,
          won: true,
          amountFormatted: formatCents(n.winningBidCents ?? 0),
          listingUrl: this.listingUrl(n.tenantSlug, n.listingId),
        }),
      );
    }
    for (const loser of n.losers) {
      await this.safeSend(() =>
        this.email.sendAuctionResultEmail({
          to: loser.email,
          bidderName: loser.name,
          listingLabel: n.listingLabel,
          won: false,
          amountFormatted: '',
          listingUrl: this.listingUrl(n.tenantSlug, n.listingId),
        }),
      );
    }
    if (n.staff) {
      await this.safeSend(() =>
        this.email.sendAuctionStaffNotificationEmail({
          to: n.staff!.email,
          staffName: n.staff!.name,
          headline: n.sold ? 'Auction listing sold' : 'Auction listing closed — manual review',
          message: n.sold
            ? `The listing sold for ${formatCents(n.winningBidCents ?? 0)}.`
            : 'The listing closed without a bid meeting reserve. Review for manual award or relist.',
          listingLabel: n.listingLabel,
          listingUrl: this.listingUrl(n.tenantSlug, n.listingId),
        }),
      );
    }
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  private async composeDetail(tx: Tx, listing: AuctionListing): Promise<AuctionListingDetailDto> {
    const photos = await tx.query.auctionListingPhotos.findMany({
      where: and(
        eq(auctionListingPhotos.listingId, listing.id),
        isNull(auctionListingPhotos.deletedAt),
      ),
      orderBy: (t, { asc: a }) => [a(t.sortOrder)],
    });
    const bidRows = await tx.query.auctionBids.findMany({
      where: and(eq(auctionBids.listingId, listing.id), isNull(auctionBids.deletedAt)),
      orderBy: (t, { desc: d }) => [d(t.bidAmountCents), d(t.placedAt)],
    });
    const bidderIds = [...new Set(bidRows.map((b) => b.bidderId))];
    const bidders =
      bidderIds.length > 0
        ? await tx.query.auctionBidders.findMany({ where: inArray(auctionBidders.id, bidderIds) })
        : [];
    const byId = new Map(bidders.map((b) => [b.id, b]));
    const bids: AuctionBidWithBidder[] = bidRows.map((b) => ({
      ...toBidDto(b),
      bidderName: byId.get(b.bidderId)?.name ?? 'Unknown',
      bidderBusinessName: byId.get(b.bidderId)?.businessName ?? null,
    }));
    const high = bidRows[0] ? Number(bidRows[0].bidAmountCents) : null;
    const reserve = listing.reservePriceCents === null ? null : Number(listing.reservePriceCents);
    return {
      ...toListingDto(listing),
      photos: photos.map(toPhotoDto),
      bids,
      bidCount: bidRows.length,
      currentHighBidCents: high,
      reserveMet: high !== null && (reserve === null || high >= reserve),
    };
  }

  private async composePublic(db: Tx, listing: AuctionListing): Promise<PublicAuctionListingDto> {
    const photos = await db
      .select()
      .from(auctionListingPhotos)
      .where(
        and(eq(auctionListingPhotos.listingId, listing.id), isNull(auctionListingPhotos.deletedAt)),
      )
      .orderBy(asc(auctionListingPhotos.sortOrder));
    const topBids = await db
      .select()
      .from(auctionBids)
      .where(and(eq(auctionBids.listingId, listing.id), isNull(auctionBids.deletedAt)))
      .orderBy(desc(auctionBids.bidAmountCents));
    const high = topBids[0] ? Number(topBids[0].bidAmountCents) : null;
    const reserve = listing.reservePriceCents === null ? null : Number(listing.reservePriceCents);
    return {
      id: listing.id,
      vin: listing.vin,
      vehicleYear: listing.vehicleYear,
      make: listing.make,
      model: listing.model,
      mileage: listing.mileage,
      conditionGrade: listing.conditionGrade,
      startingBidCents: Number(listing.startingBidCents),
      currentHighBidCents: high,
      bidCount: topBids.length,
      reserveMet: high !== null && (reserve === null || high >= reserve),
      listStartsAt: listing.listStartsAt ? listing.listStartsAt.toISOString() : null,
      listEndsAt: listing.listEndsAt ? listing.listEndsAt.toISOString() : null,
      status: listing.status,
      photoKeys: photos.map((p) => p.photoKey),
    };
  }

  private listingUrl(tenantSlug: string, listingId: string): string {
    const slug = tenantSlug || '_';
    return `/marketplace/${encodeURIComponent(slug)}/listing/${listingId}`;
  }

  private async tenantSlug(tx: Tx, tenantId: string): Promise<string> {
    const row = await tx.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { slug: true },
    });
    return row?.slug ?? '';
  }

  private async safeSend(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.log.warn({ msg: 'auction notification failed', err: (err as Error).message });
    }
  }
}

interface CloseNotification {
  listingLabel: string;
  listingId: string;
  tenantSlug: string;
  sold: boolean;
  winningBidCents: number | null;
  winner: { email: string; name: string } | null;
  losers: { email: string; name: string }[];
  staff: { email: string; name: string } | null;
}

// ===================================================================
// DTO mappers + small formatters
// ===================================================================

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'not_found', message });
}

function toListingDto(row: AuctionListing): AuctionListingDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    impoundRecordId: row.impoundRecordId,
    lienCaseId: row.lienCaseId,
    vin: row.vin,
    vehicleYear: row.vehicleYear,
    make: row.make,
    model: row.model,
    mileage: row.mileage,
    conditionGrade: row.conditionGrade,
    reservePriceCents: row.reservePriceCents === null ? null : Number(row.reservePriceCents),
    startingBidCents: Number(row.startingBidCents),
    listStartsAt: row.listStartsAt ? row.listStartsAt.toISOString() : null,
    listEndsAt: row.listEndsAt ? row.listEndsAt.toISOString() : null,
    status: row.status,
    winningBidId: row.winningBidId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toBidDto(row: AuctionBid): AuctionBidDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    listingId: row.listingId,
    bidderId: row.bidderId,
    bidAmountCents: Number(row.bidAmountCents),
    placedAt: row.placedAt.toISOString(),
    ipAddress: row.ipAddress,
    isWinning: row.isWinning,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toBidderDto(row: AuctionBidder): AuctionBidderDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    businessName: row.businessName,
    licenseNo: row.licenseNo,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPhotoDto(row: AuctionListingPhoto): AuctionListingPhotoDto {
  return {
    id: row.id,
    listingId: row.listingId,
    photoKey: row.photoKey,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

function listingLabel(l: AuctionListingDto): string {
  const parts = [l.vehicleYear, l.make, l.model].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : (l.vin ?? `Listing ${l.id.slice(0, 8)}`);
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
