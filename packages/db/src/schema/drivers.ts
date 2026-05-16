/**
 * drivers — the people who run the wreckers.
 *
 * Session 5 introduced the table with the basics: name, contact, CDL class,
 * hire date, employee number, optional FK back to users. Session 8 extends
 * the row into a full driver profile:
 *   - employment_status (active | on_leave | terminated) supplements the
 *     existing `active` boolean. We keep `active` because dispatch reads it
 *     hot — `employment_status != 'active'` is the audit-trail-of-record but
 *     a boolean lookup is cheaper for the roster path.
 *   - license fields: license_number, license_state, license_expires_at
 *   - medical card and drug-test cadence
 *   - jsonb motor-club credentials (per-network IDs / rep IDs)
 *   - text[] training certifications with a fixed allow-list (CHECK in SQL).
 *   - assigned yard (FK to locations — Session 9 stub)
 *   - assigned commission rule (FK to commission_rules — Session 14 stub).
 *     Both FKs are nullable; the referenced tables don't exist yet.
 *
 * Soft-delete shaped, audited, FORCE RLS in 0010 / extended in 0011.
 */
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const driverCdlClassValues = ['none', 'A', 'B', 'C', 'non_cdl'] as const;
export type DriverCdlClass = (typeof driverCdlClassValues)[number];

export const driverEmploymentStatusValues = ['active', 'on_leave', 'terminated'] as const;
export type DriverEmploymentStatus = (typeof driverEmploymentStatusValues)[number];

/**
 * Allow-listed training certifications. Adding new values is a migration
 * because the SQL CHECK constraint enumerates them. Driver app + reporting
 * both branch on these literals so silent additions would be unsafe.
 */
export const driverCertificationValues = [
  'WreckMaster_4_5',
  'WreckMaster_6_7',
  'TIM',
  'Tesla_certified',
  'OSHA_10',
  'CPR',
] as const;
export type DriverCertification = (typeof driverCertificationValues)[number];

export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Optional FK to the auth user. A driver may not have an app login (yet). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    employeeNumber: text('employee_number'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    /** Display name preferred by the driver (e.g. "Mike" instead of "Michael"). */
    preferredName: text('preferred_name'),
    phone: text('phone'),
    email: text('email'),

    cdlClass: text('cdl_class', { enum: driverCdlClassValues }).notNull().default('none'),
    cdlExpiresAt: date('cdl_expires_at'),

    /** State-issued license number — separate from CDL. */
    licenseNumber: text('license_number'),
    /** Two-letter US state code (CHECK in SQL). */
    licenseState: text('license_state'),
    licenseExpiresAt: date('license_expires_at'),

    /** DOT medical certification expiry. Required for any commercial driver. */
    medicalCardExpiresAt: date('medical_card_expires_at'),
    drugTestLastAt: date('drug_test_last_at'),
    roadTestCompletedAt: date('road_test_completed_at'),

    /**
     * Per-network credentials used when accepting motor-club calls. Shape is
     * intentionally open: { agero?: { repId, dispatcherId }, urgently?: {...} }.
     * Validated at the Zod layer when populated.
     */
    motorClubCredentials: jsonb('motor_club_credentials'),

    /**
     * Allow-listed training certifications (text[]; values constrained by
     * fn_driver_certifications_allowed in SQL). Order is not significant.
     */
    certifications: text('certifications').array(),

    hiredAt: date('hired_at'),
    employmentStatus: text('employment_status', { enum: driverEmploymentStatusValues })
      .notNull()
      .default('active'),

    /**
     * Forward FK to locations(id). The locations table does not exist yet
     * (Session 9). The column is created without an FK constraint and will
     * be linked when locations ships. We accept the unenforced reference for
     * now to avoid an unused constraint or a circular migration order.
     */
    assignedYardId: uuid('assigned_yard_id'),
    /**
     * Forward FK to commission_rules(id) — Session 14. Same treatment as
     * assigned_yard_id: column today, constraint when the table arrives.
     */
    commissionRuleId: uuid('commission_rule_id'),

    /**
     * Default percentage of an invoice line this driver earns as commission.
     * Range 0..100 (enforced by a CHECK in 0025). NULL means "no default
     * set" — dispatcher enters a value manually at invoice review time.
     * Read by invoice build (4) as the per-line starting value.
     */
    defaultCommissionPct: numeric('default_commission_pct', { precision: 5, scale: 2 }),

    notes: text('notes'),

    /**
     * Hot-path roster filter. Stays in sync with employment_status via an
     * application-level write — keeping both lets dispatch do an indexed
     * boolean scan without joining or computing.
     */
    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantActiveIdx: index('drivers_tenant_active_idx').on(t.tenantId, t.active),
    tenantNameIdx: index('drivers_tenant_name_idx').on(t.tenantId, t.lastName, t.firstName),
    tenantUserIdx: index('drivers_tenant_user_idx').on(t.tenantId, t.userId),
    tenantEmpStatusIdx: index('drivers_tenant_emp_status_idx').on(t.tenantId, t.employmentStatus),
    tenantYardIdx: index('drivers_tenant_yard_idx').on(t.tenantId, t.assignedYardId),
    tenantEmpNumIdx: uniqueIndex('drivers_tenant_employee_number_unique').on(
      t.tenantId,
      t.employeeNumber,
    ),
  }),
);

export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
