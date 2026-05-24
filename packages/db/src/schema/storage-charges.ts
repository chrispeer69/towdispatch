/**
 * storage_charges — the rate-card-driven daily storage ledger, one row per
 * (impound_record, charge_date) (Yard Management, Session 54). The partial
 * unique on (impound_id, charge_date) makes a re-run a no-op (cannot
 * double-charge). INDEPENDENT of the S22 impound_fees ledger — see
 * SESSION_54_DECISIONS.md. Defined in packages/db/sql/0051_yard_management.sql.
 */
import { date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { impoundRecords } from './impound-records';
import { storageBillingRuns } from './storage-billing-runs';
import { storageRateCards, storageVehicleClassValues } from './storage-rate-cards';
import { tenants } from './tenants';

export const storageCharges = pgTable(
  'storage_charges',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    impoundId: uuid('impound_id')
      .notNull()
      .references(() => impoundRecords.id, { onDelete: 'cascade' }),
    chargeDate: date('charge_date').notNull(),
    vehicleClass: text('vehicle_class', { enum: storageVehicleClassValues }).notNull(),
    rateCardId: uuid('rate_card_id').references(() => storageRateCards.id, {
      onDelete: 'set null',
    }),
    amountCents: integer('amount_cents').notNull(),
    billingRunId: uuid('billing_run_id').references(() => storageBillingRuns.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantImpoundIdx: index('storage_charges_tenant_impound_idx').on(t.tenantId, t.impoundId),
    billingRunIdx: index('storage_charges_billing_run_idx').on(t.billingRunId),
  }),
);

export type StorageCharge = typeof storageCharges.$inferSelect;
export type NewStorageCharge = typeof storageCharges.$inferInsert;
