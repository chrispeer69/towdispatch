/**
 * tier_offer_recipients — per-account-manager acceptance ledger for a
 * tier offer (Moat #3: Tier Offer Composer, Session 1).
 *
 * One row per recipient per offer. magic_link_token is the per-recipient
 * signed token embedded in the accept/decline URL; Session 1 stores the
 * string only — token issuance/validation lands in Session 2.
 *
 * Cross-tenant consistency: a BEFORE INSERT/UPDATE trigger in the SQL
 * migration enforces that offer_id's tenant AND account_id's tenant
 * (when non-null) match this row's tenant_id — the FK alone wouldn't
 * catch an attacker passing a foreign offer_id/account_id under their
 * own tenant_id GUC.
 *
 * Defined in packages/db/sql/0034_tier_offer_composer.sql.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { tenants } from './tenants';
import { tierOffers } from './tier-offers';

export const tierOfferRecipientStatusValues = [
  'pending_send',
  'sent',
  'delivered',
  'bounced',
  'opened',
  'accepted',
  'declined',
  'expired',
  'revoked',
] as const;
export type TierOfferRecipientStatus = (typeof tierOfferRecipientStatusValues)[number];

export const tierOfferRecipients = pgTable(
  'tier_offer_recipients',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => tierOffers.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    recipientName: text('recipient_name').notNull(),
    recipientRole: text('recipient_role'),
    recipientEmail: text('recipient_email').notNull(),
    recipientPhone: text('recipient_phone'),
    magicLinkToken: text('magic_link_token').notNull(),
    magicLinkExpiresAt: timestamp('magic_link_expires_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: tierOfferRecipientStatusValues })
      .notNull()
      .default('pending_send'),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    emailDeliveredAt: timestamp('email_delivered_at', { withTimezone: true }),
    emailOpenedAt: timestamp('email_opened_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    responseIp: text('response_ip'),
    responseUserAgent: text('response_user_agent'),
    declineReason: text('decline_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    magicLinkTokenUnique: uniqueIndex('tier_offer_recipients_magic_link_token_unique').on(
      t.magicLinkToken,
    ),
    offerEmailUnique: uniqueIndex('tier_offer_recipients_offer_email_unique')
      .on(t.offerId, t.recipientEmail)
      .where(sql`deleted_at IS NULL`),
    tenantStatusIdx: index('tier_offer_recipients_tenant_status_idx')
      .on(t.tenantId, t.status)
      .where(sql`deleted_at IS NULL`),
    offerStatusIdx: index('tier_offer_recipients_offer_status_idx')
      .on(t.offerId, t.status)
      .where(sql`deleted_at IS NULL`),
    tenantExpiryActiveIdx: index('tier_offer_recipients_tenant_expiry_active_idx')
      .on(t.tenantId, t.magicLinkExpiresAt)
      .where(sql`status IN ('sent', 'delivered', 'opened') AND deleted_at IS NULL`),
  }),
);

export type TierOfferRecipient = typeof tierOfferRecipients.$inferSelect;
export type NewTierOfferRecipient = typeof tierOfferRecipients.$inferInsert;
