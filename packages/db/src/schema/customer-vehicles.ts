/**
 * customer_vehicles — many-to-many between customers and vehicles.
 *
 * Cars change owners; companies have multiple drivers using a fleet vehicle.
 * Tracking the relationship over time lets us answer "who was the owner on
 * <date>?" later — even if right now we only need the live mapping.
 *
 * is_primary marks the canonical pairing surfaced in autocomplete and lookup
 * UI; only one row per (vehicle, live) should be flagged primary in
 * practice (enforced softly at the application layer for now).
 */
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customers } from './customers';
import { tenants } from './tenants';
import { vehicles } from './vehicles';

export const customerVehicleRelationshipValues = ['owner', 'driver', 'authorized_user'] as const;
export type CustomerVehicleRelationship = (typeof customerVehicleRelationshipValues)[number];

export const customerVehicles = pgTable(
  'customer_vehicles',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    relationship: text('relationship', {
      enum: customerVehicleRelationshipValues,
    })
      .notNull()
      .default('owner'),
    isPrimary: boolean('is_primary').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // Live (customer, vehicle) pair must be unique per tenant — enforced via
    // partial unique index in sql/0006.
    tenantCustomerIdx: index('customer_vehicles_tenant_customer_idx').on(t.tenantId, t.customerId),
    tenantVehicleIdx: index('customer_vehicles_tenant_vehicle_idx').on(t.tenantId, t.vehicleId),
  }),
);

export type CustomerVehicle = typeof customerVehicles.$inferSelect;
export type NewCustomerVehicle = typeof customerVehicles.$inferInsert;
