/**
 * hd_rate_sheets — tenant heavy-duty rate cards (Heavy-Duty Specialist,
 * Session 36). All money is cents-per-unit; the two multipliers are
 * numeric(4,2) (Drizzle surfaces them as strings — the service parses to
 * number at the boundary). Tenant-scoped reference data: RLS + tenant FK
 * are the isolation guarantee. Defined in packages/db/sql/0040_heavy_duty.sql.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const hdRateSheets = pgTable(
  'hd_rate_sheets',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    hourlyRateCents: integer('hourly_rate_cents').notNull().default(0),
    hookupFeeCents: integer('hookup_fee_cents').notNull().default(0),
    winchingPerHrCents: integer('winching_per_hr_cents').notNull().default(0),
    recoveryPerHrCents: integer('recovery_per_hr_cents').notNull().default(0),
    rotatorPerHrCents: integer('rotator_per_hr_cents').notNull().default(0),
    mileageLoadedCents: integer('mileage_loaded_cents').notNull().default(0),
    mileageDeadheadCents: integer('mileage_deadhead_cents').notNull().default(0),
    afterHoursMultiplier: numeric('after_hours_multiplier', { precision: 4, scale: 2 })
      .notNull()
      .default('1.00'),
    holidayMultiplier: numeric('holiday_multiplier', { precision: 4, scale: 2 })
      .notNull()
      .default('1.00'),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantNameUnique: uniqueIndex('hd_rate_sheets_tenant_name_unique')
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`deleted_at IS NULL`),
    tenantActiveIdx: index('hd_rate_sheets_tenant_active_idx')
      .on(t.tenantId, t.isActive)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type HdRateSheet = typeof hdRateSheets.$inferSelect;
export type NewHdRateSheet = typeof hdRateSheets.$inferInsert;
