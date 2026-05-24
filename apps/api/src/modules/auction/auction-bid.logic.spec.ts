import { describe, expect, it } from 'vitest';
import {
  AUCTION_ANTI_SNIPE_EXTENSION_MS,
  AUCTION_ANTI_SNIPE_WINDOW_MS,
  type BidContext,
  computeAntiSnipeExtension,
  evaluateClose,
  minNextBidCents,
  validateBid,
} from './auction-bid.logic.js';

const NOW = new Date('2026-05-24T12:00:00.000Z');
const ENDS = new Date('2026-05-24T18:00:00.000Z');

function ctx(overrides: Partial<BidContext> = {}): BidContext {
  return {
    listingStatus: 'live',
    listStartsAt: new Date('2026-05-24T06:00:00.000Z'),
    listEndsAt: ENDS,
    startingBidCents: 100_000,
    currentHighBidCents: null,
    bidAmountCents: 100_000,
    now: NOW,
    ...overrides,
  };
}

describe('minNextBidCents', () => {
  it('is the starting bid when there are no bids', () => {
    expect(minNextBidCents(100_000, null)).toBe(100_000);
  });
  it('is one cent above the current high once that clears the start', () => {
    expect(minNextBidCents(100_000, 150_000)).toBe(150_001);
  });
  it('never drops below the starting bid even if the high is lower', () => {
    expect(minNextBidCents(100_000, 90_000)).toBe(100_000);
  });
});

describe('validateBid', () => {
  it('accepts the starting bid when there are no prior bids', () => {
    const r = validateBid(ctx({ bidAmountCents: 100_000 }));
    expect(r.ok).toBe(true);
  });

  it('rejects a bid below the starting price', () => {
    const r = validateBid(ctx({ bidAmountCents: 99_999 }));
    expect(r).toMatchObject({ ok: false, code: 'auction_bid_too_low' });
  });

  it('rejects a bid at or below the current high', () => {
    const atHigh = validateBid(ctx({ currentHighBidCents: 150_000, bidAmountCents: 150_000 }));
    expect(atHigh).toMatchObject({ ok: false, code: 'auction_bid_too_low' });
    const below = validateBid(ctx({ currentHighBidCents: 150_000, bidAmountCents: 140_000 }));
    expect(below).toMatchObject({ ok: false, code: 'auction_bid_too_low' });
  });

  it('accepts a bid one cent above the current high', () => {
    const r = validateBid(ctx({ currentHighBidCents: 150_000, bidAmountCents: 150_001 }));
    expect(r.ok).toBe(true);
  });

  it('rejects bids on a non-live listing', () => {
    for (const status of ['draft', 'ended', 'sold', 'withdrawn']) {
      expect(validateBid(ctx({ listingStatus: status }))).toMatchObject({
        ok: false,
        code: 'auction_not_live',
      });
    }
  });

  it('rejects a bid before the window opens', () => {
    const r = validateBid(ctx({ listStartsAt: new Date('2026-05-24T18:00:00.000Z') }));
    expect(r).toMatchObject({ ok: false, code: 'auction_not_live' });
  });

  it('rejects a bid after the window closes', () => {
    const r = validateBid(ctx({ now: new Date('2026-05-24T18:00:01.000Z') }));
    expect(r).toMatchObject({ ok: false, code: 'auction_ended' });
  });
});

describe('computeAntiSnipeExtension', () => {
  it('extends by 5 minutes when a bid lands in the final 60s', () => {
    const now = new Date(ENDS.getTime() - 30_000); // 30s before close
    const next = computeAntiSnipeExtension(ENDS, now);
    expect(next).not.toBeNull();
    expect(next?.getTime()).toBe(now.getTime() + AUCTION_ANTI_SNIPE_EXTENSION_MS);
  });

  it('does not extend when there is more than 60s left', () => {
    const now = new Date(ENDS.getTime() - (AUCTION_ANTI_SNIPE_WINDOW_MS + 1));
    expect(computeAntiSnipeExtension(ENDS, now)).toBeNull();
  });

  it('does not extend after the window has already closed', () => {
    const now = new Date(ENDS.getTime() + 1);
    expect(computeAntiSnipeExtension(ENDS, now)).toBeNull();
  });

  it('returns null for an open-ended listing', () => {
    expect(computeAntiSnipeExtension(null, NOW)).toBeNull();
  });
});

describe('evaluateClose', () => {
  it('ends unsold when there are no bids', () => {
    expect(evaluateClose(500_000, null)).toEqual({
      outcome: 'ended',
      winningBidId: null,
      winningBidCents: null,
    });
  });

  it('awards the high bid when it meets reserve', () => {
    expect(evaluateClose(500_000, { id: 'bid-1', amountCents: 500_000 })).toEqual({
      outcome: 'sold',
      winningBidId: 'bid-1',
      winningBidCents: 500_000,
    });
  });

  it('ends unsold (manual review) when the high bid is below reserve', () => {
    expect(evaluateClose(500_000, { id: 'bid-1', amountCents: 400_000 })).toEqual({
      outcome: 'ended',
      winningBidId: null,
      winningBidCents: null,
    });
  });

  it('awards any bid when there is no reserve', () => {
    expect(evaluateClose(null, { id: 'bid-9', amountCents: 1 })).toMatchObject({
      outcome: 'sold',
      winningBidId: 'bid-9',
    });
  });
});
