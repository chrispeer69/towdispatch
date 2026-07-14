/**
 * trucks — the company's wreckers.
 *
 * Session 5 introduced unit_number, truck_type (capability class), basic
 * VIN/make/model, and an in_service boolean. Session 8 grows the row into
 * a full asset record:
 *   - capacity_class supplements truck_type. truck_type stays as the
 *     dispatch-facing label (light_duty/flatbed/wheel_lift/...) — these are
 *     equipment shapes — while capacity_class enumerates the rated tow
 *     weight (light/medium/heavy/HD). A flatbed can be light or medium.
 *   - GVWR (gross vehicle weight rating) in pounds.
 *   - fuel_type (gas/diesel/EV/hybrid) for cost reporting + EV-rated job
 *     matching once Tesla certifications come online.
 *   - equipment text[] (allow-listed by SQL CHECK) — what the truck
 *     actually has bolted on (flatbed, wheel_lift, dollies, jump_pack...).
 *   - registration / insurance / IFTA / IRP regulatory tracking.
 *   - motor-club certification flags (tesla_certified, aaa_flatbed,
 *     heavy_duty_capable).
 *   - odometer + odometer_updated_at — fed by maintenance records and DVIR
 *     submissions.
 *   - status enum (active|in_maintenance|out_of_service|retired). The
 *     in_service boolean is a derived view (status='active') kept for the
 *     dispatch hot path.
 *
 * unit_number remains the human-friendly identifier ("T-12") and is unique
 * within a tenant for live rows.
 */
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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

export const truckCapacityClassValues = ['light', 'medium', 'heavy', 'HD'] as const;
export type TruckCapacityClass = (typeof truckCapacityClassValues)[number];

/**
 * CADS-canonical duty bucket (Capacity-Aware Dispatch Signaling).
 * capacity_class predates it and stays for fleet reporting; duty_class
 * collapses HD into heavy and is NOT NULL so the capacity compute path
 * never branches on missing data. Backfilled in 0052.
 */
export const truckDutyClassValues = ['light', 'medium', 'heavy'] as const;
export type TruckDutyClass = (typeof truckDutyClassValues)[number];

export const truckFuelTypeValues = ['gas', 'diesel', 'EV', 'hybrid'] as const;
export type TruckFuelType = (typeof truckFuelTypeValues)[number];

export const truckStatusValues = ['active', 'in_maintenance', 'out_of_service', 'retired'] as const;
export type TruckStatus = (typeof truckStatusValues)[number];

/**
 * Allow-listed equipment kinds. SQL CHECK constraint enforces that every
 * value of trucks.equipment is one of these. Adding to the list is a
 * migration so reporting and dispatch matching stay aware.
 */
export const truckEquipmentValues = [
  'flatbed',
  'wheel_lift',
  'wrecker_light',
  'wrecker_medium',
  'wrecker_heavy',
  'integrated',
  'sliding_rotator',
  'dollies',
  'skates',
  'jump_pack',
  'winch',
] as const;
export type TruckEquipment = (typeof truckEquipmentValues)[number];

export const trucks = pgTable(
  'trucks',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    unitNumber: text('unit_number').notNull(),
    truckType: text('truck_type', { enum: truckTypeValues }).notNull().default('light_duty'),

    /**
     * Year stored as text in Session 5 to dodge schema fights with mixed
     * types — we keep it for compatibility but the API layer constrains it
     * to a 4-digit numeric string.
     */
    year: text('year'),
    make: text('make'),
    model: text('model'),
    plate: text('plate'),
    plateState: text('plate_state'),
    vin: text('vin'),

    /** Rated tow-weight bucket — distinct from truck_type's equipment shape. */
    capacityClass: text('capacity_class', { enum: truckCapacityClassValues }),
    /** CADS duty bucket — see truckDutyClassValues doc above. */
    dutyClass: text('duty_class', { enum: truckDutyClassValues }).notNull().default('light'),
    /** Heavy-duty rotator flag (sliding rotator boom); heavy class only. */
    isRotator: boolean('is_rotator').notNull().default(false),
    /** Gross vehicle weight rating, pounds. */
    gvwrLbs: integer('gvwr_lbs'),
    fuelType: text('fuel_type', { enum: truckFuelTypeValues }),

    /** What's bolted on. Allow-listed by SQL CHECK; Zod mirrors the list. */
    equipment: text('equipment').array(),

    registrationExpiresAt: date('registration_expires_at'),
    insuranceExpiresAt: date('insurance_expires_at'),
    iftaLicense: text('ifta_license'),
    irpAccount: text('irp_account'),

    /** Motor-club / OEM certification flags. */
    teslaCertified: boolean('tesla_certified').notNull().default(false),
    aaaFlatbed: boolean('aaa_flatbed').notNull().default(false),
    heavyDutyCapable: boolean('heavy_duty_capable').notNull().default(false),

    /** Last-known odometer, miles. bigint guards against the 32-bit ceiling on heavy-duty trucks. */
    currentOdometer: bigint('current_odometer', { mode: 'number' }),
    odometerUpdatedAt: timestamp('odometer_updated_at', { withTimezone: true }),

    status: text('status', { enum: truckStatusValues }).notNull().default('active'),

    /**
     * Hot-path flag — kept in sync with status='active' by the service layer
     * so dispatch doesn't have to compare to a string. Out-of-service flag —
     * overrides any active shift assignment for dispatch.
     */
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
    tenantStatusIdx: index('trucks_tenant_status_idx').on(t.tenantId, t.status),
    tenantInServiceIdx: index('trucks_tenant_in_service_idx').on(t.tenantId, t.inService),
    tenantCapacityIdx: index('trucks_tenant_capacity_idx').on(t.tenantId, t.capacityClass),
  }),
);

export type Truck = typeof trucks.$inferSelect;
export type NewTruck = typeof trucks.$inferInsert;
