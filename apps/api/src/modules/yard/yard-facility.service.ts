/**
 * YardFacilityService — CRUD for the physical facilities a tenant operates
 * (Yard Management, Session 54). Every method runs inside runInTenantContext
 * so RLS isolates tenants; the controller gates by Role.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7, yardFacilities, yardStalls } from '@ustowdispatch/db';
import type {
  CreateYardFacilityPayload,
  UpdateYardFacilityPayload,
  YardFacilityAddress,
  YardFacilityDto,
  YardGateHours,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class YardFacilityService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: CallerCtx): Promise<YardFacilityDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.yardFacilities.findMany({
        where: isNull(yardFacilities.deletedAt),
        orderBy: (t, { asc }) => [asc(t.name)],
      });
      return rows.map(toFacilityDto);
    });
  }

  async get(ctx: CallerCtx, id: string): Promise<YardFacilityDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.yardFacilities.findFirst({
        where: and(eq(yardFacilities.id, id), isNull(yardFacilities.deletedAt)),
      });
      if (!row) throw notFound('Facility not found');
      return toFacilityDto(row);
    });
  }

  async create(ctx: CallerCtx, input: CreateYardFacilityPayload): Promise<YardFacilityDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const [row] = await tx
        .insert(yardFacilities)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          name: input.name,
          address: input.address ?? {},
          gateHours: input.gateHours ?? {},
          notes: input.notes ?? null,
          isActive: input.isActive,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('createFacility: insert returning() yielded no row');
      return toFacilityDto(row);
    });
  }

  async update(
    ctx: CallerCtx,
    id: string,
    input: UpdateYardFacilityPayload,
  ): Promise<YardFacilityDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.yardFacilities.findFirst({
        where: and(eq(yardFacilities.id, id), isNull(yardFacilities.deletedAt)),
      });
      if (!existing) throw notFound('Facility not found');
      const patch: Partial<typeof yardFacilities.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.address !== undefined) patch.address = input.address;
      if (input.gateHours !== undefined) patch.gateHours = input.gateHours;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      const [row] = await tx
        .update(yardFacilities)
        .set(patch)
        .where(and(eq(yardFacilities.id, id), isNull(yardFacilities.deletedAt)))
        .returning();
      if (!row) throw notFound('Facility not found');
      return toFacilityDto(row);
    });
  }

  async softDelete(ctx: CallerCtx, id: string): Promise<void> {
    await this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.yardFacilities.findFirst({
        where: and(eq(yardFacilities.id, id), isNull(yardFacilities.deletedAt)),
      });
      if (!existing) throw notFound('Facility not found');
      // Refuse to delete a facility that still has any live stall — the
      // operator must clear/move the layout first (mirrors impound yard).
      const liveStall = await tx.query.yardStalls.findFirst({
        where: and(eq(yardStalls.facilityId, id), isNull(yardStalls.deletedAt)),
        columns: { id: true },
      });
      if (liveStall) {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'Cannot delete a facility that still has stalls; remove the stalls first.',
        });
      }
      await tx
        .update(yardFacilities)
        .set({ deletedAt: new Date() })
        .where(eq(yardFacilities.id, id));
    });
  }
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

export function toFacilityDto(row: typeof yardFacilities.$inferSelect): YardFacilityDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    address: (row.address ?? {}) as YardFacilityAddress,
    gateHours: (row.gateHours ?? {}) as YardGateHours,
    notes: row.notes,
    isActive: row.isActive,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
