/**
 * accounts — commercial entities that are billed for jobs.
 *
 * Examples: an Agero or Allstate motor club (is_motor_club=true plus a
 * motor_club_network_code that maps to a registered MotorClubProvider in
 * apps/api/src/integrations), or a fleet customer like "Acme Logistics" with
 * net-30 terms.
 *
 * credit_limit and credit_used are tracked here so dispatch can surface
 * "this account is over its limit" before a job is committed. The
 * billing_terms enum drives invoice scheduling.
 *
 * COI = Certificate of Insurance. Required for certain commercial accounts;
 * coi_expires_at + coi_document_url let dispatch refuse work when a COI
 * has lapsed.
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

export const billingTermsValues = [
  'net_15',
  'net_30',
  'net_45',
  'net_60',
  'cod',
  'prepay',
] as const;
export type BillingTerm = (typeof billingTermsValues)[number];

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    accountNumber: text('account_number'),

    billingTerms: text('billing_terms', { enum: billingTermsValues }).notNull().default('net_30'),
    creditLimit: numeric('credit_limit', { precision: 12, scale: 2 }),
    creditUsed: numeric('credit_used', { precision: 12, scale: 2 }).notNull().default('0'),

    billingAddress: jsonb('billing_address'),
    billingEmail: text('billing_email'),
    billingPhone: text('billing_phone'),

    apContactName: text('ap_contact_name'),
    apContactEmail: text('ap_contact_email'),

    coiRequired: boolean('coi_required').notNull().default(false),
    coiExpiresAt: date('coi_expires_at'),
    coiDocumentUrl: text('coi_document_url'),

    defaultRateSheetId: uuid('default_rate_sheet_id'),

    isMotorClub: boolean('is_motor_club').notNull().default(false),
    motorClubNetworkCode: text('motor_club_network_code'),

    active: boolean('active').notNull().default(true),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    tenantNameUnique: uniqueIndex('accounts_tenant_name_unique').on(t.tenantId, t.name),
    tenantActiveIdx: index('accounts_tenant_active_idx').on(t.tenantId, t.active),
    motorClubIdx: index('accounts_motor_club_idx').on(t.tenantId, t.isMotorClub),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
