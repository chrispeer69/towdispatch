/**
 * dot_driver_qualifications — 1:1 DQ-file EXTENSION of `drivers` (Full DOT
 * Compliance, Session 37). Holds only the DQ-file fields the drivers table
 * lacks: file-review status, signed-employment-application date, and the
 * MVR pull/expiry. License, CDL class, medical-card expiry, drug-test and
 * road-test dates remain on `drivers` (single source of truth) — the
 * dq-completeness logic reads both rows. Defined in
 * packages/db/sql/0040_dot_compliance.sql.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { tenants } from './tenants';
import { users } from './users';

export const dotDqFileStatusValues = ['incomplete', 'complete', 'on_hold'] as const;
export type DotDqFileStatus = (typeof dotDqFileStatusValues)[number];

export const dotDriverQualifications = pgTable(
  'dot_driver_qualifications',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    dqFileStatus: text('dq_file_status', { enum: dotDqFileStatusValues })
      .notNull()
      .default('incomplete'),
    employmentAppSignedAt: timestamp('employment_app_signed_at', { withTimezone: true }),
    mvrPulledAt: timestamp('mvr_pulled_at', { withTimezone: true }),
    mvrExpiresAt: timestamp('mvr_expires_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('dot_driver_qualifications_tenant_idx')
      .on(t.tenantId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DotDriverQualification = typeof dotDriverQualifications.$inferSelect;
export type NewDotDriverQualification = typeof dotDriverQualifications.$inferInsert;
