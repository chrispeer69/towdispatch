/**
 * jurisdictions — country + state/province reference lookup (Canada
 * Expansion, Session 47).
 *
 * GLOBAL reference data: NOT tenant-scoped, no RLS. Seeded in
 * packages/db/sql/0047_canada_expansion.sql with Canada's 10 provinces and
 * 3 territories. name_fr carries the Canadian-French label for fr-CA
 * surfaces. US states stay app-side (usStateSchema) for now and can be
 * backfilled here later.
 */
import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const jurisdictionTypeValues = ['state', 'province', 'territory'] as const;
export type JurisdictionType = (typeof jurisdictionTypeValues)[number];

export const jurisdictions = pgTable(
  'jurisdictions',
  {
    country: text('country').notNull(),
    code: text('code').notNull(),
    nameEn: text('name_en').notNull(),
    nameFr: text('name_fr').notNull(),
    type: text('type', { enum: jurisdictionTypeValues }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.country, t.code] }),
  }),
);

export type JurisdictionRow = typeof jurisdictions.$inferSelect;
export type NewJurisdictionRow = typeof jurisdictions.$inferInsert;
