/**
 * Audit-log anomaly classification (Session 40 — SOC 2 Type II monitoring
 * effectiveness). Pure + dependency-free so it unit-tests without a database.
 *
 * The service fetches the window of admin/owner audit_log rows (joined to users
 * for actor identity/role) and hands them here to be split into the two
 * audit-derived signals:
 *   - admin deletes        — action = DELETE,
 *   - off-hours activity   — created in the configured off-hours UTC band.
 *
 * Failed-login spikes come from the users table directly (a counter, not an
 * audit event) and are assembled in the service, not here.
 */
import type {
  AdminDeleteAnomaly,
  AuditActionValue,
  OffHoursAdminAnomaly,
} from '@ustowdispatch/shared';

export interface AdminAuditRow {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: AuditActionValue;
  resourceType: string;
  resourceId: string | null;
  createdAt: Date;
}

export interface OffHoursBand {
  /** Inclusive start hour (UTC, 0–23). */
  startUtc: number;
  /** Exclusive end hour (UTC, 0–23). */
  endUtc: number;
}

/**
 * True when `hourUtc` falls in the off-hours band [start, end). When start > end
 * (e.g. 22→6) the band wraps midnight, so the test is OR rather than AND. When
 * start === end the band is empty (always-on hours = nothing flagged).
 */
export function isOffHours(hourUtc: number, band: OffHoursBand): boolean {
  const { startUtc, endUtc } = band;
  if (startUtc === endUtc) return false;
  if (startUtc < endUtc) return hourUtc >= startUtc && hourUtc < endUtc;
  return hourUtc >= startUtc || hourUtc < endUtc;
}

export function classifyAuditAnomalies(
  rows: AdminAuditRow[],
  band: OffHoursBand,
): { adminDeletes: AdminDeleteAnomaly[]; offHoursAdminActivity: OffHoursAdminAnomaly[] } {
  const adminDeletes: AdminDeleteAnomaly[] = [];
  const offHoursAdminActivity: OffHoursAdminAnomaly[] = [];

  for (const r of rows) {
    if (r.action === 'DELETE') {
      adminDeletes.push({
        id: r.id,
        actorId: r.actorId,
        actorEmail: r.actorEmail,
        actorRole: r.actorRole,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        createdAt: r.createdAt.toISOString(),
      });
    }
    const hourUtc = r.createdAt.getUTCHours();
    if (isOffHours(hourUtc, band)) {
      offHoursAdminActivity.push({
        id: r.id,
        actorId: r.actorId,
        actorEmail: r.actorEmail,
        actorRole: r.actorRole,
        action: r.action,
        resourceType: r.resourceType,
        createdAt: r.createdAt.toISOString(),
        hourUtc,
      });
    }
  }
  return { adminDeletes, offHoursAdminActivity };
}
