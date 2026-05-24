/**
 * PublicV1Service — backs the /v1 public REST surface.
 *
 * Reads are dedicated keyset-paginated queries returning trimmed, stable
 * public DTOs (decoupled from internal DTO churn). Writes DELEGATE to the
 * existing JobsService so the job state machine, transition ledger, and — the
 * point — the DISPATCH_EVENTS emission all run, which is what fires webhooks.
 *
 * Every method runs under the tenant resolved from the API key, so RLS
 * isolates all access exactly as it does for session traffic.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { drivers, impoundRecords, jobs, trucks } from '@ustowdispatch/db';
import {
  type CreateJobIntakePayload,
  type CursorQuery,
  ERROR_CODES,
  type JobDto,
  type JobStatus,
  type PublicDriverDto,
  type PublicImpoundDto,
  type PublicJobDto,
  type PublicJobListQuery,
  type PublicTruckDto,
} from '@ustowdispatch/shared';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { type CursorPage, buildCursorPage, decodeCursor } from './cursor.js';

export interface PublicCallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class PublicV1Service {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly jobs: JobsService,
  ) {}

  // ---------------- jobs ----------------

  async listJobs(
    ctx: PublicCallerCtx,
    query: PublicJobListQuery,
  ): Promise<CursorPage<PublicJobDto>> {
    const cursorId = decodeCursor(query.cursor);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(jobs.deletedAt)];
      if (query.status) conds.push(eq(jobs.status, query.status));
      if (cursorId) conds.push(lt(jobs.id, cursorId));
      const rows = await tx.query.jobs.findMany({
        where: and(...conds),
        orderBy: (t, { desc }) => [desc(t.id)],
        limit: query.limit + 1,
      });
      return buildCursorPage(rows.map(toPublicJob), query.limit, (d) => d.id);
    });
  }

  async getJob(ctx: PublicCallerCtx, id: string): Promise<PublicJobDto | null> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, id), isNull(jobs.deletedAt)),
      });
      return row ? toPublicJob(row) : null;
    });
  }

  /** Create a job from raw intake data; delegates so JOB_CREATED fires. */
  async createJob(ctx: PublicCallerCtx, payload: CreateJobIntakePayload): Promise<PublicJobDto> {
    const result = await this.jobs.createIntake(ctx, payload);
    return publicJobFromDto(result.job);
  }

  /** Patch job status; delegates to the state machine so JOB_STATUS_CHANGED fires. */
  async patchJobStatus(
    ctx: PublicCallerCtx,
    id: string,
    status: JobStatus,
    reason?: string,
  ): Promise<PublicJobDto> {
    // 'dispatched' requires driver assignment (the assign flow), which is not
    // part of the public surface — reject with a clear message rather than
    // leaving a driverless dispatched job.
    if (status === 'dispatched') {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_STATE_TRANSITION,
        message:
          "Transition to 'dispatched' is not supported via the public API (requires driver assignment).",
      });
    }
    const dto = await this.jobs.transition(ctx, id, status, reason);
    return publicJobFromDto(dto);
  }

  // ---------------- trucks ----------------

  async listTrucks(ctx: PublicCallerCtx, query: CursorQuery): Promise<CursorPage<PublicTruckDto>> {
    const cursorId = decodeCursor(query.cursor);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(trucks.deletedAt)];
      if (cursorId) conds.push(lt(trucks.id, cursorId));
      const rows = await tx.query.trucks.findMany({
        where: and(...conds),
        orderBy: (t, { desc }) => [desc(t.id)],
        limit: query.limit + 1,
      });
      return buildCursorPage(rows.map(toPublicTruck), query.limit, (d) => d.id);
    });
  }

  async getTruck(ctx: PublicCallerCtx, id: string): Promise<PublicTruckDto | null> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.trucks.findFirst({
        where: and(eq(trucks.id, id), isNull(trucks.deletedAt)),
      });
      return row ? toPublicTruck(row) : null;
    });
  }

  // ---------------- drivers ----------------

  async listDrivers(
    ctx: PublicCallerCtx,
    query: CursorQuery,
  ): Promise<CursorPage<PublicDriverDto>> {
    const cursorId = decodeCursor(query.cursor);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(drivers.deletedAt)];
      if (cursorId) conds.push(lt(drivers.id, cursorId));
      const rows = await tx.query.drivers.findMany({
        where: and(...conds),
        orderBy: (t, { desc }) => [desc(t.id)],
        limit: query.limit + 1,
      });
      return buildCursorPage(rows.map(toPublicDriver), query.limit, (d) => d.id);
    });
  }

  async getDriver(ctx: PublicCallerCtx, id: string): Promise<PublicDriverDto | null> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.drivers.findFirst({
        where: and(eq(drivers.id, id), isNull(drivers.deletedAt)),
      });
      return row ? toPublicDriver(row) : null;
    });
  }

  // ---------------- impound ----------------

  async listImpound(
    ctx: PublicCallerCtx,
    query: CursorQuery,
  ): Promise<CursorPage<PublicImpoundDto>> {
    const cursorId = decodeCursor(query.cursor);
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(impoundRecords.deletedAt)];
      if (cursorId) conds.push(lt(impoundRecords.id, cursorId));
      const rows = await tx.query.impoundRecords.findMany({
        where: and(...conds),
        orderBy: (t, { desc }) => [desc(t.id)],
        limit: query.limit + 1,
      });
      return buildCursorPage(rows.map(toPublicImpound), query.limit, (d) => d.id);
    });
  }

  async getImpound(ctx: PublicCallerCtx, id: string): Promise<PublicImpoundDto | null> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, id), isNull(impoundRecords.deletedAt)),
      });
      return row ? toPublicImpound(row) : null;
    });
  }
}

// ======================================================================
// Mappers — DB row -> trimmed public DTO
// ======================================================================

function toPublicJob(j: typeof jobs.$inferSelect): PublicJobDto {
  return {
    id: j.id,
    jobNumber: j.jobNumber,
    status: j.status,
    serviceType: j.serviceType,
    pickupAddress: j.pickupAddress,
    dropoffAddress: j.dropoffAddress,
    customerId: j.customerId,
    vehicleId: j.vehicleId,
    assignedDriverId: j.assignedDriverId,
    assignedTruckId: j.assignedTruckId,
    rateQuotedCents: j.rateQuotedCents,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

function toPublicTruck(t: typeof trucks.$inferSelect): PublicTruckDto {
  return {
    id: t.id,
    unitNumber: t.unitNumber,
    truckType: t.truckType,
    status: t.status,
    inService: t.inService,
    year: t.year,
    make: t.make,
    model: t.model,
    plate: t.plate,
    plateState: t.plateState,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toPublicDriver(d: typeof drivers.$inferSelect): PublicDriverDto {
  return {
    id: d.id,
    firstName: d.firstName,
    lastName: d.lastName,
    employmentStatus: d.employmentStatus,
    active: d.active,
    phone: d.phone,
    email: d.email,
    cdlClass: d.cdlClass,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toPublicImpound(r: typeof impoundRecords.$inferSelect): PublicImpoundDto {
  return {
    id: r.id,
    status: r.status,
    yardId: r.yardId,
    vehicleVin: r.vehicleVin,
    licensePlate: r.licensePlate,
    vehicleMake: r.vehicleMake,
    vehicleModel: r.vehicleModel,
    vehicleYear: r.vehicleYear,
    arrivedAt: r.arrivedAt.toISOString(),
    releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
    lienEligible: r.lienEligible,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toTenantCtx(ctx: PublicCallerCtx): {
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

/**
 * JobsService returns a JobDto (ISO-string timestamps, already the
 * authoritative post-write row). Map it straight to the public shape — no
 * second DB read.
 */
function publicJobFromDto(dto: JobDto): PublicJobDto {
  return {
    id: dto.id,
    jobNumber: dto.jobNumber,
    status: dto.status,
    serviceType: dto.serviceType,
    pickupAddress: dto.pickupAddress,
    dropoffAddress: dto.dropoffAddress,
    customerId: dto.customerId,
    vehicleId: dto.vehicleId,
    assignedDriverId: dto.assignedDriverId,
    assignedTruckId: dto.assignedTruckId,
    rateQuotedCents: dto.rateQuotedCents,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}
