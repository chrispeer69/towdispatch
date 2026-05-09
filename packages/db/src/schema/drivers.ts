/**
 * drivers — the people who actually run the wrecker. A driver is more than a
 * `users.role = 'driver'` row: each driver carries operational metadata
 * (CDL class, employee number, hire date, hourly rate) that has nothing to
 * do with the auth user. We keep them as a separate table that *optionally*
 * references a user (some drivers may not have an app login at all).
 *
 * One user → at most one driver row. Enforced by a partial unique index
 * (tenant_id, user_id) WHERE deleted_at IS NULL in 0009.
 */
import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const driverCdlClassValues = ['none', 'A', 'B', 'C'] as const;
export type DriverCdlClass = (typeof driverCdlClassValues)[number];

export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Optional FK to the auth user. A driver may not have a login (yet). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    employeeNumber: text('employee_number'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    phone: text('phone'),
    email: text('email'),

    cdlClass: text('cdl_class', { enum: driverCdlClassValues }).notNull().default('none'),
    cdlExpiresAt: date('cdl_expires_at'),

    hiredAt: date('hired_at'),
    /** Free-form: light-duty, heavy-duty, both. UI uses this for the roster filter. */
    notes: text('notes'),

    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantActiveIdx: index('drivers_tenant_active_idx').on(t.tenantId, t.active),
    tenantNameIdx: index('drivers_tenant_name_idx').on(t.tenantId, t.lastName, t.firstName),
    // user_id partial unique enforced via raw SQL (Drizzle index() can't model WHERE).
    tenantUserIdx: index('drivers_tenant_user_idx').on(t.tenantId, t.userId),
    tenantEmpNumIdx: uniqueIndex('drivers_tenant_employee_number_unique').on(
      t.tenantId,
      t.employeeNumber,
    ),
  }),
);

export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
