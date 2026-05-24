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

/**
 * Audit-log anomaly surface (Session 40 — SOC 2 Type II monitoring effectiveness).
 *
 * Backs GET /admin/audit-log/anomalies — an advisory read over the same tenant-
 * scoped audit_log (plus the users table for failed-login counters) that
 * surfaces three operating-effectiveness signals an auditor / operator watches:
 * admin deletes, off-hours admin activity, and failed-login spikes. It flags; it
 * does not block. Every query runs in the caller's tenant transaction, so RLS
 * confines results to the caller's own tenant (same posture as the reader).
 *
 * Off-hours band is expressed as UTC hours [start, end); when start > end (e.g.
 * 22→6) the band wraps midnight. Defaults: 22:00–06:00 UTC.
 */
export const auditAnomaliesQuerySchema = z
  .object({
    windowDays: z.coerce.number().int().min(1).max(90).default(7),
    offHoursStartUtc: z.coerce.number().int().min(0).max(23).default(22),
    offHoursEndUtc: z.coerce.number().int().min(0).max(23).default(6),
    failedLoginThreshold: z.coerce.number().int().min(1).max(100).default(5),
    /** Max rows scanned per signal; protects the DB. One extra is read to detect truncation. */
    limit: z.coerce.number().int().min(1).max(1000).default(200),
  })
  .strict();
export type AuditAnomaliesQuery = z.infer<typeof auditAnomaliesQuerySchema>;

export interface AdminDeleteAnomaly {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
}

export interface OffHoursAdminAnomaly {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: AuditActionValue;
  resourceType: string;
  createdAt: string;
  hourUtc: number;
}

export interface FailedLoginAnomaly {
  userId: string;
  email: string;
  role: string;
  failedLoginCount: number;
  lockedUntil: string | null;
}

export interface AuditAnomaliesReport {
  window: {
    days: number;
    since: string;
    offHoursStartUtc: number;
    offHoursEndUtc: number;
    failedLoginThreshold: number;
  };
  adminDeletes: AdminDeleteAnomaly[];
  offHoursAdminActivity: OffHoursAdminAnomaly[];
  failedLoginSpikes: FailedLoginAnomaly[];
  summary: {
    adminDeletes: number;
    offHoursAdminActivity: number;
    failedLoginSpikes: number;
    /** True if any signal hit the row cap and results may be incomplete. */
    truncated: boolean;
  };
}
