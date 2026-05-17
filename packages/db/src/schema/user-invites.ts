/**
 * user_invites — pending invitations to join a tenant.
 *
 * Created by an OWNER/ADMIN via POST /users/invite. The recipient gets a
 * link with a plain token; the hash lands here. Consumed_at flips when the
 * recipient calls POST /users/accept-invite, at which point a row is
 * inserted into users and the invite becomes a historical record.
 *
 * The unique constraint on (tenant_id, lower(email)) WHERE consumed_at IS
 * NULL is enforced at the database level via a partial index (see
 * packages/db/sql/0026_user_invites_and_yard_scoping.sql) so two pending
 * invites to the same email simultaneously is impossible.
 */
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { userRoles, users } from './users';

export const userInvites = pgTable(
  'user_invites',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    role: text('role', { enum: userRoles }).notNull(),
    yardIds: uuid('yard_ids').array(),
    fullName: text('full_name'),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex('user_invites_token_hash_unique').on(t.tokenHash),
    tenantPendingIdx: index('user_invites_tenant_pending_idx').on(t.tenantId, t.createdAt),
  }),
);

export type UserInvite = typeof userInvites.$inferSelect;
export type NewUserInvite = typeof userInvites.$inferInsert;
