import { sql } from 'drizzle-orm';
/**
 * driver_pins — short numeric PIN per driver for in-truck switch flows.
 *
 * One live row per driver (partial unique on (tenant_id, driver_id)
 * WHERE deleted_at IS NULL). pin_hash is bcrypt(plain); the plaintext
 * is never stored or returned. failed_attempts + locked_until back the
 * lockout policy on repeated wrong entries.
 *
 * Defined in packages/db/sql/0033_driver_experience.sql.
 */
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { tenants } from './tenants';
import { users } from './users';

export const driverPins = pgTable(
  'driver_pins',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    pinHash: text('pin_hash').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantDriverLiveUnique: uniqueIndex('driver_pins_tenant_driver_live_unique')
      .on(t.tenantId, t.driverId)
      .where(sql`deleted_at IS NULL`),
    tenantDriverIdx: index('driver_pins_tenant_driver_idx').on(t.tenantId, t.driverId),
  }),
);

export type DriverPin = typeof driverPins.$inferSelect;
export type NewDriverPin = typeof driverPins.$inferInsert;
