/**
 * DashboardService — aggregates the four KPI counters and the recent-activity
 * feed for /dashboard, plus the three drill-down feeds that hang off the KPI
 * panels:
 *
 *   active-calls breakdown  — per-account counts powering /active-calls
 *   drivers-on-duty list    — inline list on the Drivers panel
 *   revenue-by-driver list  — inline list on the Today's Revenue panel
 *   eta board               — active jobs ranked by ETA, powering /active-etas
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
 * Revenue-by-driver attribution rule (v1): paid invoices today whose linked
 * job has an assignedDriverId are credited 100% to that primary driver.
 * Paid invoices with no jobId, or whose job has no assignedDriverId, roll
 * into the "Unassigned" bucket so the per-driver list reconciles to the
 * todaysRevenueCents KPI exactly.
 *
 * UTC day window: existing dispatch code (dispatchBoard recentlyCompleted) uses
 * setUTCHours(0,0,0,0). We follow that convention — tenants are US-centric in
 * v1 and no per-tenant timezone is yet wired in. Switching to tenant-local TZ
 * is a follow-up if the off-by-a-few-hours feel becomes a problem.
 */
import { Injectable } from '@nestjs/common';
import {
  accounts,
  customers,
  driverShifts,
  drivers,
  invoices,
  jobs,
  trucks,
} from '@ustowdispatch/db';
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

export interface DashboardDriverOnDuty {
  driverId: string;
  firstName: string;
  lastName: string;
  truckUnitNumber: string | null;
  shiftStatus: string;
  currentJobId: string | null;
  currentJobNumber: string | null;
  currentJobStatus: JobStatus | null;
}

export interface DashboardRevenueByDriverItem {
  driverId: string | null;
  driverName: string;
  revenueCents: number;
}

export interface DashboardOverviewDto {
  activeCalls: number;
  driversOnDuty: number;
  todaysRevenueCents: number;
  avgEtaMinutes: number | null;
  recentActivity: DashboardRecentActivityItem[];
  driversOnDutyList: DashboardDriverOnDuty[];
  revenueByDriver: DashboardRevenueByDriverItem[];
}

export interface ActiveCallsAccountBucket {
  accountId: string;
  accountName: string;
  isMotorClub: boolean;
  count: number;
}

export interface ActiveCallsBreakdownDto {
  total: number;
  byAccount: ActiveCallsAccountBucket[];
  noAccount: number;
}

export interface EtaBoardItem {
  jobId: string;
  jobNumber: string;
  status: JobStatus;
  serviceType: JobServiceType;
  accountId: string | null;
  accountName: string | null;
  slaMinutes: number | null;
  driverId: string | null;
  driverName: string | null;
  createdAt: string;
  assignedAt: string | null;
  etaToSceneMinutes: number | null;
  elapsedMinutes: number;
  totalProjectedMinutes: number | null;
  breached: boolean;
}

export interface DriverDayJobItem {
  id: string;
  jobNumber: string;
  status: JobStatus;
  serviceType: JobServiceType;
  customerName: string | null;
  accountName: string | null;
  rateQuotedCents: number;
  createdAt: string;
}

export interface DriverDayInvoiceItem {
  id: string;
  invoiceNumber: string;
  status: string;
  totalCents: number;
  paidCents: number;
  paidAt: string | null;
  jobId: string | null;
  jobNumber: string | null;
  customerName: string | null;
}

export interface DriverDayDto {
  driverId: string;
  firstName: string;
  lastName: string;
  completedJobs: DriverDayJobItem[];
  invoices: DriverDayInvoiceItem[];
  totalRevenueCents: number;
}

const ACTIVE_STATUSES: JobStatus[] = ['dispatched', 'enroute', 'on_scene', 'in_progress'];
const DRIVERS_LIST_LIMIT = 20;
const REVENUE_LIST_LIMIT = 20;
const ETA_BREACH_FALLBACK_MINUTES = 60;

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

      // Drivers on duty: open shifts joined to driver + truck + current job.
      const onDutyRows = await tx
        .select({
          driverId: drivers.id,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
          truckUnit: trucks.unitNumber,
          shiftStatus: driverShifts.status,
          currentJobId: driverShifts.currentJobId,
          jobNumber: jobs.jobNumber,
          jobStatus: jobs.status,
        })
        .from(driverShifts)
        .innerJoin(drivers, eq(driverShifts.driverId, drivers.id))
        .leftJoin(trucks, eq(driverShifts.truckId, trucks.id))
        .leftJoin(jobs, eq(driverShifts.currentJobId, jobs.id))
        .where(and(isNull(driverShifts.endedAt), isNull(driverShifts.deletedAt)))
        .orderBy(drivers.lastName, drivers.firstName)
        .limit(DRIVERS_LIST_LIMIT);

      const driversOnDutyList: DashboardDriverOnDuty[] = onDutyRows.map((r) => ({
        driverId: r.driverId,
        firstName: r.firstName,
        lastName: r.lastName,
        truckUnitNumber: r.truckUnit ?? null,
        shiftStatus: r.shiftStatus,
        currentJobId: r.currentJobId ?? null,
        currentJobNumber: r.jobNumber ?? null,
        currentJobStatus: r.jobStatus ?? null,
      }));

      // Revenue by driver: paid invoices today, grouped by job.assignedDriverId.
      // Cash receipts without a job, or jobs without a driver, roll into the
      // "Unassigned" bucket so the list reconciles to todaysRevenueCents.
      const revenueRows = await tx
        .select({
          driverId: jobs.assignedDriverId,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
          revenue: sum(invoices.paidCents),
        })
        .from(invoices)
        .leftJoin(jobs, eq(invoices.jobId, jobs.id))
        .leftJoin(drivers, eq(jobs.assignedDriverId, drivers.id))
        .where(
          and(
            eq(invoices.status, 'paid'),
            isNull(invoices.deletedAt),
            sql`${invoices.paidAt} >= ${startOfDay.toISOString()}`,
          ),
        )
        .groupBy(jobs.assignedDriverId, drivers.firstName, drivers.lastName)
        .orderBy(desc(sum(invoices.paidCents)))
        .limit(REVENUE_LIST_LIMIT);

      const revenueByDriver: DashboardRevenueByDriverItem[] = revenueRows.map((r) => ({
        driverId: r.driverId ?? null,
        driverName:
          r.driverId && r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : 'Unassigned',
        revenueCents: r.revenue ? Number(r.revenue) : 0,
      }));

      return {
        activeCalls: activeCallsRow?.value ?? 0,
        driversOnDuty: driversOnDutyRow?.value ?? 0,
        todaysRevenueCents,
        avgEtaMinutes,
        recentActivity,
        driversOnDutyList,
        revenueByDriver,
      };
    });
  }

  async activeCallsBreakdown(ctx: CallerContext): Promise<ActiveCallsBreakdownDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx
        .select({
          accountId: jobs.accountId,
          accountName: accounts.name,
          isMotorClub: accounts.isMotorClub,
          value: count(),
        })
        .from(jobs)
        .leftJoin(accounts, eq(jobs.accountId, accounts.id))
        .where(and(inArray(jobs.status, ACTIVE_STATUSES), isNull(jobs.deletedAt)))
        .groupBy(jobs.accountId, accounts.name, accounts.isMotorClub);

      let total = 0;
      let noAccount = 0;
      const byAccount: ActiveCallsAccountBucket[] = [];
      for (const r of rows) {
        const n = r.value;
        total += n;
        if (!r.accountId || !r.accountName) {
          noAccount += n;
          continue;
        }
        byAccount.push({
          accountId: r.accountId,
          accountName: r.accountName,
          isMotorClub: r.isMotorClub ?? false,
          count: n,
        });
      }
      byAccount.sort((a, b) => b.count - a.count || a.accountName.localeCompare(b.accountName));

      return { total, byAccount, noAccount };
    });
  }

  async activeCallsForAccount(
    ctx: CallerContext,
    accountId: string | null,
  ): Promise<DashboardRecentActivityItem[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [inArray(jobs.status, ACTIVE_STATUSES), isNull(jobs.deletedAt)];
      conds.push(accountId === null ? isNull(jobs.accountId) : eq(jobs.accountId, accountId));

      const rows = await tx
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
        .where(and(...conds))
        .orderBy(desc(jobs.createdAt));

      return rows.map((r) => ({
        id: r.id,
        jobNumber: r.jobNumber,
        customerId: r.customerId ?? null,
        customerName: r.customerName,
        serviceType: r.serviceType,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  /**
   * ETA board — every active job with an ETA estimate, ranked so the
   * dispatcher can see worst offenders first. A job is "breached" when
   * elapsedMinutes (or totalProjected when not yet on scene) exceeds the
   * account's slaArrivalMinutes, falling back to a flat 60-minute target.
   */
  async etaBoard(ctx: CallerContext): Promise<EtaBoardItem[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx
        .select({
          jobId: jobs.id,
          jobNumber: jobs.jobNumber,
          status: jobs.status,
          serviceType: jobs.serviceType,
          createdAt: jobs.createdAt,
          assignedAt: jobs.assignedAt,
          pickupLat: jobs.pickupLat,
          pickupLng: jobs.pickupLng,
          assignedShiftId: jobs.assignedShiftId,
          accountId: jobs.accountId,
          accountName: accounts.name,
          slaMinutes: accounts.slaArrivalMinutes,
          driverId: drivers.id,
          driverFirst: drivers.firstName,
          driverLast: drivers.lastName,
        })
        .from(jobs)
        .leftJoin(accounts, eq(jobs.accountId, accounts.id))
        .leftJoin(drivers, eq(jobs.assignedDriverId, drivers.id))
        .where(and(inArray(jobs.status, ACTIVE_STATUSES), isNull(jobs.deletedAt)));

      const shiftIds = rows.map((r) => r.assignedShiftId).filter((s): s is string => s !== null);

      const shiftRows = shiftIds.length
        ? await tx.query.driverShifts.findMany({
            where: and(inArray(driverShifts.id, shiftIds), isNull(driverShifts.deletedAt)),
            columns: { id: true, lastLat: true, lastLng: true },
          })
        : [];
      const shiftById = new Map(shiftRows.map((s) => [s.id, s]));

      const now = Date.now();
      const items: EtaBoardItem[] = rows.map((r) => {
        const eta = computeEtaMinutes(
          { status: r.status, pickupLat: r.pickupLat, pickupLng: r.pickupLng },
          r.assignedShiftId ? (shiftById.get(r.assignedShiftId) ?? null) : null,
        );
        const sinceMs = now - new Date(r.assignedAt ?? r.createdAt).getTime();
        const elapsedMinutes = Math.max(0, Math.round(sinceMs / 60000));
        const totalProjected = eta === null ? null : Math.round(elapsedMinutes + eta);
        const sla = r.slaMinutes ?? ETA_BREACH_FALLBACK_MINUTES;
        const comparison = totalProjected ?? elapsedMinutes;
        return {
          jobId: r.jobId,
          jobNumber: r.jobNumber,
          status: r.status,
          serviceType: r.serviceType,
          accountId: r.accountId ?? null,
          accountName: r.accountName ?? null,
          slaMinutes: r.slaMinutes ?? null,
          driverId: r.driverId ?? null,
          driverName:
            r.driverId && r.driverFirst && r.driverLast ? `${r.driverFirst} ${r.driverLast}` : null,
          createdAt: r.createdAt.toISOString(),
          assignedAt: r.assignedAt?.toISOString() ?? null,
          etaToSceneMinutes: eta === null ? null : Math.round(eta),
          elapsedMinutes,
          totalProjectedMinutes: totalProjected,
          breached: comparison > sla,
        };
      });

      items.sort((a, b) => {
        const aKey = a.totalProjectedMinutes ?? a.elapsedMinutes;
        const bKey = b.totalProjectedMinutes ?? b.elapsedMinutes;
        return bKey - aKey;
      });
      return items;
    });
  }

  /**
   * Driver day summary — completed jobs and the day's invoices for one
   * driver. Powers /drivers/[id]/today, opened from the Today's Revenue
   * panel. Uses the same UTC-day window as overview().
   */
  async driverDay(ctx: CallerContext, driverId: string): Promise<DriverDayDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const driverRow = await tx.query.drivers.findFirst({
        where: and(eq(drivers.id, driverId), isNull(drivers.deletedAt)),
        columns: { id: true, firstName: true, lastName: true },
      });
      if (!driverRow) {
        return {
          driverId,
          firstName: '',
          lastName: '',
          completedJobs: [],
          invoices: [],
          totalRevenueCents: 0,
        };
      }

      const completedRows = await tx
        .select({
          id: jobs.id,
          jobNumber: jobs.jobNumber,
          status: jobs.status,
          serviceType: jobs.serviceType,
          rateQuotedCents: jobs.rateQuotedCents,
          createdAt: jobs.createdAt,
          customerName: customers.name,
          accountName: accounts.name,
        })
        .from(jobs)
        .leftJoin(customers, eq(jobs.customerId, customers.id))
        .leftJoin(accounts, eq(jobs.accountId, accounts.id))
        .where(
          and(
            eq(jobs.assignedDriverId, driverId),
            eq(jobs.status, 'completed' as const),
            isNull(jobs.deletedAt),
            gte(jobs.updatedAt, startOfDay),
          ),
        )
        .orderBy(desc(jobs.updatedAt));

      const completedJobs: DriverDayJobItem[] = completedRows.map((r) => ({
        id: r.id,
        jobNumber: r.jobNumber,
        status: r.status,
        serviceType: r.serviceType,
        customerName: r.customerName ?? null,
        accountName: r.accountName ?? null,
        rateQuotedCents: r.rateQuotedCents,
        createdAt: r.createdAt.toISOString(),
      }));

      const invoiceRows = await tx
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
          totalCents: invoices.totalCents,
          paidCents: invoices.paidCents,
          paidAt: invoices.paidAt,
          jobId: invoices.jobId,
          jobNumber: jobs.jobNumber,
          customerName: customers.name,
        })
        .from(invoices)
        .innerJoin(jobs, eq(invoices.jobId, jobs.id))
        .leftJoin(customers, eq(invoices.customerId, customers.id))
        .where(
          and(
            eq(jobs.assignedDriverId, driverId),
            eq(invoices.status, 'paid'),
            isNull(invoices.deletedAt),
            sql`${invoices.paidAt} >= ${startOfDay.toISOString()}`,
          ),
        )
        .orderBy(desc(invoices.paidAt));

      const invoicesOut: DriverDayInvoiceItem[] = invoiceRows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        status: r.status,
        totalCents: r.totalCents,
        paidCents: r.paidCents,
        paidAt: r.paidAt?.toISOString() ?? null,
        jobId: r.jobId ?? null,
        jobNumber: r.jobNumber ?? null,
        customerName: r.customerName ?? null,
      }));

      const totalRevenueCents = invoicesOut.reduce((s, i) => s + i.paidCents, 0);

      return {
        driverId,
        firstName: driverRow.firstName,
        lastName: driverRow.lastName,
        completedJobs,
        invoices: invoicesOut,
        totalRevenueCents,
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
