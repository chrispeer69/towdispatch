/**
 * tenants is the root of the multi-tenancy graph. Every tenant-scoped table
 * carries a tenant_id FK to this table. RLS for `tenants` itself is
 * "you may read your own row" — defined in sql/0003_rls_policies.sql.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tenantStatus = ['active', 'suspended', 'cancelled'] as const;
export type TenantStatus = (typeof tenantStatus)[number];

export const stripeAccountStatusValues = [
  'none',
  'pending',
  'active',
  'restricted',
  'rejected',
] as const;
export type StripeAccountStatus = (typeof stripeAccountStatusValues)[number];

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    slug: text('slug').notNull(),
    /**
     * 6-digit numeric company code used by drivers on /driver/login
     * (frictionless tenant-bind without exposing the URL slug). Auto-
     * assigned on insert by the fn_tenants_assign_company_code trigger.
     * Backfilled for existing tenants by migration 0034.
     */
    companyCode: text('company_code')
      .notNull()
      .$defaultFn(() => ''),
    name: text('name').notNull(),
    status: text('status', { enum: tenantStatus }).notNull().default('active'),
    settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),

    // Session 11 — Stripe Connect.
    stripeAccountId: text('stripe_account_id'),
    stripeAccountStatus: text('stripe_account_status', { enum: stripeAccountStatusValues })
      .notNull()
      .default('none'),
    stripeChargesEnabled: boolean('stripe_charges_enabled').notNull().default(false),
    stripePayoutsEnabled: boolean('stripe_payouts_enabled').notNull().default(false),
    /**
     * Platform margin in basis points (1 bp = 0.01%). Default 30 bps = 0.3%.
     * Capped at 1000 bps = 10% by sql/0014 check constraint.
     */
    platformMarginBps: integer('platform_margin_bps').notNull().default(30),

    /**
     * Multi-Region (Session 44). Tenant's preferred serving region
     * (e.g. 'us-east' | 'us-west'). Nullable; no DB CHECK by design
     * (forward-compat for >2 regions) — values validated app-side. Routing on
     * it is deferred to edge/DNS (owner-side); the API only validates/echoes
     * the X-Preferred-Region header. See migration 0039.
     */
    preferredRegion: text('preferred_region'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    slugIdx: uniqueIndex('tenants_slug_unique').on(t.slug),
    companyCodeIdx: uniqueIndex('tenants_company_code_idx').on(t.companyCode),
  }),
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
