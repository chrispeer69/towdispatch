/**
 * tax_rules — jurisdiction tax-rate reference (Canada Expansion, Session 47).
 *
 * GLOBAL reference data: NOT tenant-scoped, no RLS (statutory rates are public
 * and identical for every operator in a jurisdiction — same convention as
 * lien_state_rules). A nullable tenant_override_id is reserved so a future
 * session can let a tenant pin a custom rate; v1 seeds only base rows. Because
 * the table is non-RLS, any future override insertion must be scoped to the
 * current tenant in the application layer.
 *
 * rate_bps is stored as a numeric STRING by Drizzle (Postgres numeric), not a
 * JS number, to keep exactness — Quebec's QST is 9.975% = 997.5 basis points,
 * which is not an integer. The tax engine parses it with Number() at compute
 * time. Defined in packages/db/sql/0047_canada_expansion.sql.
 */
import {
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const taxTypeValues = ['sales_tax', 'gst', 'hst', 'pst', 'qst'] as const;
export type TaxType = (typeof taxTypeValues)[number];

export const taxRules = pgTable(
  'tax_rules',
  {
    id: uuid('id').primaryKey(),
    country: text('country').notNull(),
    region: text('region'),
    taxType: text('tax_type', { enum: taxTypeValues }).notNull(),
    nameEn: text('name_en').notNull(),
    nameFr: text('name_fr').notNull(),
    rateBps: numeric('rate_bps', { precision: 9, scale: 4 }).notNull(),
    displayOrder: smallint('display_order').notNull().default(0),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    tenantOverrideId: uuid('tenant_override_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index('tax_rules_lookup_idx').on(t.country, t.region),
    baseUnique: uniqueIndex('tax_rules_base_unique').on(t.country, t.region, t.taxType),
  }),
);

export type TaxRuleRow = typeof taxRules.$inferSelect;
export type NewTaxRuleRow = typeof taxRules.$inferInsert;
