/**
 * Pure decision helpers for the Auction & Remarketing Marketplace
 * (Session 33). No DB, no I/O — every branch is unit-testable in
 * isolation. The service layer owns transactions + row locking and calls
 * these to decide bid acceptance, anti-snipe extension, and close outcome.
 */

/** A bid placed in the final 60s of a window extends it by 5 minutes. */
export const AUCTION_ANTI_SNIPE_WINDOW_MS = 60_000;
export const AUCTION_ANTI_SNIPE_EXTENSION_MS = 5 * 60_000;

export type BidRejectionCode = 'auction_not_live' | 'auction_ended' | 'auction_bid_too_low';

export type BidValidation =
  | { ok: true; minNextBidCents: number }
  | { ok: false; code: BidRejectionCode; message: string };

export interface BidContext {
  listingStatus: string;
  listStartsAt: Date | null;
  listEndsAt: Date | null;
  startingBidCents: number;
  /** Highest live bid so far, or null if none. */
  currentHighBidCents: number | null;
  bidAmountCents: number;
  now: Date;
}

/**
 * The smallest bid that would be accepted right now: at least the starting
 * bid, and strictly greater than the current high.
 */
export function minNextBidCents(
  startingBidCents: number,
  currentHighBidCents: number | null,
): number {
  if (currentHighBidCents === null) return startingBidCents;
  return Math.max(startingBidCents, currentHighBidCents + 1);
}

/**
 * Validate a bid against the listing's live window and price floor.
 *   - listing must be `live`
 *   - now must be within [listStartsAt, listEndsAt]
 *   - amount must be >= starting bid AND strictly above the current high
 */
export function validateBid(ctx: BidContext): BidValidation {
  if (ctx.listingStatus !== 'live') {
    return {
      ok: false,
      code: 'auction_not_live',
      message: 'This listing is not open for bidding.',
    };
  }
  if (ctx.listStartsAt && ctx.now.getTime() < ctx.listStartsAt.getTime()) {
    return {
      ok: false,
      code: 'auction_not_live',
      message: 'Bidding has not opened for this listing yet.',
    };
  }
  if (ctx.listEndsAt && ctx.now.getTime() > ctx.listEndsAt.getTime()) {
    return {
      ok: false,
      code: 'auction_ended',
      message: 'Bidding has closed for this listing.',
    };
  }
  const floor = minNextBidCents(ctx.startingBidCents, ctx.currentHighBidCents);
  if (ctx.bidAmountCents < floor) {
    return {
      ok: false,
      code: 'auction_bid_too_low',
      message: `Bid must be at least ${floor} cents.`,
    };
  }
  return { ok: true, minNextBidCents: floor };
}

/**
 * Anti-snipe: when an accepted bid lands inside the final window, push the
 * end out so other bidders get a fair chance to respond. Returns the new
 * end timestamp, or null when no extension applies.
 */
export function computeAntiSnipeExtension(
  listEndsAt: Date | null,
  now: Date,
  windowMs: number = AUCTION_ANTI_SNIPE_WINDOW_MS,
  extensionMs: number = AUCTION_ANTI_SNIPE_EXTENSION_MS,
): Date | null {
  if (!listEndsAt) return null;
  const remaining = listEndsAt.getTime() - now.getTime();
  if (remaining < 0 || remaining > windowMs) return null;
  return new Date(now.getTime() + extensionMs);
}

export interface CloseOutcome {
  /** `sold` when the high bid clears reserve; otherwise `ended` (manual review). */
  outcome: 'sold' | 'ended';
  winningBidId: string | null;
  winningBidCents: number | null;
}

/**
 * Decide a listing's fate at close. With no bids, or a high bid below
 * reserve, the listing ends unsold and routes to manual staff review.
 * A null reserve means any bid wins.
 */
export function evaluateClose(
  reservePriceCents: number | null,
  highBid: { id: string; amountCents: number } | null,
): CloseOutcome {
  if (!highBid) {
    return { outcome: 'ended', winningBidId: null, winningBidCents: null };
  }
  const reserveMet = reservePriceCents === null || highBid.amountCents >= reservePriceCents;
  if (reserveMet) {
    return { outcome: 'sold', winningBidId: highBid.id, winningBidCents: highBid.amountCents };
  }
  return { outcome: 'ended', winningBidId: null, winningBidCents: null };
}
