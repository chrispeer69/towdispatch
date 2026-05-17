/**
 * red_alert_sends — every Monday 6:00 AM RED ALERT past-due email send.
 * Build 5 MOAT #7. The headline feature: owners + admins (+ opted-in
 * users) receive a weekly Monday-morning A/R pulse listing every account
 * with past-due invoices, sorted by total balance.
 *
 * Uniqueness: (tenant_id, alert_for_date) unique WHERE status='sent'
 * guarantees we never double-send the same Monday even if the hourly
 * cron ticks twice or the server restarts mid-Monday.
 *
 * FORCE RLS, audit trigger, tenant_id NOT NULL. SQL: sql/0027.
 */
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const redAlertSendStatusValues = ['queued', 'sent', 'failed'] as const;
export type RedAlertSendStatus = (typeof redAlertSendStatusValues)[number];

/**
 * Per-account row shape captured in red_alert_sends.breakdown_json at
 * send time. Stored as a snapshot so the email and the audit row never
 * diverge — even if invoices are paid or written off later.
 */
export interface RedAlertBreakdownAccount {
  accountId: string;
  accountName: string;
  invoiceCount: number;
  totalPastDueCents: number;
  oldestDaysOverdue: number;
}

export interface RedAlertBreakdown {
  accounts: RedAlertBreakdownAccount[];
}

export const redAlertSends = pgTable(
  'red_alert_sends',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Monday calendar date in the tenant's local timezone. Drives the
     * uniqueness guard. We don't use sentAt for the guard because the
     * server's hourly tick may fire after midnight UTC and we'd double-
     * send for tenants whose Monday spans two UTC dates.
     */
    alertForDate: date('alert_for_date').notNull(),

    sentTo: text('sent_to').array().notNull().default([]),
    invoiceCount: integer('invoice_count').notNull().default(0),
    accountCount: integer('account_count').notNull().default(0),
    totalPastDueCents: bigint('total_past_due_cents', { mode: 'number' }).notNull().default(0),

    breakdownJson: jsonb('breakdown_json').notNull().default({}),

    status: text('status', { enum: redAlertSendStatusValues }).notNull().default('queued'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantSentAtIdx: index('red_alert_sends_tenant_sent_at_idx').on(t.tenantId, t.sentAt),
    tenantStatusIdx: index('red_alert_sends_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export type RedAlertSend = typeof redAlertSends.$inferSelect;
export type NewRedAlertSend = typeof redAlertSends.$inferInsert;
