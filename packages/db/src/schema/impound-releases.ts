/**
 * impound_releases — the documented release of an impound record
 * (Impound & Storage, Session 22). One live release per record (partial
 * unique index). The documentation gate (id_verified +
 * ownership_doc_verified, zero active holds) is enforced in the service
 * layer; these columns are the audit record of what was checked at
 * release. Defined in packages/db/sql/0036_impound_storage.sql.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { impoundRecords } from './impound-records';
import { tenants } from './tenants';
import { users } from './users';

export const impoundReleaseToTypeValues = [
  'owner',
  'agent',
  'insurance',
  'lienholder',
  'salvage',
  'other',
] as const;
export type ImpoundReleaseToType = (typeof impoundReleaseToTypeValues)[number];

export const impoundReleasePaymentMethodValues = [
  'cash',
  'card',
  'check',
  'ach',
  'waived',
  'other',
] as const;
export type ImpoundReleasePaymentMethod = (typeof impoundReleasePaymentMethodValues)[number];

export const impoundReleases = pgTable(
  'impound_releases',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    impoundRecordId: uuid('impound_record_id')
      .notNull()
      .references(() => impoundRecords.id, { onDelete: 'cascade' }),
    releasedToName: text('released_to_name').notNull(),
    releasedToType: text('released_to_type', { enum: impoundReleaseToTypeValues }).notNull(),
    idVerified: boolean('id_verified').notNull().default(false),
    ownershipDocVerified: boolean('ownership_doc_verified').notNull().default(false),
    authorizationDocRef: text('authorization_doc_ref'),
    paymentReceivedCents: bigint('payment_received_cents', { mode: 'number' }).notNull().default(0),
    paymentMethod: text('payment_method', { enum: impoundReleasePaymentMethodValues }),
    totalFeesCents: bigint('total_fees_cents', { mode: 'number' }).notNull().default(0),
    releasedBy: uuid('released_by').references(() => users.id, { onDelete: 'set null' }),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantRecordIdx: index('impound_releases_tenant_record_idx')
      .on(t.tenantId, t.impoundRecordId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type ImpoundRelease = typeof impoundReleases.$inferSelect;
export type NewImpoundRelease = typeof impoundReleases.$inferInsert;
