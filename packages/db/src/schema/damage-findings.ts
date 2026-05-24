/**
 * damage_findings — per-area damage findings produced by an analysis
 * (Photo Damage Analysis, Session 42).
 *
 * confidence_pct is the model's confidence as a whole percent (0-100).
 * bounding_box is the optional normalised region on a source photo.
 *
 * Operator override model: operators ANNOTATE findings, never delete them
 * (evidentiary integrity). operator_severity overrides the model severity,
 * is_dismissed flags a rejected false-positive. Comparison logic uses the
 * effective severity (operator_severity ?? severity) and skips dismissed
 * findings.
 *
 * Defined in packages/db/sql/0041_damage_analysis.sql.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { damageAnalyses } from './damage-analyses';
import { tenants } from './tenants';
import { users } from './users';

export const damageAreaValues = [
  'front_bumper',
  'rear_bumper',
  'driver_door',
  'passenger_door',
  'hood',
  'roof',
  'trunk',
  'wheels',
  'windshield',
  'other',
] as const;
export type DamageArea = (typeof damageAreaValues)[number];

export const damageSeverityValues = ['none', 'minor', 'moderate', 'severe'] as const;
export type DamageSeverity = (typeof damageSeverityValues)[number];

export const damageFindings = pgTable(
  'damage_findings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => damageAnalyses.id, { onDelete: 'cascade' }),
    area: text('area', { enum: damageAreaValues }).notNull(),
    severity: text('severity', { enum: damageSeverityValues }).notNull(),
    confidencePct: integer('confidence_pct').notNull().default(0),
    description: text('description'),
    boundingBox: jsonb('bounding_box'),
    operatorSeverity: text('operator_severity', { enum: damageSeverityValues }),
    operatorNote: text('operator_note'),
    isDismissed: boolean('is_dismissed').notNull().default(false),
    overriddenBy: uuid('overridden_by').references(() => users.id, { onDelete: 'set null' }),
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantAnalysisIdx: index('damage_findings_tenant_analysis_idx')
      .on(t.tenantId, t.analysisId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type DamageFinding = typeof damageFindings.$inferSelect;
export type NewDamageFinding = typeof damageFindings.$inferInsert;
