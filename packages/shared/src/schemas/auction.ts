/**
 * Auction & Remarketing Marketplace (Session 33) — Zod contracts.
 *
 * Two surfaces share this file:
 *   • staff (operator)  — create/publish/withdraw/award listings, read bids
 *   • bidder (public)   — register, verify email, login, browse, place bids
 *
 * Money is cents-as-integer throughout; all timestamps cross the wire as
 * UTC ISO-8601 strings. Read DTOs use `.nullable()` for columns that can be
 * NULL; write payloads use `.optional()` for fields the client may omit.
 *
 * Lives in src/schemas/ (not src/auction/) so it is re-exported by the
 * schemas barrel and reachable via the package's `./schemas` export map —
 * a top-level src/auction/ folder would not be in package.json `exports`.
 */
import { z } from 'zod';

// ===================================================================
// Enums (mirror DB CHECK constraints in 0038_auction_marketplace.sql)
// ===================================================================

export const auctionListingStatusValues = ['draft', 'live', 'ended', 'sold', 'withdrawn'] as const;
export type AuctionListingStatus = (typeof auctionListingStatusValues)[number];

export const auctionConditionGradeValues = [
  'excellent',
  'good',
  'fair',
  'poor',
  'salvage',
] as const;
export type AuctionConditionGrade = (typeof auctionConditionGradeValues)[number];

// ===================================================================
// Read DTOs
// ===================================================================

export const auctionListingPhotoSchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  photoKey: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
});
export type AuctionListingPhotoDto = z.infer<typeof auctionListingPhotoSchema>;

export const auctionListingSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  impoundRecordId: z.string().uuid().nullable(),
  lienCaseId: z.string().uuid().nullable(),
  vin: z.string().nullable(),
  vehicleYear: z.number().int().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  mileage: z.number().int().nullable(),
  conditionGrade: z.enum(auctionConditionGradeValues).nullable(),
  reservePriceCents: z.number().int().nullable(),
  startingBidCents: z.number().int(),
  listStartsAt: z.string().datetime().nullable(),
  listEndsAt: z.string().datetime().nullable(),
  status: z.enum(auctionListingStatusValues),
  winningBidId: z.string().uuid().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type AuctionListingDto = z.infer<typeof auctionListingSchema>;

export const auctionBidSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  listingId: z.string().uuid(),
  bidderId: z.string().uuid(),
  bidAmountCents: z.number().int(),
  placedAt: z.string().datetime(),
  ipAddress: z.string().nullable(),
  isWinning: z.boolean(),
  createdAt: z.string().datetime(),
});
export type AuctionBidDto = z.infer<typeof auctionBidSchema>;

export const auctionBidderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  businessName: z.string().nullable(),
  licenseNo: z.string().nullable(),
  verifiedAt: z.string().datetime().nullable(),
  blockedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AuctionBidderDto = z.infer<typeof auctionBidderSchema>;

/** A single bid joined with the placing bidder's display identity. */
export const auctionBidWithBidderSchema = auctionBidSchema.extend({
  bidderName: z.string(),
  bidderBusinessName: z.string().nullable(),
});
export type AuctionBidWithBidder = z.infer<typeof auctionBidWithBidderSchema>;

/** Staff-side listing detail: listing + photos + full bid history. */
export const auctionListingDetailSchema = auctionListingSchema.extend({
  photos: z.array(auctionListingPhotoSchema),
  bids: z.array(auctionBidWithBidderSchema),
  bidCount: z.number().int(),
  currentHighBidCents: z.number().int().nullable(),
  reserveMet: z.boolean(),
});
export type AuctionListingDetailDto = z.infer<typeof auctionListingDetailSchema>;

/**
 * Public marketplace view of a listing. Reserve price is intentionally
 * never exposed — bidders learn only whether the reserve has been met.
 */
export const publicAuctionListingSchema = z.object({
  id: z.string().uuid(),
  vin: z.string().nullable(),
  vehicleYear: z.number().int().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  mileage: z.number().int().nullable(),
  conditionGrade: z.enum(auctionConditionGradeValues).nullable(),
  startingBidCents: z.number().int(),
  currentHighBidCents: z.number().int().nullable(),
  bidCount: z.number().int(),
  reserveMet: z.boolean(),
  listStartsAt: z.string().datetime().nullable(),
  listEndsAt: z.string().datetime().nullable(),
  status: z.enum(auctionListingStatusValues),
  photoKeys: z.array(z.string()),
});
export type PublicAuctionListingDto = z.infer<typeof publicAuctionListingSchema>;

// ===================================================================
// Staff write payloads
// ===================================================================

const conditionGrade = z.enum(auctionConditionGradeValues);
const centsNonNeg = z.number().int().nonnegative();

export const createAuctionListingSchema = z
  .object({
    impoundRecordId: z.string().uuid().optional(),
    lienCaseId: z.string().uuid().optional(),
    vin: z.string().trim().min(1).max(32).optional(),
    vehicleYear: z.number().int().min(1900).max(2200).optional(),
    make: z.string().trim().min(1).max(64).optional(),
    model: z.string().trim().min(1).max(64).optional(),
    mileage: z.number().int().nonnegative().optional(),
    conditionGrade: conditionGrade.optional(),
    reservePriceCents: centsNonNeg.optional(),
    startingBidCents: centsNonNeg,
    listStartsAt: z.string().datetime().optional(),
    listEndsAt: z.string().datetime().optional(),
    photoKeys: z.array(z.string().min(1)).max(24).default([]),
  })
  .refine((v) => v.reservePriceCents === undefined || v.reservePriceCents >= v.startingBidCents, {
    message: 'reservePriceCents must be >= startingBidCents',
    path: ['reservePriceCents'],
  });
export type CreateAuctionListingPayload = z.infer<typeof createAuctionListingSchema>;

export const updateAuctionListingSchema = z.object({
  vin: z.string().trim().min(1).max(32).optional(),
  vehicleYear: z.number().int().min(1900).max(2200).optional(),
  make: z.string().trim().min(1).max(64).optional(),
  model: z.string().trim().min(1).max(64).optional(),
  mileage: z.number().int().nonnegative().optional(),
  conditionGrade: conditionGrade.optional(),
  reservePriceCents: centsNonNeg.optional(),
  startingBidCents: centsNonNeg.optional(),
  listStartsAt: z.string().datetime().optional(),
  listEndsAt: z.string().datetime().optional(),
  photoKeys: z.array(z.string().min(1)).max(24).optional(),
});
export type UpdateAuctionListingPayload = z.infer<typeof updateAuctionListingSchema>;

export const publishAuctionListingSchema = z.object({
  listStartsAt: z.string().datetime().optional(),
  listEndsAt: z.string().datetime(),
});
export type PublishAuctionListingPayload = z.infer<typeof publishAuctionListingSchema>;

export const awardAuctionListingSchema = z.object({
  bidId: z.string().uuid(),
});
export type AwardAuctionListingPayload = z.infer<typeof awardAuctionListingSchema>;

export const listAuctionListingsFilterSchema = z.object({
  status: z.enum(auctionListingStatusValues).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListAuctionListingsFilter = z.infer<typeof listAuctionListingsFilterSchema>;

/** A vehicle eligible to be listed (lien-cleared impound record). */
export const auctionEligibleVehicleSchema = z.object({
  impoundRecordId: z.string().uuid(),
  vin: z.string().nullable(),
  vehicleYear: z.number().int().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  licensePlate: z.string().nullable(),
  accruedFeeCents: z.number().int(),
  lienEligibleAt: z.string().datetime().nullable(),
});
export type AuctionEligibleVehicleDto = z.infer<typeof auctionEligibleVehicleSchema>;

// ===================================================================
// Bidder (public) payloads + responses
// ===================================================================

export const bidderRegisterSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(254),
  password: z.string().min(10).max(200),
  phone: z.string().trim().max(40).optional(),
  businessName: z.string().trim().max(160).optional(),
  licenseNo: z.string().trim().max(80).optional(),
});
export type BidderRegisterPayload = z.infer<typeof bidderRegisterSchema>;

export const bidderLoginSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(64),
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});
export type BidderLoginPayload = z.infer<typeof bidderLoginSchema>;

export const bidderVerifyEmailSchema = z.object({
  token: z.string().min(10).max(200),
});
export type BidderVerifyEmailPayload = z.infer<typeof bidderVerifyEmailSchema>;

export const placeBidSchema = z.object({
  bidAmountCents: z.number().int().positive(),
});
export type PlaceBidPayload = z.infer<typeof placeBidSchema>;

export const bidderAuthResponseSchema = z.object({
  status: z.literal('authenticated'),
  bidder: auctionBidderSchema,
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type BidderAuthResponse = z.infer<typeof bidderAuthResponseSchema>;

/** Returned by registration before email verification completes. */
export const bidderRegisterResponseSchema = z.object({
  status: z.literal('verification_required'),
  bidder: auctionBidderSchema,
  /**
   * Only populated when SENDGRID/SMTP are not configured (dev). Lets the
   * marketplace surface the verify link without a mail round-trip. Never
   * set in production.
   */
  devVerificationToken: z.string().nullable(),
});
export type BidderRegisterResponse = z.infer<typeof bidderRegisterResponseSchema>;
