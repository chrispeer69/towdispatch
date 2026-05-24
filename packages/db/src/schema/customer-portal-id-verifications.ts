import { sql } from 'drizzle-orm';
import { date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customerPortalSessions } from './customer-portal-sessions';
import { tenants } from './tenants';

export const customerPortalIdTypeValues = ['drivers_license', 'passport', 'state_id'] as const;
export const customerPortalVerifiedByValues = [
  'self_attested',
  'stripe_identity',
  'operator_at_gate',
] as const;

/**
 * Self-attested ID for a self-serve session (Session 55). `idLast4` is the
 * AES-256-GCM-encrypted last 4 of the ID — never the full number, never an SSN.
 * The gate operator physically re-verifies at pickup.
 */
export const customerPortalIdVerifications = pgTable(
  'customer_portal_id_verifications',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => customerPortalSessions.id, { onDelete: 'cascade' }),
    idType: text('id_type', { enum: customerPortalIdTypeValues }).notNull(),
    idLast4: text('id_last4').notNull(),
    fullName: text('full_name').notNull(),
    dob: date('dob'),
    verifiedBy: text('verified_by', { enum: customerPortalVerifiedByValues })
      .notNull()
      .default('self_attested'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    sessionIdx: index('customer_portal_id_verifications_session_idx')
      .on(t.tenantId, t.sessionId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type CustomerPortalIdVerification = typeof customerPortalIdVerifications.$inferSelect;
export type NewCustomerPortalIdVerification = typeof customerPortalIdVerifications.$inferInsert;
