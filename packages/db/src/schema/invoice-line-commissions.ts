import { sql } from 'drizzle-orm';
/**
 * invoice_line_commissions — per-line, per-driver commission ledger
 * powering the Invoice Review screen (Admin Settings build 4 of 6).
 *
 * Shape: one row per (invoice_line_item, driver). Stores the percent of
 * that line a driver earns, plus the cents amount frozen at POST time.
 * Drafts may carry zero amount_cents — the service layer freezes the
 * value when the invoice transitions out of draft.
 *
 * Invariants enforced in 0026:
 *   * commission_pct ∈ [0, 100]
 *   * Sum of commission_pct across all rows for a given
 *     invoice_line_item_id cannot exceed 100 (BEFORE trigger).
 *   * UNIQUE (invoice_line_item_id, driver_id).
 *
 * Driver visibility wall: this table is never returned to driver-role
 * endpoints. RLS provides the database-side guarantee; the application
 * surface drops commission fields from any driver-facing DTO.
 */
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { invoiceLineItems, invoices } from './invoices';
import { tenants } from './tenants';
import { users } from './users';

export const invoiceLineCommissions = pgTable(
  'invoice_line_commissions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    invoiceLineItemId: uuid('invoice_line_item_id')
      .notNull()
      .references(() => invoiceLineItems.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),

    /** 0..100, two decimals. CHECK enforced by 0026. */
    commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }).notNull(),

    /** Cents frozen at POST time. Draft rows may carry 0 until posted. */
    commissionAmountCents: integer('commission_amount_cents').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    lineDriverUnique: uniqueIndex('invoice_line_commissions_line_driver_unique').on(
      t.invoiceLineItemId,
      t.driverId,
    ),
    tenantInvoiceIdx: index('invoice_line_commissions_tenant_invoice_idx').on(
      t.tenantId,
      t.invoiceId,
    ),
    tenantDriverIdx: index('invoice_line_commissions_tenant_driver_idx').on(t.tenantId, t.driverId),
    tenantLineIdx: index('invoice_line_commissions_tenant_line_idx').on(
      t.tenantId,
      t.invoiceLineItemId,
    ),
    pctRange: check(
      'invoice_line_commissions_pct_range',
      sql`${t.commissionPct} >= 0 AND ${t.commissionPct} <= 100`,
    ),
    amountNonneg: check(
      'invoice_line_commissions_amount_nonneg',
      sql`${t.commissionAmountCents} >= 0`,
    ),
  }),
);

export type InvoiceLineCommission = typeof invoiceLineCommissions.$inferSelect;
export type NewInvoiceLineCommission = typeof invoiceLineCommissions.$inferInsert;
