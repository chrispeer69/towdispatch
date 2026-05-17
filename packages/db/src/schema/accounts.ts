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
  integer,
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

/**
 * Account-level contract payment terms (Admin Settings build 6). Distinct
 * from billing_terms above — billing_terms describes the operator's
 * invoice scheduling enum, contract terms describe what the customer
 * agreed to in their account contract. Net-30 is the most common default
 * across motor club paperwork.
 */
export const accountPaymentTermsValues = ['net_15', 'net_30', 'net_45', 'due_on_receipt'] as const;
export type AccountPaymentTerm = (typeof accountPaymentTermsValues)[number];

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

    /**
     * Contract terms surfaced on the Account Rate Cards admin page
     * (Admin Settings build 6). Distinct from billing_terms (operator's
     * invoice-scheduling default) — these describe what the customer
     * agreed to. Dispatcher prompts driven by these flags ship later.
     */
    paymentTerms: text('payment_terms', { enum: accountPaymentTermsValues })
      .notNull()
      .default('net_30'),
    requiresPhotoBeforeBilling: boolean('requires_photo_before_billing').notNull().default(false),
    requiresAuthorizationCode: boolean('requires_authorization_code').notNull().default(false),
    goaPolicy: text('goa_policy'),
    slaArrivalMinutes: integer('sla_arrival_minutes'),
    afterHoursBillingAllowed: boolean('after_hours_billing_allowed').notNull().default(true),

    /**
     * Days past invoice posted_date before this account's open invoices are
     * flagged as past due (Build 5 — MOAT #7 RED ALERT). NULL = inherit the
     * tenant-wide default from tenants.settings.default_delinquency_days
     * (which itself defaults to 30 if unset). Cash customers use a separate
     * tenant default (cash_customer_delinquency_days, default 7).
     */
    delinquencyDaysThreshold: integer('delinquency_days_threshold'),

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
