/**
 * Audit Log query contracts (Session 31 — SOC 2 Type I).
 *
 * Backs GET /admin/audit-log, the admin/auditor-facing reader over the
 * append-only audit_log table. The table itself is written exclusively by
 * the fn_audit_log() trigger (see packages/db/sql/0004_audit_trigger.sql);
 * there is no write contract here — audit_log is read-only to the app.
 *
 * Tenant scope: every query runs inside the caller's tenant transaction, so
 * RLS confines results to the caller's own tenant. There is no cross-tenant
 * filter — that would require a platform-superadmin role we do not have.
 *
 * Redaction: before_state / after_state are full row snapshots and can carry
 * secrets (password hashes, token hashes, MFA secrets). The service redacts
 * those fields before serialization (see admin.service.ts → redactState);
 * the DTO therefore types them as opaque record maps.
 */
import { z } from 'zod';

// Mirrors audit_log.action CHECK / enum in packages/db/src/schema/audit-log.ts
export const auditActionValues = ['INSERT', 'UPDATE', 'DELETE'] as const;
export type AuditActionValue = (typeof auditActionValues)[number];

/**
 * Query filters for GET /admin/audit-log. All filters are optional and AND
 * together. Dates are ISO-8601; `from`/`to` bound created_at inclusively.
 * Pagination is page/perPage (perPage capped at 200 to protect the DB).
 */
export const auditLogQuerySchema = z
  .object({
    actorId: z.string().uuid().optional(),
    resourceType: z
      .string()
      .trim()
      .min(1)
      .max(63) // Postgres identifier limit; resource_type is a table name
      .regex(/^[a-z_][a-z0-9_]*$/, 'resourceType must be a snake_case table name')
      .optional(),
    resourceId: z.string().uuid().optional(),
    action: z.enum(auditActionValues).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    page: z.coerce.number().int().positive().default(1),
    perPage: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface AuditLogEntryDto {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: AuditActionValue;
  resourceType: string;
  resourceId: string | null;
  /** Row snapshot BEFORE the change (UPDATE/DELETE), with secret fields redacted. */
  beforeState: Record<string, unknown> | null;
  /** Row snapshot AFTER the change (INSERT/UPDATE), with secret fields redacted. */
  afterState: Record<string, unknown> | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface PaginatedAuditLog {
  data: AuditLogEntryDto[];
  page: number;
  perPage: number;
  total: number;
}
