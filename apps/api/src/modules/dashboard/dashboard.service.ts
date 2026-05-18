/**
 * DashboardService — aggregates the four KPI counters and the recent-activity
 * feed for /dashboard. All reads run inside a single tenant context so RLS
 * isolates the work and the four counters stay consistent w.r.t. the same
 * transaction snapshot.
 *
 * KPI definitions:
 *   activeCalls         — jobs whose status is one of (dispatched, enroute,
 *                         on_scene, in_progress). Not date-bounded; an active
 *                         job spans the day it was created from.
 *   driversOnDuty       — driver_shifts rows with no endedAt and no deletedAt.
 *   todaysRevenueCents  — sum of paidCents over invoices marked status='paid'
 *                         and paidAt within today (UTC bounds).
 *   avgEtaMinutes       — average minutes-to-pickup across active jobs we can
 *                         compute. We don't store ETAs; we approximate using
 *                         the assigned shift's last GPS position vs. pickup
 *                         coordinates at an assumed 30 mph urban average.
 *                         Jobs already on_scene / in_progress contribute 0.
 *                         Returns null when no active jobs or none yield a
 *                         positionable ETA. See `computeEtaMinutes` below.
 *
 * UTC day window: existing dispatch code (dispatchBoard recentlyCompleted) uses
 * setUTCHours(0,0,0,0). We follow that convention — tenants are US-centric in
 * v1 and no per-tenant timezone is yet wired in. Switching to tenant-local TZ
 * is a follow-up if the off-by-a-few-hours feel becomes a problem.
 */
import { Injectable } from '@nestjs/common';
import { customers, driverShifts, invoices, jobs } from '@ustowdispatch/db';
import type { JobServiceType, JobStatus } from '@ustowdispatch/shared';
import { and, count, desc, eq, gte, inArray, isNull, sql, sum } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface DashboardRecentActivityItem {
  id: string;
  jobNumber: string;
  customerId: string | null;
  customerName: string | null;
  serviceType: JobServiceType;
  status: JobStatus;
  createdAt: string;
}

export interface DashboardOverviewDto {
  activeCalls: number;
  driversOnDuty: number;
  todaysRevenueCents: number;
  avgEtaMinutes: number | null;
  recentActivity: DashboardRecentActivityItem[];
}

const ACTIVE_STATUSES: JobStatus[] = ['dispatched', 'enroute', 'on_scene', 'in_progress'];

@Injectable()
export class DashboardService {
  constructor(private readonly db: TenantAwareDb) {}

  async overview(ctx: CallerContext): Promise<DashboardOverviewDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const [activeCallsRow] = await tx
        .select({ value: count() })
        .from(jobs)
        .where(and(inArray(jobs.status, ACTIVE_STATUSES), isNull(jobs.deletedAt)));

      const [driversOnDutyRow] = await tx
        .select({ value: count() })
        .from(driverShifts)
        .where(and(isNull(driverShifts.endedAt), isNull(driverShifts.deletedAt)));

      const [revenueRow] = await tx
        .select({ value: sum(invoices.paidCents) })
        .from(invoices)
        .where(
          and(
            eq(invoices.status, 'paid'),
            isNull(invoices.deletedAt),
            sql`${invoices.paidAt} >= ${startOfDay.toISOString()}`,
          ),
        );

      // sum() returns string | null because of bigint. Coerce safely.
      const todaysRevenueCents = revenueRow?.value ? Number(revenueRow.value) : 0;

      const activeRows = await tx.query.jobs.findMany({
        where: and(inArray(jobs.status, ACTIVE_STATUSES), isNull(jobs.deletedAt)),
        columns: {
          id: true,
          status: true,
          pickupLat: true,
          pickupLng: true,
          assignedShiftId: true,
        },
      });

      const shiftIds = activeRows
        .map((j) => j.assignedShiftId)
        .filter((s): s is string => s !== null);

      const shiftRows = shiftIds.length
        ? await tx.query.driverShifts.findMany({
            where: and(inArray(driverShifts.id, shiftIds), isNull(driverShifts.deletedAt)),
            columns: { id: true, lastLat: true, lastLng: true },
          })
        : [];
      const shiftById = new Map(shiftRows.map((s) => [s.id, s]));

      const etas: number[] = [];
      for (const job of activeRows) {
        const eta = computeEtaMinutes(
          job,
          job.assignedShiftId ? (shiftById.get(job.assignedShiftId) ?? null) : null,
        );
        if (eta !== null) etas.push(eta);
      }
      const avgEtaMinutes = etas.length
        ? Math.round(etas.reduce((a, b) => a + b, 0) / etas.length)
        : null;

      const recentRows = await tx
        .select({
          id: jobs.id,
          jobNumber: jobs.jobNumber,
          serviceType: jobs.serviceType,
          status: jobs.status,
          createdAt: jobs.createdAt,
          customerId: jobs.customerId,
          customerName: customers.name,
        })
        .from(jobs)
        .leftJoin(customers, eq(jobs.customerId, customers.id))
        .where(and(isNull(jobs.deletedAt), gte(jobs.createdAt, startOfDay)))
        .orderBy(desc(jobs.createdAt))
        .limit(5);

      const recentActivity: DashboardRecentActivityItem[] = recentRows.map((r) => ({
        id: r.id,
        jobNumber: r.jobNumber,
        customerId: r.customerId ?? null,
        customerName: r.customerName,
        serviceType: r.serviceType,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }));

      return {
        activeCalls: activeCallsRow?.value ?? 0,
        driversOnDuty: driversOnDutyRow?.value ?? 0,
        todaysRevenueCents,
        avgEtaMinutes,
        recentActivity,
      };
    });
  }

  private toTenantCtx(ctx: CallerContext): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}

interface EtaJob {
  status: JobStatus;
  pickupLat: string | null;
  pickupLng: string | null;
}
interface EtaShift {
  lastLat: string | null;
  lastLng: string | null;
}

/**
 * Approximate the driver's minutes-to-pickup using straight-line distance.
 * Returns 0 for jobs already on-scene or in-progress. Returns null when the
 * pickup or driver position is unknown — caller excludes those from the avg.
 *
 * 30 mph picks a deliberately low urban average — actual road routing would
 * be slightly faster on highway runs but slower in congestion. Good enough as
 * a KPI proxy; swap in a real directions-API call when we add server-side
 * routing.
 */
function computeEtaMinutes(job: EtaJob, shift: EtaShift | null): number | null {
  if (job.status === 'on_scene' || job.status === 'in_progress') return 0;
  if (!shift) return null;
  const sLat = shift.lastLat ? Number(shift.lastLat) : null;
  const sLng = shift.lastLng ? Number(shift.lastLng) : null;
  const pLat = job.pickupLat ? Number(job.pickupLat) : null;
  const pLng = job.pickupLng ? Number(job.pickupLng) : null;
  if (sLat === null || sLng === null || pLat === null || pLng === null) return null;
  if (
    !Number.isFinite(sLat) ||
    !Number.isFinite(sLng) ||
    !Number.isFinite(pLat) ||
    !Number.isFinite(pLng)
  )
    return null;
  const miles = haversineMiles(sLat, sLng, pLat, pLng);
  const avgMph = 30;
  return (miles / avgMph) * 60;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.7613; // earth radius in miles
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
