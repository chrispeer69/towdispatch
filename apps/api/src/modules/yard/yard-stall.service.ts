/**
 * YardStallService — the stall map per facility (Yard Management, Session 54).
 * CRUD, vehicle assignment (occupied + type/class gated via the pure
 * validateStallAssignment), release, bulk drag-drop layout, and stall photos.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  impoundRecords,
  uuidv7,
  vehicles,
  yardFacilities,
  yardStallPhotos,
  yardStalls,
} from '@ustowdispatch/db';
import type {
  BulkStallLayoutPayload,
  CreateYardStallPayload,
  RegisterStallPhotoPayload,
  UpdateYardStallPayload,
  YardStallDetailDto,
  YardStallDto,
  YardStallPhotoDto,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { classifyFromVehicle } from './storage-rate.logic.js';
import type { CallerCtx } from './yard-facility.service.js';
import { validateStallAssignment } from './yard-stall.logic.js';

export function vehicleDescription(r: {
  vehicleYear: number | null;
  vehicleColor: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
}): string {
  return (
    [r.vehicleYear, r.vehicleColor, r.vehicleMake, r.vehicleModel]
      .filter((p) => p !== null && p !== undefined && `${p}`.length > 0)
      .join(' ') || 'Unidentified vehicle'
  );
}

@Injectable()
export class YardStallService {
  constructor(private readonly db: TenantAwareDb) {}

  async listForFacility(ctx: CallerCtx, facilityId: string): Promise<YardStallDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.yardStalls.findMany({
        where: and(eq(yardStalls.facilityId, facilityId), isNull(yardStalls.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.y), asc(t.x), asc(t.label)],
      });
      return rows.map(toStallDto);
    });
  }

  async getDetail(ctx: CallerCtx, stallId: string): Promise<YardStallDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const stall = await tx.query.yardStalls.findFirst({
        where: and(eq(yardStalls.id, stallId), isNull(yardStalls.deletedAt)),
      });
      if (!stall) throw notFound('Stall not found');
      const photos = await tx.query.yardStallPhotos.findMany({
        where: eq(yardStallPhotos.stallId, stallId),
        orderBy: (t, { desc }) => [desc(t.capturedAt)],
      });
      let occupant: YardStallDetailDto['occupant'] = null;
      if (stall.occupiedByImpoundId) {
        const rec = await tx.query.impoundRecords.findFirst({
          where: eq(impoundRecords.id, stall.occupiedByImpoundId),
        });
        if (rec) {
          occupant = {
            impoundId: rec.id,
            vehicleDescription: vehicleDescription(rec),
            licensePlate: rec.licensePlate,
            vehicleVin: rec.vehicleVin,
            status: rec.status,
          };
        }
      }
      return { stall: toStallDto(stall), photos: photos.map(toPhotoDto), occupant };
    });
  }

  async create(
    ctx: CallerCtx,
    facilityId: string,
    input: CreateYardStallPayload,
  ): Promise<YardStallDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const facility = await tx.query.yardFacilities.findFirst({
        where: and(eq(yardFacilities.id, facilityId), isNull(yardFacilities.deletedAt)),
      });
      if (!facility) throw notFound('Facility not found in this tenant');
      const [row] = await tx
        .insert(yardStalls)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          facilityId,
          label: input.label,
          rowLabel: input.rowLabel ?? null,
          colLabel: input.colLabel ?? null,
          x: input.x,
          y: input.y,
          stallType: input.stallType,
          notes: input.notes ?? null,
        })
        .returning();
      if (!row) throw new Error('createStall: insert returning() yielded no row');
      return toStallDto(row);
    });
  }

  async update(
    ctx: CallerCtx,
    stallId: string,
    input: UpdateYardStallPayload,
  ): Promise<YardStallDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.yardStalls.findFirst({
        where: and(eq(yardStalls.id, stallId), isNull(yardStalls.deletedAt)),
      });
      if (!existing) throw notFound('Stall not found');
      const patch: Partial<typeof yardStalls.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.label !== undefined) patch.label = input.label;
      if (input.rowLabel !== undefined) patch.rowLabel = input.rowLabel ?? null;
      if (input.colLabel !== undefined) patch.colLabel = input.colLabel ?? null;
      if (input.x !== undefined) patch.x = input.x;
      if (input.y !== undefined) patch.y = input.y;
      if (input.stallType !== undefined) patch.stallType = input.stallType;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      const [row] = await tx
        .update(yardStalls)
        .set(patch)
        .where(and(eq(yardStalls.id, stallId), isNull(yardStalls.deletedAt)))
        .returning();
      if (!row) throw notFound('Stall not found');
      return toStallDto(row);
    });
  }

  async softDelete(ctx: CallerCtx, stallId: string): Promise<void> {
    await this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.yardStalls.findFirst({
        where: and(eq(yardStalls.id, stallId), isNull(yardStalls.deletedAt)),
      });
      if (!existing) throw notFound('Stall not found');
      if (existing.occupiedByImpoundId) {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'Cannot remove an occupied stall; release the vehicle first.',
        });
      }
      await tx.update(yardStalls).set({ deletedAt: new Date() }).where(eq(yardStalls.id, stallId));
    });
  }

  async assignVehicle(ctx: CallerCtx, stallId: string, impoundId: string): Promise<YardStallDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const stall = await tx.query.yardStalls.findFirst({
        where: and(eq(yardStalls.id, stallId), isNull(yardStalls.deletedAt)),
      });
      if (!stall) throw notFound('Stall not found');
      const record = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, impoundId), isNull(impoundRecords.deletedAt)),
      });
      if (!record) throw notFound('Impound record not found in this tenant');

      const vehicle = record.vehicleId
        ? await tx.query.vehicles.findFirst({ where: eq(vehicles.id, record.vehicleId) })
        : null;
      const { vehicleClass, isElectric } = classifyFromVehicle(vehicle ?? null);

      const check = validateStallAssignment({
        stall: {
          deletedAt: stall.deletedAt,
          occupiedByImpoundId: stall.occupiedByImpoundId,
          stallType: stall.stallType,
        },
        impoundId,
        vehicleClass,
        isElectric,
      });
      if (!check.allowed) {
        throw new ConflictException({
          code: 'STALL_ASSIGNMENT_BLOCKED',
          message: check.reason ?? 'Assignment not allowed.',
        });
      }

      const now = new Date();
      // Move semantics: free any other stall this vehicle currently occupies
      // so the occupant-unique index never trips.
      await tx
        .update(yardStalls)
        .set({ occupiedByImpoundId: null, occupiedSince: null, updatedAt: now })
        .where(and(eq(yardStalls.occupiedByImpoundId, impoundId), isNull(yardStalls.deletedAt)));

      const [row] = await tx
        .update(yardStalls)
        .set({ occupiedByImpoundId: impoundId, occupiedSince: now, updatedAt: now })
        .where(eq(yardStalls.id, stallId))
        .returning();
      if (!row) throw notFound('Stall not found');
      return toStallDto(row);
    });
  }

  async releaseStall(ctx: CallerCtx, stallId: string): Promise<YardStallDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const stall = await tx.query.yardStalls.findFirst({
        where: and(eq(yardStalls.id, stallId), isNull(yardStalls.deletedAt)),
      });
      if (!stall) throw notFound('Stall not found');
      // Idempotent: releasing an already-empty stall is a no-op success.
      if (!stall.occupiedByImpoundId) return toStallDto(stall);
      const [row] = await tx
        .update(yardStalls)
        .set({ occupiedByImpoundId: null, occupiedSince: null, updatedAt: new Date() })
        .where(eq(yardStalls.id, stallId))
        .returning();
      if (!row) throw notFound('Stall not found');
      return toStallDto(row);
    });
  }

  async bulkLayout(
    ctx: CallerCtx,
    facilityId: string,
    input: BulkStallLayoutPayload,
  ): Promise<YardStallDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const facility = await tx.query.yardFacilities.findFirst({
        where: and(eq(yardFacilities.id, facilityId), isNull(yardFacilities.deletedAt)),
      });
      if (!facility) throw notFound('Facility not found');
      const now = new Date();
      for (const s of input.stalls) {
        const patch: Partial<typeof yardStalls.$inferInsert> & { updatedAt: Date } = {
          x: s.x,
          y: s.y,
          updatedAt: now,
        };
        if (s.stallType !== undefined) patch.stallType = s.stallType;
        await tx
          .update(yardStalls)
          .set(patch)
          .where(
            and(
              eq(yardStalls.id, s.id),
              eq(yardStalls.facilityId, facilityId),
              isNull(yardStalls.deletedAt),
            ),
          );
      }
      const rows = await tx.query.yardStalls.findMany({
        where: and(eq(yardStalls.facilityId, facilityId), isNull(yardStalls.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.y), asc(t.x)],
      });
      return rows.map(toStallDto);
    });
  }

  async registerPhoto(
    ctx: CallerCtx,
    stallId: string,
    input: RegisterStallPhotoPayload,
  ): Promise<YardStallPhotoDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const stall = await tx.query.yardStalls.findFirst({
        where: and(eq(yardStalls.id, stallId), isNull(yardStalls.deletedAt)),
      });
      if (!stall) throw notFound('Stall not found');
      const [row] = await tx
        .insert(yardStallPhotos)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          stallId,
          photoUrl: input.photoUrl,
          photoType: input.photoType,
          capturedByUserId: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('registerPhoto: insert returning() yielded no row');
      return toPhotoDto(row);
    });
  }
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

export function toStallDto(row: typeof yardStalls.$inferSelect): YardStallDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    facilityId: row.facilityId,
    label: row.label,
    rowLabel: row.rowLabel,
    colLabel: row.colLabel,
    x: row.x,
    y: row.y,
    stallType: row.stallType,
    occupiedByImpoundId: row.occupiedByImpoundId,
    occupiedSince: row.occupiedSince ? row.occupiedSince.toISOString() : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toPhotoDto(row: typeof yardStallPhotos.$inferSelect): YardStallPhotoDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    stallId: row.stallId,
    photoUrl: row.photoUrl,
    photoType: row.photoType,
    capturedAt: row.capturedAt.toISOString(),
    capturedByUserId: row.capturedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}
