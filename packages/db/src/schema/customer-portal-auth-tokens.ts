/**
 * customer_portal_auth_tokens — email-verification + password-reset tokens
 * for portal users (Session 32).
 *
 * Mirrors the staff email-verification / password-reset token pattern: the
 * plaintext token is emailed once, only sha256(token) is stored, tokens are
 * single-use (consumedAt) with a short TTL. `purpose` keeps both flows in a
 * single table.
 *
 * Defined in packages/db/sql/0037_white_label_portal.sql.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { customerPortalUsers } from './customer-portal-users';
import { tenants } from './tenants';

export const customerPortalAuthTokenPurposeValues = [
  'email_verification',
  'password_reset',
] as const;
export type CustomerPortalAuthTokenPurpose = (typeof customerPortalAuthTokenPurposeValues)[number];

export const customerPortalAuthTokens = pgTable(
  'customer_portal_auth_tokens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    portalUserId: uuid('portal_user_id')
      .notNull()
      .references(() => customerPortalUsers.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: customerPortalAuthTokenPurposeValues }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashIdx: index('customer_portal_auth_tokens_hash_idx').on(t.tokenHash),
    userIdx: index('customer_portal_auth_tokens_user_idx').on(t.tenantId, t.portalUserId),
  }),
);

export type CustomerPortalAuthToken = typeof customerPortalAuthTokens.$inferSelect;
export type NewCustomerPortalAuthToken = typeof customerPortalAuthTokens.$inferInsert;
