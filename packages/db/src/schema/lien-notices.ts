/**
 * lien_notices — owner / lienholder / publication / DMV notices issued for
 * a lien case (Lien Processing, Session 23).
 *
 * Idempotency: a case carries only ONE *pending* (unanswered) notice of a
 * given (notice_type, recipient_role) at a time — the partial unique index
 * in the migration. Once response_received_at is set, the row drops out of
 * the index so a follow-up notice of the same type can be issued.
 *
 * Defined in packages/db/sql/0037_lien_processing.sql.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { lienCases } from './lien-cases';
import { tenants } from './tenants';
import { users } from './users';

export const lienNoticeTypeValues = [
  'owner_notice',
  'lienholder_notice',
  'publication_notice',
  'dmv_request',
] as const;
export type LienNoticeType = (typeof lienNoticeTypeValues)[number];

export const lienRecipientRoleValues = ['owner', 'lienholder', 'dmv', 'public'] as const;
export type LienRecipientRole = (typeof lienRecipientRoleValues)[number];

export const lienDeliveryMethodValues = [
  'certified_mail',
  'first_class_mail',
  'publication',
  'electronic',
  'in_person',
] as const;
export type LienDeliveryMethod = (typeof lienDeliveryMethodValues)[number];

export const lienNotices = pgTable(
  'lien_notices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    lienCaseId: uuid('lien_case_id')
      .notNull()
      .references(() => lienCases.id, { onDelete: 'cascade' }),
    noticeType: text('notice_type', { enum: lienNoticeTypeValues }).notNull(),
    recipientRole: text('recipient_role', { enum: lienRecipientRoleValues }).notNull(),
    recipientName: text('recipient_name'),
    recipientAddress: text('recipient_address'),
    deliveryMethod: text('delivery_method', { enum: lienDeliveryMethodValues }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    certifiedTrackingNo: text('certified_tracking_no'),
    responseReceivedAt: timestamp('response_received_at', { withTimezone: true }),
    responseNotes: text('response_notes'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCaseIdx: index('lien_notices_tenant_case_idx')
      .on(t.tenantId, t.lienCaseId)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type LienNotice = typeof lienNotices.$inferSelect;
export type NewLienNotice = typeof lienNotices.$inferInsert;
