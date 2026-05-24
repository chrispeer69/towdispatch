/**
 * dot_carrier_profile — one row per tenant: the carrier's FMCSA identity
 * (USDOT / MC number), operating authority type, operating classifications,
 * and most-recent safety rating / audit date (Full DOT Compliance,
 * Session 37). Partial-unique on tenant_id (one live profile per tenant).
 * Defined in packages/db/sql/0040_dot_compliance.sql.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const dotCarrierTypeValues = ['authorized_for_hire', 'private', 'exempt'] as const;
export type DotCarrierType = (typeof dotCarrierTypeValues)[number];

export const dotSafetyRatingValues = [
  'satisfactory',
  'conditional',
  'unsatisfactory',
  'unrated',
] as const;
export type DotSafetyRating = (typeof dotSafetyRatingValues)[number];

export const dotCarrierProfile = pgTable(
  'dot_carrier_profile',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    usdotNumber: text('usdot_number'),
    mcNumber: text('mc_number'),
    legalName: text('legal_name').notNull(),
    dbaName: text('dba_name'),
    carrierType: text('carrier_type', { enum: dotCarrierTypeValues })
      .notNull()
      .default('authorized_for_hire'),
    operatingClassification: jsonb('operating_classification')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    safetyRating: text('safety_rating', { enum: dotSafetyRatingValues }),
    lastAuditedAt: timestamp('last_audited_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('dot_carrier_profile_tenant_idx')
      .on(t.tenantId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DotCarrierProfile = typeof dotCarrierProfile.$inferSelect;
export type NewDotCarrierProfile = typeof dotCarrierProfile.$inferInsert;
