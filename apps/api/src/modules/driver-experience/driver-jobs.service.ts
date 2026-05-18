/**
 * DriverJobsService — read-only driver-facing job lookup.
 *
 * Session 3 needs the in-truck app to fetch:
 *   - the driver's active (non-terminal) job list
 *   - a single job the driver is assigned to, by id
 *
 * Both queries enforce ownership by filtering on assignedDriverId =
 * driverContext.driverId so a leaked or stolen driver token cannot
 * surface jobs that aren't the driver's. Tenant isolation falls out of
 * the standard runInTenantContext RLS path (driver JWT populates
 * requestContext.tenantId via DriverAuthGuard).
 *
 * Why a dedicated service instead of extending JobsService.list with a
 * driverId filter and reusing the operator controller: the operator
 * routes are gated by RolesGuard which reads operator-context userId /
 * role. The driver JWT has neither. Carving a tiny driver-specific
 * controller keeps the two auth surfaces fully separated.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { jobs } from '@ustowdispatch/db';
import { ERROR_CODES, type JobDto, type JobStatus } from '@ustowdispatch/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import type { DriverContext } from './driver-auth.service.js';

/**
 * Non-terminal statuses surfaced to the driver. Mirrors the state
 * machine in apps/api/src/modules/jobs/job-state-machine.ts — anything
 * that isn't `completed | cancelled | goa` is still live work.
 */
const ACTIVE_STATUSES: JobStatus[] = ['dispatched', 'enroute', 'on_scene', 'in_progress'];

@Injectable()
export class DriverJobsService {
  constructor(private readonly db: TenantAwareDb) {}

  async listMyActive(ctx: DriverContext): Promise<JobDto[]> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId, requestId: ctx.requestId },
      async (tx) => {
        const rows = await tx.query.jobs.findMany({
          where: and(
            eq(jobs.assignedDriverId, ctx.driverId),
            inArray(jobs.status, ACTIVE_STATUSES),
            isNull(jobs.deletedAt),
          ),
          orderBy: [desc(jobs.assignedAt)],
          limit: 50,
        });
        return rows.map(rowToJobDto);
      },
    );
  }

  async getMyJob(ctx: DriverContext, jobId: string): Promise<JobDto> {
    const row = await this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId, requestId: ctx.requestId },
      async (tx) => {
        return tx.query.jobs.findFirst({
          where: and(
            eq(jobs.id, jobId),
            eq(jobs.assignedDriverId, ctx.driverId),
            isNull(jobs.deletedAt),
          ),
        });
      },
    );
    if (!row) {
      // Ownership-aware 404 — don't leak existence of jobs not assigned
      // to this driver.
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Job not found' });
    }
    return rowToJobDto(row);
  }
}

function textToNum(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rowToJobDto(j: typeof jobs.$inferSelect): JobDto {
  return {
    id: j.id,
    tenantId: j.tenantId,
    jobNumber: j.jobNumber,
    status: j.status,
    serviceType: j.serviceType,
    customerId: j.customerId,
    vehicleId: j.vehicleId,
    accountId: j.accountId,
    pickupAddress: j.pickupAddress,
    pickupLat: textToNum(j.pickupLat),
    pickupLng: textToNum(j.pickupLng),
    dropoffAddress: j.dropoffAddress,
    dropoffLat: textToNum(j.dropoffLat),
    dropoffLng: textToNum(j.dropoffLng),
    authorizedBy: j.authorizedBy,
    authorizedByName: j.authorizedByName,
    rateQuotedCents: j.rateQuotedCents,
    rateBreakdown: (j.rateBreakdown as JobDto['rateBreakdown']) ?? null,
    notes: j.notes,
    cancelledReason: j.cancelledReason,
    assignedDriverId: j.assignedDriverId,
    assignedTruckId: j.assignedTruckId,
    assignedShiftId: j.assignedShiftId,
    assignedAt: j.assignedAt ? j.assignedAt.toISOString() : null,
    createdByUserId: j.createdByUserId,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    deletedAt: j.deletedAt ? j.deletedAt.toISOString() : null,
  };
}
