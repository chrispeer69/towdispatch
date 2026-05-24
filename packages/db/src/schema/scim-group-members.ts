/**
 * scim_group_members — membership edges between scim_groups and users
 * (Session 38). Both the group and the user must belong to the edge's
 * tenant (enforced by a cross-tenant consistency trigger in the migration).
 *
 * Defined in packages/db/sql/0048_enterprise_sso.sql.
 */
import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { scimGroups } from './scim-groups';
import { tenants } from './tenants';
import { users } from './users';

export const scimGroupMembers = pgTable(
  'scim_group_members',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => scimGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantGroupIdx: index('scim_group_members_tenant_group_idx').on(t.tenantId, t.groupId),
  }),
);

export type ScimGroupMember = typeof scimGroupMembers.$inferSelect;
export type NewScimGroupMember = typeof scimGroupMembers.$inferInsert;
