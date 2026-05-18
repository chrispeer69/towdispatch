/**
 * job_evidence — photo / video / signature attachments tied to a job.
 *
 * Binary lives in S3 (s3_key); this row tracks the upload lifecycle and
 * is the audited handle. Cross-tenant consistency trigger in the SQL
 * migration enforces that job_id's tenant matches the row's tenant_id —
 * the FK alone wouldn't catch an attacker passing a foreign job_id with
 * their own tenant_id.
 *
 * Defined in packages/db/sql/0033_driver_experience.sql.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { driverShifts } from './driver-shifts';
import { drivers } from './drivers';
import { jobs } from './jobs';
import { tenants } from './tenants';
import { users } from './users';

export const jobEvidenceKindValues = [
  'photo_pickup',
  'photo_dropoff',
  'photo_damage',
  'photo_hookup',
  'photo_release',
  'photo_other',
  'video_walkaround',
  'video_other',
  'signature_customer',
  'signature_driver',
  'document_scan',
  'other',
] as const;
export type JobEvidenceKind = (typeof jobEvidenceKindValues)[number];

export const jobEvidenceUploadStatusValues = ['pending', 'uploaded', 'failed'] as const;
export type JobEvidenceUploadStatus = (typeof jobEvidenceUploadStatusValues)[number];

export const jobEvidence = pgTable(
  'job_evidence',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    shiftId: uuid('shift_id').references(() => driverShifts.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: jobEvidenceKindValues }).notNull(),
    s3Key: text('s3_key').notNull(),
    contentType: text('content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    durationSeconds: numeric('duration_seconds', { precision: 8, scale: 2 }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    uploadStatus: text('upload_status', { enum: jobEvidenceUploadStatusValues })
      .notNull()
      .default('pending'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantS3KeyUnique: uniqueIndex('job_evidence_tenant_s3_key_unique')
      .on(t.tenantId, t.s3Key)
      .where(sql`deleted_at IS NULL`),
    tenantJobCreatedIdx: index('job_evidence_tenant_job_created_idx').on(
      t.tenantId,
      t.jobId,
      t.createdAt,
    ),
    tenantDriverCreatedIdx: index('job_evidence_tenant_driver_created_idx').on(
      t.tenantId,
      t.driverId,
      t.createdAt,
    ),
    tenantKindIdx: index('job_evidence_tenant_kind_idx').on(t.tenantId, t.kind, t.createdAt),
    tenantUploadStatusIdx: index('job_evidence_tenant_upload_status_idx').on(
      t.tenantId,
      t.uploadStatus,
    ),
  }),
);

export type JobEvidence = typeof jobEvidence.$inferSelect;
export type NewJobEvidence = typeof jobEvidence.$inferInsert;
