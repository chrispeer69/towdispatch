import { sql } from 'drizzle-orm';
/**
 * users live inside a tenant. tenant_id is RESTRICT on delete because
 * orphaning users would silently widen RLS visibility.
 * email is unique per tenant — same person at two towing companies is allowed.
 *
 * MFA scaffolding (totp_secret_encrypted, mfa_enabled) is in place but the
 * login flow does not enforce it yet — Session 2.0 ships the wiring; making
 * it required is a later switch.
 *
 * Lockout: failed_login_count + locked_until are bumped by AuthService on
 * password failures. Five failures locks for 15 minutes.
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const userRoles = [
  'owner',
  'admin',
  'manager',
  'dispatcher',
  'driver',
  'accounting',
  'auditor',
] as const;
export type UserRole = (typeof userRoles)[number];

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash').notNull(),

    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    phone: text('phone'),

    role: text('role', { enum: userRoles }).notNull().default('dispatcher'),
    isActive: boolean('is_active').notNull().default(true),

    totpSecretEncrypted: text('totp_secret_encrypted'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaEnrolledAt: timestamp('mfa_enrolled_at', { withTimezone: true }),
    mfaRecoveryCodes: text('mfa_recovery_codes').array().notNull().default(sql`'{}'::text[]`),
    mfaFailedAttempts: integer('mfa_failed_attempts').notNull().default(0),
    mfaLockedUntil: timestamp('mfa_locked_until', { withTimezone: true }),

    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    /**
     * Opt-in flag for the Monday 6:00 AM RED ALERT past-due email
     * (Build 5 — MOAT #7). Owners are auto-set to true at creation and
     * by migration backfill. Admins receive by role regardless. Other
     * roles must explicitly opt in via /settings/notifications.
     */
    receivesRedAlert: boolean('receives_red_alert').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantEmailUnique: uniqueIndex('users_tenant_email_unique').on(t.tenantId, t.email),
    tenantIdx: index('users_tenant_idx').on(t.tenantId),
    emailLookupIdx: index('users_email_lookup_idx').on(t.email),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
