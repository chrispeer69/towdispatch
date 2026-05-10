/**
 * dvirs — Driver Vehicle Inspection Reports.
 *
 * One row per inspection (pre_trip or post_trip). Defects are stored as a
 * jsonb array of { component, severity, notes, photo_url }. Severity drives
 * the rolled-up status:
 *   no_defects     — empty defects[]
 *   minor          — at least one defect, none out_of_service
 *   out_of_service — at least one out_of_service defect (truck must not roll)
 *
 * The DVIR service layer is responsible for flipping the truck row to
 * status='in_maintenance' when an out_of_service DVIR is submitted. We keep
 * that logic in the application (not a DB trigger) because (a) the audit
 * trail wants the same actor on both rows and (b) future workflows may want
 * to suppress the auto-flip for certain defect classes.
 */
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { tenants } from './tenants';
import { trucks } from './trucks';
import { users } from './users';

export const dvirTypeValues = ['pre_trip', 'post_trip'] as const;
export type DvirType = (typeof dvirTypeValues)[number];

export const dvirStatusValues = ['no_defects', 'minor', 'out_of_service'] as const;
export type DvirStatus = (typeof dvirStatusValues)[number];

export const dvirs = pgTable(
  'dvirs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    truckId: uuid('truck_id')
      .notNull()
      .references(() => trucks.id, { onDelete: 'restrict' }),

    type: text('type', { enum: dvirTypeValues }).notNull(),

    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    odometerReading: bigint('odometer_reading', { mode: 'number' }),

    /**
     * Array of defects. Each entry: { component, severity, notes?, photo_url? }.
     * severity is one of: 'minor' | 'major' | 'out_of_service'. Validated at
     * the Zod layer; stored as opaque jsonb.
     */
    defects: jsonb('defects').notNull().default('[]'),

    status: text('status', { enum: dvirStatusValues }).notNull(),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantDriverIdx: index('dvirs_tenant_driver_idx').on(t.tenantId, t.driverId, t.submittedAt),
    tenantTruckIdx: index('dvirs_tenant_truck_idx').on(t.tenantId, t.truckId, t.submittedAt),
    tenantStatusIdx: index('dvirs_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export type Dvir = typeof dvirs.$inferSelect;
export type NewDvir = typeof dvirs.$inferInsert;
