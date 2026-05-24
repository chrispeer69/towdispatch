/**
 * repo_required_notices — pre/post-repo, personal-property, redemption, and
 * sheriff notices issued for a repossession case (Repo Compliance, Session 50).
 *
 * S49 DEFERRAL: `repo_case_id` is `uuid NOT NULL` with NO foreign key — the
 * S49 repo_cases table is not on master yet. The FK + the parent-tenant-
 * consistency trigger (the analogue of fn_lien_child_tenant_consistency) land
 * with S49. Each notice therefore carries its own `state` so the engine / cron
 * / PDF renderer can resolve per-state rules without the parent case. See
 * SESSION_50_DECISIONS.md (D0).
 *
 * Idempotency: a case carries only ONE *pending* (unanswered) notice of a
 * given (notice_type, recipient_role) at a time — the partial unique index in
 * the migration. Once response_received_at is set, the row drops out of the
 * index so a follow-up notice of the same type can be issued.
 *
 * Defined in packages/db/sql/0051_repo_compliance.sql.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const repoNoticeTypeValues = [
  'pre_repo_notice',
  'post_repo_notice',
  'personal_property_notice',
  'redemption_notice',
  'sheriff_notice',
] as const;
export type RepoNoticeType = (typeof repoNoticeTypeValues)[number];

export const repoRecipientRoleValues = [
  'debtor',
  'secondary_contact',
  'lienholder',
  'sheriff',
] as const;
export type RepoRecipientRole = (typeof repoRecipientRoleValues)[number];

export const repoDeliveryMethodValues = ['certified', 'publication', 'email', 'posted'] as const;
export type RepoDeliveryMethod = (typeof repoDeliveryMethodValues)[number];

export const repoRequiredNotices = pgTable(
  'repo_required_notices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    // No FK to repo_cases — that table is S49's (not on master). See header.
    repoCaseId: uuid('repo_case_id').notNull(),
    state: text('state').notNull(),
    noticeType: text('notice_type', { enum: repoNoticeTypeValues }).notNull(),
    recipientRole: text('recipient_role', { enum: repoRecipientRoleValues }).notNull(),
    recipientName: text('recipient_name'),
    recipientAddress: text('recipient_address'),
    statuteCitation: text('statute_citation').notNull(),
    deliveryMethod: text('delivery_method', { enum: repoDeliveryMethodValues }).notNull(),
    certifiedTrackingNo: text('certified_tracking_no'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    responseDueAt: timestamp('response_due_at', { withTimezone: true }),
    responseReceivedAt: timestamp('response_received_at', { withTimezone: true }),
    responseNotes: text('response_notes'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantCaseIdx: index('repo_required_notices_tenant_case_idx')
      .on(t.tenantId, t.repoCaseId)
      .where(sql`deleted_at IS NULL`),
    overdueIdx: index('repo_required_notices_overdue_idx')
      .on(t.responseDueAt)
      .where(sql`response_received_at IS NULL AND deleted_at IS NULL`),
  }),
);

export type RepoRequiredNotice = typeof repoRequiredNotices.$inferSelect;
export type NewRepoRequiredNotice = typeof repoRequiredNotices.$inferInsert;
