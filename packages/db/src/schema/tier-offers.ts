/**
 * tier_offers — the composed offer the operator sends to motor-club
 * account managers (Moat #3: Tier Offer Composer, Session 1).
 *
 * One row per send: each row references the dynamic_pricing_tier whose
 * pricing is being offered, the event window the elevated rate covers,
 * the truck count the operator is committing, and the deadline for
 * acceptance. Recipients accept or decline independently via
 * tier_offer_recipients; the resulting allocation is contractually
 * clean and audit-trailed.
 *
 * Defined in packages/db/sql/0034_tier_offer_composer.sql.
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dynamicPricingTiers } from './dynamic-pricing-tiers';
import { tenants } from './tenants';
import { users } from './users';

export const tierOfferDefaultForNonRespondersValues = [
  'opt_out',
  'accept_at_standard_rate',
] as const;
export type TierOfferDefaultForNonResponders =
  (typeof tierOfferDefaultForNonRespondersValues)[number];

export const tierOfferStatusValues = [
  'draft',
  'sent',
  'event_active',
  'event_concluded',
  'cancelled',
] as const;
export type TierOfferStatus = (typeof tierOfferStatusValues)[number];

export const tierOffers = pgTable(
  'tier_offers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => dynamicPricingTiers.id, { onDelete: 'restrict' }),
    composedBy: uuid('composed_by').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    subjectLine: text('subject_line').notNull(),
    narrative: text('narrative').notNull(),
    eventWindowStart: timestamp('event_window_start', { withTimezone: true }).notNull(),
    eventWindowEnd: timestamp('event_window_end', { withTimezone: true }).notNull(),
    committedTruckCount: integer('committed_truck_count').notNull(),
    acceptanceDeadlineAt: timestamp('acceptance_deadline_at', { withTimezone: true }).notNull(),
    defaultForNonResponders: text('default_for_non_responders', {
      enum: tierOfferDefaultForNonRespondersValues,
    })
      .notNull()
      .default('opt_out'),
    status: text('status', { enum: tierOfferStatusValues }).notNull().default('draft'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('tier_offers_tenant_status_idx')
      .on(t.tenantId, t.status)
      .where(sql`deleted_at IS NULL`),
    tenantEventWindowIdx: index('tier_offers_tenant_event_window_idx')
      .on(t.tenantId, t.eventWindowStart)
      .where(sql`deleted_at IS NULL`),
    tenantTierIdx: index('tier_offers_tenant_tier_idx')
      .on(t.tenantId, t.tierId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type TierOffer = typeof tierOffers.$inferSelect;
export type NewTierOffer = typeof tierOffers.$inferInsert;
