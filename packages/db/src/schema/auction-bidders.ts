/**
 * auction_bidders — registered buyers for the per-tenant remarketing
 * marketplace (Session 33). Separate auth from staff: argon2id
 * password_hash + a bidder JWT. Email verification token lives on the row
 * (rotated on consume). Defined in packages/db/sql/0038_auction_marketplace.sql.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const auctionBidders = pgTable(
  'auction_bidders',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    phone: text('phone'),
    businessName: text('business_name'),
    licenseNo: text('license_no'),
    verificationToken: text('verification_token'),
    verificationTokenExpiresAt: timestamp('verification_token_expires_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('auction_bidders_tenant_idx').on(t.tenantId).where(sql`deleted_at IS NULL`),
  }),
);

export type AuctionBidder = typeof auctionBidders.$inferSelect;
export type NewAuctionBidder = typeof auctionBidders.$inferInsert;
