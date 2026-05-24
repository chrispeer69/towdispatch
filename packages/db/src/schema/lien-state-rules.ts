/**
 * lien_state_rules — per-state statutory rule config for the lien-sale
 * workflow (Lien Processing, Session 23).
 *
 * GLOBAL reference data: NOT tenant-scoped, no RLS. The TypeScript module
 * apps/api/src/modules/lien-processing/state-rules.config.ts is the runtime
 * source of truth; this table mirrors it (seeded in the migration) so the
 * values are queryable and a future session can let tenants override.
 *
 * The jsonb shape is kept structurally in sync with `LienStateRules` in
 * @ustowdispatch/shared; it is declared locally here because the db schema
 * package is self-contained (it does not import shared, to keep tsc's
 * rootDir clean — same convention as the impound schema files).
 *
 * Defined in packages/db/sql/0038_lien_processing.sql.
 */
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export interface LienStateRulesJson {
  statute: string;
  dmvLookupWindowDays: number;
  ownerNoticeWaitDays: number;
  lienholderNoticeWaitDays: number;
  publicationRequired: boolean;
  publicationWaitDays: number;
  minDaysToSale: number;
  lowValuePublicationExempt: boolean;
  valueTiers: { lowMaxCents: number; highMinCents: number };
}

export const lienStateRules = pgTable('lien_state_rules', {
  state: text('state').primaryKey(),
  rules: jsonb('rules').$type<LienStateRulesJson>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LienStateRuleRow = typeof lienStateRules.$inferSelect;
export type NewLienStateRuleRow = typeof lienStateRules.$inferInsert;
