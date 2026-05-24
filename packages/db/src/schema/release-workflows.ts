/**
 * release_workflows — the gated 4-step vehicle-release wizard (Yard
 * Management, Session 54). State machine + gates live in the service; the
 * columns are the audit record of what was checked/collected. One LIVE
 * (non-cancelled) workflow per impound record. Defined in
 * packages/db/sql/0051_yard_management.sql.
 */
import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { impoundRecords } from './impound-records';
import { tenants } from './tenants';
import { users } from './users';

export const releaseWorkflowStatusValues = [
  'initiated',
  'id_verified',
  'lienholder_authorized',
  'payment_collected',
  'gate_released',
  'cancelled',
] as const;
export type ReleaseWorkflowStatus = (typeof releaseWorkflowStatusValues)[number];

export const releaseWorkflowPayerIdTypeValues = [
  'drivers_license',
  'state_id',
  'passport',
  'military_id',
  'other',
] as const;
export type ReleaseWorkflowPayerIdType = (typeof releaseWorkflowPayerIdTypeValues)[number];

export const releaseWorkflowPaymentMethodValues = [
  'cash',
  'card',
  'check',
  'ach',
  'waived',
  'other',
] as const;
export type ReleaseWorkflowPaymentMethod = (typeof releaseWorkflowPaymentMethodValues)[number];

export const releaseWorkflows = pgTable(
  'release_workflows',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    impoundId: uuid('impound_id')
      .notNull()
      .references(() => impoundRecords.id, { onDelete: 'cascade' }),
    status: text('status', { enum: releaseWorkflowStatusValues }).notNull().default('initiated'),
    initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().defaultNow(),
    initiatedByUserId: uuid('initiated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    payerName: text('payer_name'),
    payerIdType: text('payer_id_type', { enum: releaseWorkflowPayerIdTypeValues }),
    payerIdLast4: text('payer_id_last4'),
    lienholderAuthRef: text('lienholder_auth_ref'),
    paymentAmountCents: bigint('payment_amount_cents', { mode: 'number' }),
    paymentMethod: text('payment_method', { enum: releaseWorkflowPaymentMethodValues }),
    gateReleasedByUserId: uuid('gate_released_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    gateReleasedAt: timestamp('gate_released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('release_workflows_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export type ReleaseWorkflow = typeof releaseWorkflows.$inferSelect;
export type NewReleaseWorkflow = typeof releaseWorkflows.$inferInsert;
