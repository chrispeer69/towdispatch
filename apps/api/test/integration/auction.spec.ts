/**
 * Integration spec — Auction & Remarketing Marketplace (Session 33).
 *
 * Drives the real Fastify app + Docker Postgres/Redis through the full
 * lifecycle: create draft → publish → bidder register/verify/login →
 * competitive bids (incl. reject-below-high) → end → auto-award, plus the
 * anti-snipe extension and the reserve-not-met → manual-award path.
 * Skips when no test DB is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthedResp,
  type TestContext,
  auth,
  makeContext,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const describeIfDb = skipIfNoDb ? describe.skip : describe;

describeIfDb('integration — auction marketplace', () => {
  let ctx: TestContext;
  let owner: AuthedResp;
  let token: string;
  let slug: string;
  const tenantIds: string[] = [];

  function staff(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) {
    return ctx.app.inject({
      method,
      url,
      headers: { ...auth(token), 'content-type': 'application/json' },
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  function bidder(
    bidderToken: string,
    method: 'GET' | 'POST',
    url: string,
    payload?: Record<string, unknown>,
  ) {
    return ctx.app.inject({
      method,
      url,
      headers: { ...auth(bidderToken), 'content-type': 'application/json' },
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  async function registerBidder(suffix: string): Promise<string> {
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/bidder-auth/register',
      headers: { 'content-type': 'application/json' },
      payload: {
        tenantSlug: slug,
        name: `Bidder ${suffix}`,
        email: `bidder-${suffix}-${Date.now()}@spec.test`,
        password: 'CorrectHorse-Battery-9!',
      },
    });
    expect(reg.statusCode, reg.body).toBe(201);
    const regBody = reg.json() as { devVerificationToken: string | null };
    expect(regBody.devVerificationToken).toBeTruthy();
    const verify = await ctx.app.inject({
      method: 'POST',
      url: '/bidder-auth/verify-email',
      headers: { 'content-type': 'application/json' },
      payload: { token: regBody.devVerificationToken },
    });
    expect(verify.statusCode, verify.body).toBe(201);
    return (verify.json() as { accessToken: string }).accessToken;
  }

  beforeAll(async () => {
    ctx = await makeContext();
    owner = await signup(ctx, makeSignupBody('auction', ctx));
    token = owner.accessToken;
    slug = owner.tenant.slug;
    tenantIds.push(owner.tenant.id);
  });

  afterAll(async () => {
    if (ctx?.admin && tenantIds.length) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        for (const table of [
          'auction_bids',
          'auction_listing_photos',
          'auction_listings',
          'auction_bidders',
        ]) {
          await c.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        }
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  it('runs create → publish → bids → auto-award at close', async () => {
    const createRes = await staff('POST', '/auction/listings', {
      vin: '1FT000000LIFECYCLE',
      make: 'Ford',
      model: 'F-150',
      vehicleYear: 2018,
      startingBidCents: 50000,
    });
    expect(createRes.statusCode, createRes.body).toBe(201);
    const listing = createRes.json() as { id: string; status: string };
    expect(listing.status).toBe('draft');

    const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const pub = await staff('POST', `/auction/listings/${listing.id}/publish`, {
      listEndsAt: endsAt,
    });
    expect(pub.statusCode, pub.body).toBe(201);
    expect((pub.json() as { status: string }).status).toBe('live');

    const b1 = await registerBidder('one');
    const b2 = await registerBidder('two');
    const b3 = await registerBidder('three');

    expect(
      (
        await bidder(b1, 'POST', `/marketplace/listings/${listing.id}/bids`, {
          bidAmountCents: 50000,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await bidder(b2, 'POST', `/marketplace/listings/${listing.id}/bids`, {
          bidAmountCents: 60000,
        })
      ).statusCode,
    ).toBe(201);

    // Below the current high — rejected.
    const tooLow = await bidder(b3, 'POST', `/marketplace/listings/${listing.id}/bids`, {
      bidAmountCents: 55000,
    });
    expect(tooLow.statusCode).toBe(409);

    expect(
      (
        await bidder(b3, 'POST', `/marketplace/listings/${listing.id}/bids`, {
          bidAmountCents: 70000,
        })
      ).statusCode,
    ).toBe(201);

    const end = await staff('POST', `/auction/listings/${listing.id}/end`);
    expect(end.statusCode, end.body).toBe(201);
    expect((end.json() as { status: string }).status).toBe('sold');

    const detail = await staff('GET', `/auction/listings/${listing.id}`);
    const d = detail.json() as {
      status: string;
      winningBidId: string | null;
      currentHighBidCents: number;
      bidCount: number;
      bids: { isWinning: boolean; bidAmountCents: number }[];
    };
    expect(d.status).toBe('sold');
    expect(d.winningBidId).toBeTruthy();
    expect(d.currentHighBidCents).toBe(70000);
    expect(d.bidCount).toBe(3);
    expect(d.bids.filter((x) => x.isWinning)).toHaveLength(1);

    // Bidding is closed — further bids rejected.
    const afterEnd = await bidder(b1, 'POST', `/marketplace/listings/${listing.id}/bids`, {
      bidAmountCents: 90000,
    });
    expect(afterEnd.statusCode).toBe(409);
  });

  it('extends the close window when a bid lands in the final 60s (anti-snipe)', async () => {
    const createRes = await staff('POST', '/auction/listings', { startingBidCents: 1000 });
    const listing = createRes.json() as { id: string };
    const endsAt = new Date(Date.now() + 30 * 1000).toISOString(); // 30s out
    const pub = await staff('POST', `/auction/listings/${listing.id}/publish`, {
      listEndsAt: endsAt,
    });
    const publishedEnd = new Date((pub.json() as { listEndsAt: string }).listEndsAt).getTime();

    const b = await registerBidder('snipe');
    expect(
      (
        await bidder(b, 'POST', `/marketplace/listings/${listing.id}/bids`, {
          bidAmountCents: 2000,
        })
      ).statusCode,
    ).toBe(201);

    const detail = await staff('GET', `/auction/listings/${listing.id}`);
    const newEnd = new Date((detail.json() as { listEndsAt: string }).listEndsAt).getTime();
    expect(newEnd).toBeGreaterThan(publishedEnd);
    // Roughly five minutes past now.
    expect(newEnd - Date.now()).toBeGreaterThan(4 * 60 * 1000);
  });

  it('ends unsold when reserve is not met, then awards manually', async () => {
    const createRes = await staff('POST', '/auction/listings', {
      startingBidCents: 1000,
      reservePriceCents: 1_000_000,
    });
    const listing = createRes.json() as { id: string };
    await staff('POST', `/auction/listings/${listing.id}/publish`, {
      listEndsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const b = await registerBidder('reserve');
    const bidRes = await bidder(b, 'POST', `/marketplace/listings/${listing.id}/bids`, {
      bidAmountCents: 2000,
    });
    expect(bidRes.statusCode).toBe(201);
    const bidId = (bidRes.json() as { id: string }).id;

    const end = await staff('POST', `/auction/listings/${listing.id}/end`);
    expect((end.json() as { status: string }).status).toBe('ended');

    const award = await staff('POST', `/auction/listings/${listing.id}/award`, { bidId });
    expect(award.statusCode, award.body).toBe(201);
    expect((award.json() as { status: string; winningBidId: string | null }).status).toBe('sold');
    expect((award.json() as { winningBidId: string | null }).winningBidId).toBe(bidId);
  });
});
