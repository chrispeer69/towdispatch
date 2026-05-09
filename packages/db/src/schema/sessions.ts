/**
 * sessions stores hashed refresh tokens. Access tokens are stateless (JWT);
 * refresh tokens are opaque, hashed at rest, and rotated on every use.
 * Revocation is per-row (set revoked_at) — the access token TTL bounds blast radius.
 *
 * lastUsedAt updates on every successful refresh so we can surface stale
 * sessions in account settings.
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotatedFromId: uuid('rotated_from_id'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantUserIdx: index('sessions_tenant_user_idx').on(t.tenantId, t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
