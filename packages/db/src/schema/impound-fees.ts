/**
 * impound_fees — fee ledger for an impound record (Impound & Storage,
 * Session 22). daily_storage rows are written by the accrual cron (one
 * per record per calendar day, idempotent via the partial unique index
 * on (impound_record_id, accrued_for_date)); manual line items carry a
 * NULL accrued_for_date. Defined in packages/db/sql/0036_impound_storage.sql.
 */
import { sql } from 'drizzle-orm';
import { bigint, date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { impoundRecords } from './impound-records';
import { tenants } from './tenants';
import { users } from './users';

export const impoundFeeTypeValues = [
  'daily_storage',
  'intake',
  'administrative',
  'lien_processing',
  'gate',
  'other',
] as const;
export type ImpoundFeeType = (typeof impoundFeeTypeValues)[number];

export const impoundFees = pgTable(
  'impound_fees',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    impoundRecordId: uuid('impound_record_id')
      .notNull()
      .references(() => impoundRecords.id, { onDelete: 'cascade' }),
    feeType: text('fee_type', { enum: impoundFeeTypeValues }).notNull(),
    description: text('description'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    accruedForDate: date('accrued_for_date'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantRecordIdx: index('impound_fees_tenant_record_idx')
      .on(t.tenantId, t.impoundRecordId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type ImpoundFee = typeof impoundFees.$inferSelect;
export type NewImpoundFee = typeof impoundFees.$inferInsert;
