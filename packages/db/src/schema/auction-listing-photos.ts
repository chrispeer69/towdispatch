/**
 * auction_listing_photos — ordered photo keys (already-uploaded S3 object
 * keys) for an auction listing (Session 33). Defined in
 * packages/db/sql/0038_auction_marketplace.sql.
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auctionListings } from './auction-listings';
import { tenants } from './tenants';

export const auctionListingPhotos = pgTable(
  'auction_listing_photos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => auctionListings.id, { onDelete: 'cascade' }),
    photoKey: text('photo_key').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    listingIdx: index('auction_listing_photos_listing_idx')
      .on(t.listingId, t.sortOrder)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type AuctionListingPhoto = typeof auctionListingPhotos.$inferSelect;
export type NewAuctionListingPhoto = typeof auctionListingPhotos.$inferInsert;
