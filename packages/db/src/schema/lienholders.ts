/**
 * lienholders — the repossession client (bank / credit union / BHPH dealer /
 * forwarder), Repo Workflow Session 49.
 *
 * Tenant-scoped reference (each operator keeps its own lienholder book),
 * unlike the global `jurisdictions` table. `invoice_format` selects the
 * billing-export shape; only 'basic' renders in v1 ('rdn'/'clearplan' are
 * S52 forwarder-adapter stubs). Defined in packages/db/sql/0051_repo_workflow.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const lienholderInvoiceFormatValues = ['basic', 'rdn', 'clearplan'] as const;
export type LienholderInvoiceFormat = (typeof lienholderInvoiceFormatValues)[number];

export const lienholders = pgTable(
  'lienholders',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    billingTerms: jsonb('billing_terms'),
    invoiceFormat: text('invoice_format', { enum: lienholderInvoiceFormatValues })
      .notNull()
      .default('basic'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantActiveIdx: index('lienholders_tenant_active_idx')
      .on(t.tenantId, t.isActive)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type Lienholder = typeof lienholders.$inferSelect;
export type NewLienholder = typeof lienholders.$inferInsert;
