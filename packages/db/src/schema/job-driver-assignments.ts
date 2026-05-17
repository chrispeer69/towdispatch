/**
 * job_driver_assignments — many-to-many (job, driver) recording the full
 * crew that worked a job.
 *
 * jobs.assigned_driver_id models the *primary* driver only; this table
 * extends that to support multi-driver jobs whose invoices need to split
 * commissions across more than one person. The service layer writes a
 * "primary" row mirroring jobs.assigned_driver_id and additional
 * "support" rows for the rest of the crew. Dispatchers can edit the
 * roster via the Invoice Review screen before posting.
 *
 * Invariants enforced in 0026:
 *   * UNIQUE (job_id, driver_id) — a driver appears at most once per job.
 *   * Tenant consistency trigger blocks cross-tenant FK injection.
 */
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { jobs } from './jobs';
import { tenants } from './tenants';

export const jobDriverAssignments = pgTable(
  'job_driver_assignments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),

    /** Freeform v1 — "primary", "support", "trainee". Dispatcher-editable. */
    role: text('role'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    jobDriverUnique: uniqueIndex('job_driver_assignments_job_driver_unique').on(
      t.jobId,
      t.driverId,
    ),
    tenantJobIdx: index('job_driver_assignments_tenant_job_idx').on(t.tenantId, t.jobId),
    tenantDriverIdx: index('job_driver_assignments_tenant_driver_idx').on(t.tenantId, t.driverId),
  }),
);

export type JobDriverAssignment = typeof jobDriverAssignments.$inferSelect;
export type NewJobDriverAssignment = typeof jobDriverAssignments.$inferInsert;
