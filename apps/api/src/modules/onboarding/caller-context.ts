/**
 * Caller context shared across the onboarding services — mirrors the shape
 * used by every other tenant-scoped module (fleet, dispatch, tenants).
 */
import type { TenantContextValues } from '../../database/tenant-aware-db.service.js';

export interface CallerContext {
  tenantId: string;
  userId: string;
  role: string | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export function toTenantContext(ctx: CallerContext): TenantContextValues {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress ?? undefined,
    userAgent: ctx.userAgent ?? undefined,
  };
}
