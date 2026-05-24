/**
 * auction_listings — one row per vehicle offered for bid (Session 33).
 * impound_record_id links the cleared impound; lien_case_id is reserved
 * for Session 23 (no FK yet — lien_cases not on this branch). winning_bid_id
 * is a plain uuid here (the DB holds the FK to auction_bids; declaring the
 * reference in Drizzle would create a circular import with auction-bids.ts).
 * Defined in packages/db/sql/0038_auction_marketplace.sql.
 */
import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { impoundRecords } from './impound-records';
import { tenants } from './tenants';
import { users } from './users';

export const auctionListingStatusValues = ['draft', 'live', 'ended', 'sold', 'withdrawn'] as const;
export type AuctionListingStatusDb = (typeof auctionListingStatusValues)[number];

export const auctionConditionGradeValues = [
  'excellent',
  'good',
  'fair',
  'poor',
  'salvage',
] as const;
export type AuctionConditionGradeDb = (typeof auctionConditionGradeValues)[number];

export const auctionListings = pgTable(
  'auction_listings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    impoundRecordId: uuid('impound_record_id').references(() => impoundRecords.id, {
      onDelete: 'set null',
    }),
    lienCaseId: uuid('lien_case_id'),
    vin: text('vin'),
    vehicleYear: integer('vehicle_year'),
    make: text('make'),
    model: text('model'),
    mileage: integer('mileage'),
    conditionGrade: text('condition_grade', { enum: auctionConditionGradeValues }),
    reservePriceCents: bigint('reserve_price_cents', { mode: 'number' }),
    startingBidCents: bigint('starting_bid_cents', { mode: 'number' }).notNull().default(0),
    listStartsAt: timestamp('list_starts_at', { withTimezone: true }),
    listEndsAt: timestamp('list_ends_at', { withTimezone: true }),
    status: text('status', { enum: auctionListingStatusValues }).notNull().default('draft'),
    winningBidId: uuid('winning_bid_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('auction_listings_tenant_status_idx')
      .on(t.tenantId, t.status)
      .where(sql`deleted_at IS NULL`),
    tenantCreatedIdx: index('auction_listings_tenant_created_idx')
      .on(t.tenantId, t.createdAt)
      .where(sql`deleted_at IS NULL`),
    impoundIdx: index('auction_listings_impound_idx')
      .on(t.impoundRecordId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type AuctionListing = typeof auctionListings.$inferSelect;
export type NewAuctionListing = typeof auctionListings.$inferInsert;
