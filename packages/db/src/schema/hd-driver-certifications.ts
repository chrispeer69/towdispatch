/**
 * hd_driver_certifications — per-driver heavy-duty certifications
 * (Heavy-Duty Specialist, Session 36). One live row per (driver,
 * cert_type); a renewal supersedes the prior live row. expires_at drives
 * the eligibility gate + the expiry-roster report + the daily expiry cron.
 * Defined in packages/db/sql/0039_heavy_duty.sql.
 */
import { sql } from 'drizzle-orm';
import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { tenants } from './tenants';
import { users } from './users';

export const hdDriverCertTypeValues = [
  'hd_operator',
  'rotator',
  'hazmat',
  'cdl_a',
  'cdl_b',
] as const;
export type HdDriverCertType = (typeof hdDriverCertTypeValues)[number];

export const hdDriverCertifications = pgTable(
  'hd_driver_certifications',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    certType: text('cert_type', { enum: hdDriverCertTypeValues }).notNull(),
    issuedAt: date('issued_at'),
    expiresAt: date('expires_at'),
    docKey: text('doc_key'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    driverTypeUnique: uniqueIndex('hd_driver_certifications_driver_type_unique')
      .on(t.driverId, t.certType)
      .where(sql`deleted_at IS NULL`),
    tenantDriverIdx: index('hd_driver_certifications_tenant_driver_idx')
      .on(t.tenantId, t.driverId)
      .where(sql`deleted_at IS NULL`),
    expiryIdx: index('hd_driver_certifications_expiry_idx')
      .on(t.expiresAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type HdDriverCertification = typeof hdDriverCertifications.$inferSelect;
export type NewHdDriverCertification = typeof hdDriverCertifications.$inferInsert;
