/**
 * trucks — the company's wreckers. Each truck has a rated capability
 * (light_duty / medium_duty / heavy_duty / flatbed / wheel_lift) that
 * dispatch uses to match jobs to trucks.
 *
 * trucks are tenant-scoped, soft-deleted, and audited. unit_number is the
 * human-friendly identifier ("T-12") and is unique within a tenant for live
 * rows.
 */
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const truckTypeValues = [
  'light_duty',
  'medium_duty',
  'heavy_duty',
  'flatbed',
  'wheel_lift',
  'service',
  'other',
] as const;
export type TruckType = (typeof truckTypeValues)[number];

export const trucks = pgTable(
  'trucks',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    unitNumber: text('unit_number').notNull(),
    truckType: text('truck_type', { enum: truckTypeValues }).notNull().default('light_duty'),

    year: text('year'),
    make: text('make'),
    model: text('model'),
    plate: text('plate'),
    plateState: text('plate_state'),
    vin: text('vin'),

    /** Out-of-service flag — overrides any active shift assignment for dispatch. */
    inService: boolean('in_service').notNull().default(true),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantUnitUnique: uniqueIndex('trucks_tenant_unit_number_unique').on(t.tenantId, t.unitNumber),
    tenantTypeIdx: index('trucks_tenant_type_idx').on(t.tenantId, t.truckType),
    tenantInServiceIdx: index('trucks_tenant_in_service_idx').on(t.tenantId, t.inService),
  }),
);

export type Truck = typeof trucks.$inferSelect;
export type NewTruck = typeof trucks.$inferInsert;
