/**
 * auction_bids — competitive bids against a listing (Session 33). The
 * unique index on (listing_id, bidder_id, bid_amount_cents) among live
 * rows is the idempotency backstop; the primary race guard is a
 * SELECT ... FOR UPDATE on the listing row in the service layer.
 * Defined in packages/db/sql/0038_auction_marketplace.sql.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auctionBidders } from './auction-bidders';
import { auctionListings } from './auction-listings';
import { tenants } from './tenants';

export const auctionBids = pgTable(
  'auction_bids',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => auctionListings.id, { onDelete: 'cascade' }),
    bidderId: uuid('bidder_id')
      .notNull()
      .references(() => auctionBidders.id, { onDelete: 'restrict' }),
    bidAmountCents: bigint('bid_amount_cents', { mode: 'number' }).notNull(),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    isWinning: boolean('is_winning').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    listingIdx: index('auction_bids_listing_idx').on(t.listingId).where(sql`deleted_at IS NULL`),
    tenantBidderIdx: index('auction_bids_tenant_bidder_idx')
      .on(t.tenantId, t.bidderId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type AuctionBid = typeof auctionBids.$inferSelect;
export type NewAuctionBid = typeof auctionBids.$inferInsert;
