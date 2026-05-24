/**
 * repo_condition_photos — body-damage documentation captured by the driver
 * on recovery (Repo Workflow Session 49). Eight standard slots (matching
 * industry repo condition-report sheets) plus 'other'; the slot is advisory
 * (a case can carry several of one type). Defined in
 * packages/db/sql/0051_repo_workflow.sql.
 */
import { sql } from 'drizzle-orm';
import { doublePrecision, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { repoCases } from './repo-cases';
import { tenants } from './tenants';

export const repoConditionPhotoTypeValues = [
  'exterior_front',
  'exterior_rear',
  'exterior_left',
  'exterior_right',
  'interior',
  'odometer',
  'damage',
  'vin_plate',
  'other',
] as const;
export type RepoConditionPhotoType = (typeof repoConditionPhotoTypeValues)[number];

export const repoConditionPhotos = pgTable(
  'repo_condition_photos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    repoCaseId: uuid('repo_case_id')
      .notNull()
      .references(() => repoCases.id, { onDelete: 'cascade' }),
    photoUrl: text('photo_url').notNull(),
    photoType: text('photo_type', { enum: repoConditionPhotoTypeValues }).notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
    gpsLat: doublePrecision('gps_lat'),
    gpsLng: doublePrecision('gps_lng'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCaseIdx: index('repo_condition_photos_tenant_case_idx')
      .on(t.tenantId, t.repoCaseId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type RepoConditionPhoto = typeof repoConditionPhotos.$inferSelect;
export type NewRepoConditionPhoto = typeof repoConditionPhotos.$inferInsert;
