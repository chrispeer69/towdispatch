/**
 * sso_login_audit — append-only forensic trail of every SSO login attempt
 * (Session 38). userId is nullable (a failed/denied attempt may never
 * resolve to a user); subject keeps the IdP nameID/sub regardless. Rows are
 * immutable history — no updated_at, no soft-delete, no fn_audit_log
 * trigger (this table IS the audit record).
 *
 * Defined in packages/db/sql/0048_enterprise_sso.sql.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ssoConnections } from './sso-connections';
import { tenants } from './tenants';
import { users } from './users';

export const ssoLoginOutcomeValues = ['success', 'fail', 'denied'] as const;
export type SsoLoginOutcome = (typeof ssoLoginOutcomeValues)[number];

export const ssoLoginAudit = pgTable(
  'sso_login_audit',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id').references(() => ssoConnections.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    provider: text('provider'),
    outcome: text('outcome', { enum: ssoLoginOutcomeValues }).notNull(),
    failureReason: text('failure_reason'),
    subject: text('subject'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantTimeIdx: index('sso_login_audit_tenant_time_idx').on(t.tenantId, t.occurredAt),
  }),
);

export type SsoLoginAudit = typeof ssoLoginAudit.$inferSelect;
export type NewSsoLoginAudit = typeof ssoLoginAudit.$inferInsert;
