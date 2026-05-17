/**
 * statement_sends — every per-account statement email send leaves a row
 * here. Drives the "Recent Statement Sends" table on /billing/statements
 * and powers the "Resend" affordance.
 *
 * Build 5 (A/R Management). FORCE RLS, audit trigger, tenant_id NOT NULL.
 * Schema mirror of sql/0027_ar_management_and_red_alert.sql.
 */
import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { tenants } from './tenants';
import { users } from './users';

export const statementSendStatusValues = ['queued', 'sent', 'failed'] as const;
export type StatementSendStatus = (typeof statementSendStatusValues)[number];

export const statementSends = pgTable(
  'statement_sends',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),

    sentTo: text('sent_to').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'set null' }),

    pdfUrl: text('pdf_url'),
    dateFrom: timestamp('date_from', { withTimezone: true }),
    dateTo: timestamp('date_to', { withTimezone: true }),
    invoiceCount: integer('invoice_count').notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull().default(0),

    subject: text('subject'),
    bodyPreview: text('body_preview'),

    status: text('status', { enum: statementSendStatusValues }).notNull().default('sent'),
    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantSentAtIdx: index('statement_sends_tenant_sent_at_idx').on(t.tenantId, t.sentAt),
    tenantAccountIdx: index('statement_sends_tenant_account_idx').on(
      t.tenantId,
      t.accountId,
      t.sentAt,
    ),
  }),
);

export type StatementSend = typeof statementSends.$inferSelect;
export type NewStatementSend = typeof statementSends.$inferInsert;
