/**
 * vehicles — every vehicle that can be the OBJECT of a tow job.
 *
 * VIN is the canonical identifier when present. Plate+state is a fallback
 * lookup key that's a soft hash of the world's plate registry — uniqueness
 * is NOT enforced because the same plate can re-issue, and tenants commonly
 * service vehicles from out of state.
 *
 * vehicle_class drives equipment selection in dispatch (a flatbed for an EV;
 * a heavy wrecker for a commercial truck). is_low_clearance / drivetrain /
 * is_electric are operational flags surfaced to drivers at dispatch time.
 *
 * default_customer_id is "the typical owner" — convenience for autofill,
 * not authoritative. Real ownership/relationship lives in customer_vehicles.
 */
import {
  boolean,
  char,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { customers } from './customers';
import { tenants } from './tenants';
import { users } from './users';

export const vehicleClassValues = [
  'light_duty',
  'medium_duty',
  'heavy_duty',
  'motorcycle',
  'commercial',
  'rv',
  'unknown',
] as const;
export type VehicleClass = (typeof vehicleClassValues)[number];

export const drivetrainValues = ['FWD', 'RWD', 'AWD', '4WD', 'unknown'] as const;
export type Drivetrain = (typeof drivetrainValues)[number];

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    vin: char('vin', { length: 17 }),
    plate: text('plate'),
    plateState: char('plate_state', { length: 2 }),

    year: smallint('year'),
    make: text('make'),
    model: text('model'),
    trim: text('trim'),
    color: text('color'),

    bodyClass: text('body_class'),
    vehicleClass: text('vehicle_class', { enum: vehicleClassValues }).notNull().default('unknown'),

    drivetrain: text('drivetrain', { enum: drivetrainValues }).notNull().default('unknown'),
    isElectric: boolean('is_electric').notNull().default(false),
    isLowClearance: boolean('is_low_clearance').notNull().default(false),

    specialInstructions: text('special_instructions'),

    defaultCustomerId: uuid('default_customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    // VIN uniqueness within a tenant when present is enforced via partial
    // unique index in sql/0006.
    tenantVinIdx: index('vehicles_tenant_vin_idx').on(t.tenantId, t.vin),
    tenantPlateIdx: index('vehicles_tenant_plate_idx').on(t.tenantId, t.plate, t.plateState),
    tenantYmmIdx: index('vehicles_tenant_ymm_idx').on(t.tenantId, t.make, t.model, t.year),
    tenantClassIdx: index('vehicles_tenant_class_idx').on(t.tenantId, t.vehicleClass),
  }),
);

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
