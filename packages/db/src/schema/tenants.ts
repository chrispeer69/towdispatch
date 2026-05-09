/**
 * tenants is the root of the multi-tenancy graph. Every tenant-scoped table
 * carries a tenant_id FK to this table. RLS for `tenants` itself is
 * "you may read your own row" — defined in sql/0003_rls_policies.sql.
 */
import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const tenantStatus = ['active', 'suspended', 'cancelled'] as const;
export type TenantStatus = (typeof tenantStatus)[number];

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: tenantStatus }).notNull().default('active'),
    settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    slugIdx: uniqueIndex('tenants_slug_unique').on(t.slug),
  }),
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
