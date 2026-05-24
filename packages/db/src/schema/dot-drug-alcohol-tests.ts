/**
 * dot_drug_alcohol_tests — drug & alcohol program test records (49 CFR
 * Part 382; Full DOT Compliance, Session 37). Log-only — no consortium /
 * C-TPA integration this session. doc_key references the stored
 * chain-of-custody document in object storage. Defined in
 * packages/db/sql/0040_dot_compliance.sql.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { tenants } from './tenants';
import { users } from './users';

export const dotDrugAlcoholTestTypeValues = [
  'pre_employment',
  'random',
  'reasonable_suspicion',
  'post_accident',
  'return_to_duty',
  'follow_up',
] as const;
export type DotDrugAlcoholTestType = (typeof dotDrugAlcoholTestTypeValues)[number];

export const dotDrugAlcoholResultValues = ['negative', 'positive', 'refused', 'cancelled'] as const;
export type DotDrugAlcoholResult = (typeof dotDrugAlcoholResultValues)[number];

export const dotDrugAlcoholTests = pgTable(
  'dot_drug_alcohol_tests',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    testType: text('test_type', { enum: dotDrugAlcoholTestTypeValues }).notNull(),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull(),
    result: text('result', { enum: dotDrugAlcoholResultValues }).notNull(),
    lab: text('lab'),
    docKey: text('doc_key'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantDriverIdx: index('dot_drug_alcohol_tests_tenant_driver_idx')
      .on(t.tenantId, t.driverId, t.collectedAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DotDrugAlcoholTest = typeof dotDrugAlcoholTests.$inferSelect;
export type NewDotDrugAlcoholTest = typeof dotDrugAlcoholTests.$inferInsert;
