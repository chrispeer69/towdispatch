/**
 * invoice_line_dynamic_pricing_audit — per-invoice-line tier breakdown
 * (Moat #1). Append-only.
 *
 * Written when an accepted-quote job flows into an invoice line during
 * Invoice Review (Build 4). Lets the Tier Performance Report attribute
 * revenue to specific tiers without scanning the by-tier jsonb on
 * pulse_daily — and supports the "QBO export rolls surcharge into parent
 * line" decision: this audit table holds the per-tier rows so QBO sees a
 * single net price.
 */
import { bigint, index, numeric, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dynamicPricingTiers } from './dynamic-pricing-tiers';
import { tenants } from './tenants';

export const invoiceLineDynamicPricingAudit = pgTable(
  'invoice_line_dynamic_pricing_audit',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    invoiceLineId: uuid('invoice_line_id').notNull(),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => dynamicPricingTiers.id, { onDelete: 'restrict' }),
    multiplier: numeric('multiplier', { precision: 5, scale: 3 }).notNull(),
    contributionCents: bigint('contribution_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantLineIdx: index('ildpa_tenant_line_idx').on(t.tenantId, t.invoiceLineId),
    tenantTierIdx: index('ildpa_tenant_tier_idx').on(t.tenantId, t.tierId),
  }),
);

export type InvoiceLineDynamicPricingAudit = typeof invoiceLineDynamicPricingAudit.$inferSelect;
export type NewInvoiceLineDynamicPricingAudit =
  typeof invoiceLineDynamicPricingAudit.$inferInsert;
