/**
 * DriverMobileService — driver-app-scoped read/write surface.
 *
 * Session 7 introduces a native Android driver app. The existing dispatch
 * board endpoints all require dispatcher-or-higher roles; a driver in the
 * field needs a slimmer surface that:
 *   1. Returns only the jobs assigned to *that* driver (resolved via
 *      drivers.user_id = ctx.userId).
 *   2. Hydrates a tiny customer + vehicle snippet so the app doesn't have to
 *      walk multiple endpoints to render a job card.
 *   3. Lets the driver upload pre-tow / GOA / signature images.
 *
 * Everything runs under runInTenantContext so RLS still enforces isolation.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  customers,
  drivers as driversTable,
  jobs,
  vehicles as vehiclesTable,
} from '@towcommand/db';
import { ERROR_CODES, type JobDto, type JobStatus, type Role } from '@towcommand/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { DocumentsService } from '../fleet/documents.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface DriverMobileJobDto {
  job: JobDto;
  customer: { id: string; name: string; phone: string | null } | null;
  vehicle: {
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    color: string | null;
    plate: string | null;
    plateState: string | null;
    vin: string | null;
    specialInstructions: string | null;
  } | null;
}

export interface DriverProfileMobileDto {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  phone: string | null;
  email: string | null;
  licenseExpiresAt: string | null;
  cdlExpiresAt: string | null;
  medicalCardExpiresAt: string | null;
  employmentStatus: string;
  active: boolean;
}

export interface UploadJobPhotoInput {
  jobId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  capturedAt: string;
  lat?: number | null;
  lng?: number | null;
  tag?: string | null;
}

const DRIVER_ACTIVE_STATUSES: JobStatus[] = ['dispatched', 'enroute', 'on_scene', 'in_progress'];

@Injectable()
export class DriverMobileService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly documents: DocumentsService,
  ) {}

  /** Resolve the drivers row attached to the current authenticated user. */
  async myDriverProfile(ctx: CallerContext): Promise<DriverProfileMobileDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.drivers.findFirst({
        where: and(eq(driversTable.userId, ctx.userId), isNull(driversTable.deletedAt)),
      });
      if (!row) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'No driver record is linked to this user',
        });
      }
      return {
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        preferredName: row.preferredName,
        phone: row.phone,
        email: row.email,
        licenseExpiresAt: row.licenseExpiresAt,
        cdlExpiresAt: row.cdlExpiresAt,
        medicalCardExpiresAt: row.medicalCardExpiresAt,
        employmentStatus: row.employmentStatus,
        active: row.active,
      };
    });
  }

  /**
   * Jobs currently assigned to the driver linked to ctx.userId. We only
   * surface active (non-terminal) statuses; the dispatch board owns history.
   */
  async myJobs(ctx: CallerContext): Promise<DriverMobileJobDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const driver = await tx.query.drivers.findFirst({
        where: and(eq(driversTable.userId, ctx.userId), isNull(driversTable.deletedAt)),
      });
      if (!driver) return [];

      const jobRows = await tx.query.jobs.findMany({
        where: and(
          eq(jobs.assignedDriverId, driver.id),
          inArray(jobs.status, DRIVER_ACTIVE_STATUSES),
          isNull(jobs.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.assignedAt), asc(t.createdAt)],
        limit: 100,
      });
      if (jobRows.length === 0) return [];

      const customerIds = Array.from(
        new Set(jobRows.map((j) => j.customerId).filter((v): v is string => !!v)),
      );
      const vehicleIds = Array.from(
        new Set(jobRows.map((j) => j.vehicleId).filter((v): v is string => !!v)),
      );

      const customerRows = customerIds.length
        ? await tx.query.customers.findMany({
            where: and(inArray(customers.id, customerIds), isNull(customers.deletedAt)),
          })
        : [];
      const vehicleRows = vehicleIds.length
        ? await tx.query.vehicles.findMany({
            where: and(inArray(vehiclesTable.id, vehicleIds), isNull(vehiclesTable.deletedAt)),
          })
        : [];

      const customerById = new Map(customerRows.map((c) => [c.id, c]));
      const vehicleById = new Map(vehicleRows.map((v) => [v.id, v]));

      return jobRows.map((j) => {
        const c = j.customerId ? (customerById.get(j.customerId) ?? null) : null;
        const v = j.vehicleId ? (vehicleById.get(j.vehicleId) ?? null) : null;
        return {
          job: this.rowToDto(j),
          customer: c ? { id: c.id, name: c.name, phone: c.phone } : null,
          vehicle: v
            ? {
                id: v.id,
                year: v.year,
                make: v.make,
                model: v.model,
                color: v.color,
                plate: v.plate,
                plateState: v.plateState,
                vin: v.vin,
                specialInstructions: v.specialInstructions,
              }
            : null,
        };
      });
    });
  }

  /**
   * Upload a job photo as a document attached to the job. Verifies the
   * caller's driver record is currently assigned to the job — drivers may
   * only attach photos to their own jobs.
   */
  async uploadJobPhoto(
    ctx: CallerContext,
    input: UploadJobPhotoInput,
  ): Promise<{
    id: string;
    fileUrl: string;
    uploadedAt: string;
  }> {
    const job = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const driver = await tx.query.drivers.findFirst({
        where: and(eq(driversTable.userId, ctx.userId), isNull(driversTable.deletedAt)),
      });
      if (!driver) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'No driver record linked to this user',
        });
      }
      const j = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, input.jobId), isNull(jobs.deletedAt)),
      });
      if (!j) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Job not found' });
      }
      if (j.assignedDriverId !== driver.id) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'Job is not assigned to this driver',
        });
      }
      return j;
    });

    const notes = JSON.stringify({
      capturedAt: input.capturedAt,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      tag: input.tag ?? null,
    });

    const doc = await this.documents.upload(ctx, {
      ownerType: 'job',
      ownerId: job.id,
      docType: 'photo',
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: input.bytes,
      notes,
    });
    return { id: doc.id, fileUrl: doc.fileUrl, uploadedAt: doc.uploadedAt };
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

  private rowToDto(row: typeof jobs.$inferSelect): JobDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      jobNumber: row.jobNumber,
      status: row.status,
      serviceType: row.serviceType,
      customerId: row.customerId,
      vehicleId: row.vehicleId,
      accountId: row.accountId,
      pickupAddress: row.pickupAddress,
      pickupLat: row.pickupLat ? Number(row.pickupLat) : null,
      pickupLng: row.pickupLng ? Number(row.pickupLng) : null,
      dropoffAddress: row.dropoffAddress,
      dropoffLat: row.dropoffLat ? Number(row.dropoffLat) : null,
      dropoffLng: row.dropoffLng ? Number(row.dropoffLng) : null,
      authorizedBy: row.authorizedBy,
      authorizedByName: row.authorizedByName,
      rateQuotedCents: row.rateQuotedCents,
      rateBreakdown: (row.rateBreakdown as JobDto['rateBreakdown']) ?? null,
      notes: row.notes,
      cancelledReason: row.cancelledReason,
      assignedDriverId: row.assignedDriverId,
      assignedTruckId: row.assignedTruckId,
      assignedShiftId: row.assignedShiftId,
      assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}
