/**
 * customers — every person whose vehicle is being towed.
 *
 * Two flavors:
 *   - cash:    walk-in / one-off, billed at time of service. Default.
 *   - account: employee/contact of a commercial account (FK to accounts.id).
 *
 * Motor clubs are NOT customers — they are the dispatch source. A motor-club
 * call still creates a `cash` (or `account`) customer for the vehicle owner.
 * The motor club itself is an `accounts` row with is_motor_club=true.
 *
 * Phone is the natural lookup key in dispatch (the caller is on the phone).
 * The (tenant_id, phone) unique partial index allows multiple soft-deleted
 * rows to share a number, while only one live row per tenant per phone exists.
 *
 * created_via tracks the entry point: 'manual' (someone typed it in) or
 * 'auto_intake' (findOrCreateByContact, called from the future Session 4
 * call intake flow). The audit_log captures this in after_state.
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { tenants } from './tenants';
import { users } from './users';

// Motor clubs are accounts, not customers — the actual customer is the
// person whose vehicle is being towed. Was ['cash', 'account',
// 'motor_club_member'] in 0006; the value was reclassified to 'cash' and
// dropped in 0007.
export const customerTypeValues = ['cash', 'account'] as const;
export type CustomerType = (typeof customerTypeValues)[number];

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    type: text('type', { enum: customerTypeValues }).notNull().default('cash'),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),

    billingAddress: jsonb('billing_address'),

    // Session 4 cleanup: home address split into discrete columns so we can
    // index zip and feed mileage / service-area lookups without parsing JSON.
    homeAddressStreet: text('home_address_street'),
    homeAddressCity: text('home_address_city'),
    homeAddressState: text('home_address_state'),
    homeAddressZip: text('home_address_zip'),

    // Secondary contact: most often the customer's spouse or shop manager —
    // captured during intake so the second leg of a call can reach someone.
    secondaryContactName: text('secondary_contact_name'),
    secondaryContactPhone: text('secondary_contact_phone'),

    // Whether the customer downloaded the Convini app — Session 5 will use
    // this to suppress the in-call invite when they already have it.
    conviniAppDownloaded: boolean('convini_app_downloaded').notNull().default(false),

    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),

    taxExempt: boolean('tax_exempt').notNull().default(false),
    taxExemptCertificateUrl: text('tax_exempt_certificate_url'),

    notes: text('notes'),

    createdVia: text('created_via', { enum: ['manual', 'auto_intake'] as const })
      .notNull()
      .default('manual'),

    defaultRateSheetId: uuid('default_rate_sheet_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    // Phone uniqueness is enforced via a partial unique index defined in
    // sql/0006 (Drizzle's index() doesn't model WHERE clauses cleanly).
    tenantNameIdx: index('customers_tenant_name_idx').on(t.tenantId, t.name),
    tenantPhoneIdx: index('customers_tenant_phone_idx').on(t.tenantId, t.phone),
    tenantEmailIdx: index('customers_tenant_email_idx').on(t.tenantId, t.email),
    tenantAccountIdx: index('customers_tenant_account_idx').on(t.tenantId, t.accountId),
    tenantTypeIdx: index('customers_tenant_type_idx').on(t.tenantId, t.type),
    // Session 4 cleanup: zip index — Session 5+ filters jobs/customers by
    // service-area zip ranges, so this index pays for itself fast.
    tenantZipIdx: index('customers_tenant_zip_idx').on(t.tenantId, t.homeAddressZip),
  }),
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
