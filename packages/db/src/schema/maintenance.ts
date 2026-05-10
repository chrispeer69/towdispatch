/**
 * maintenance_schedules + maintenance_records — fleet preventative
 * maintenance.
 *
 * A schedule is a recurring service plan for one truck (e.g. "oil every
 * 5,000 mi", "DOT inspection every 365 days"). schedule_type picks the
 * cadence basis: 'mileage' uses interval_miles + last_serviced_miles,
 * 'time' uses interval_days + last_serviced_at, 'both' tracks the earlier
 * of the two. The next_due_* columns are recomputed on every record insert
 * (no DB trigger — application logic, see MaintenanceService.recordService).
 *
 * Records are the actual events. cost_cents is bigint to dodge the
 * 21M USD ceiling on int4. document_ids is a uuid[] of receipt scans.
 *
 * Status on the schedule:
 *   scheduled — within tolerance, nothing to do
 *   overdue   — past next_due_at OR next_due_miles
 *   completed — terminal, set when the schedule is retired
 */
import { bigint, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { trucks } from './trucks';
import { users } from './users';

export const maintenanceScheduleTypeValues = ['mileage', 'time', 'both'] as const;
export type MaintenanceScheduleType = (typeof maintenanceScheduleTypeValues)[number];

export const maintenanceServiceTypeValues = [
  'oil',
  'tires',
  'brakes',
  'dot_inspection',
  'transmission',
  'coolant',
  'air_filter',
  'fuel_filter',
  'custom',
] as const;
export type MaintenanceServiceType = (typeof maintenanceServiceTypeValues)[number];

export const maintenanceScheduleStatusValues = ['scheduled', 'overdue', 'completed'] as const;
export type MaintenanceScheduleStatus = (typeof maintenanceScheduleStatusValues)[number];

export const maintenanceSchedules = pgTable(
  'maintenance_schedules',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    truckId: uuid('truck_id')
      .notNull()
      .references(() => trucks.id, { onDelete: 'restrict' }),

    scheduleType: text('schedule_type', { enum: maintenanceScheduleTypeValues }).notNull(),
    serviceType: text('service_type', { enum: maintenanceServiceTypeValues }).notNull(),
    /** Free-form when service_type = 'custom'. */
    customLabel: text('custom_label'),

    intervalMiles: integer('interval_miles'),
    intervalDays: integer('interval_days'),

    lastServicedAt: date('last_serviced_at'),
    lastServicedMiles: bigint('last_serviced_miles', { mode: 'number' }),

    nextDueAt: date('next_due_at'),
    nextDueMiles: bigint('next_due_miles', { mode: 'number' }),

    status: text('status', { enum: maintenanceScheduleStatusValues })
      .notNull()
      .default('scheduled'),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantTruckIdx: index('maint_sched_tenant_truck_idx').on(t.tenantId, t.truckId),
    tenantStatusIdx: index('maint_sched_tenant_status_idx').on(t.tenantId, t.status),
    tenantDueAtIdx: index('maint_sched_tenant_due_at_idx').on(t.tenantId, t.nextDueAt),
  }),
);

export type MaintenanceSchedule = typeof maintenanceSchedules.$inferSelect;
export type NewMaintenanceSchedule = typeof maintenanceSchedules.$inferInsert;

export const maintenanceRecords = pgTable(
  'maintenance_records',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    truckId: uuid('truck_id')
      .notNull()
      .references(() => trucks.id, { onDelete: 'restrict' }),
    /** Nullable: ad-hoc maintenance can be recorded without a parent schedule. */
    scheduleId: uuid('schedule_id').references(() => maintenanceSchedules.id, {
      onDelete: 'set null',
    }),

    performedAt: date('performed_at').notNull(),
    performedMiles: bigint('performed_miles', { mode: 'number' }),

    serviceType: text('service_type', { enum: maintenanceServiceTypeValues }).notNull(),
    customLabel: text('custom_label'),

    costCents: bigint('cost_cents', { mode: 'number' }).notNull().default(0),
    vendor: text('vendor'),
    notes: text('notes'),

    /** Receipt / invoice scans. uuid[] referencing documents.id (no FK). */
    documentIds: uuid('document_ids').array(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantTruckIdx: index('maint_rec_tenant_truck_idx').on(t.tenantId, t.truckId, t.performedAt),
    tenantScheduleIdx: index('maint_rec_tenant_sched_idx').on(t.tenantId, t.scheduleId),
  }),
);

export type MaintenanceRecord = typeof maintenanceRecords.$inferSelect;
export type NewMaintenanceRecord = typeof maintenanceRecords.$inferInsert;
