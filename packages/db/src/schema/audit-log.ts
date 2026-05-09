/**
 * audit_log is append-only by policy. Writes happen exclusively through the
 * fn_audit_log() trigger defined in sql/0004_audit_trigger.sql so that direct
 * DB modifications by ops still produce an audit row.
 *
 * RLS for audit_log restricts SELECT to current tenant. Inserts come from the
 * trigger executing as table owner with SECURITY DEFINER, bypassing RLS.
 */
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const auditActions = ['INSERT', 'UPDATE', 'DELETE'] as const;
export type AuditAction = (typeof auditActions)[number];

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    actorId: uuid('actor_id'),
    action: text('action', { enum: auditActions }).notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),

    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),

    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
    resourceIdx: index('audit_log_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
    actorIdx: index('audit_log_actor_idx').on(t.tenantId, t.actorId),
  }),
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
