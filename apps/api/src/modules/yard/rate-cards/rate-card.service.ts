/**
 * RateCardService — per-facility, per-vehicle-class storage rate cards
 * (Yard Management, Session 54). CRUD plus effective-window overlap
 * validation: no two live cards for the same (facility, vehicle_class) may
 * have overlapping [effective_from, effective_to] windows, so resolveRate
 * is always unambiguous.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { storageRateCards, uuidv7, yardFacilities } from '@ustowdispatch/db';
import type {
  CreateStorageRateCardPayload,
  StorageRateCardDto,
  StorageVehicleClass,
  UpdateStorageRateCardPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../../database/tenant-aware-db.service.js';
import { rateWindowsOverlap } from '../storage-rate.logic.js';
import type { CallerCtx } from '../yard-facility.service.js';

@Injectable()
export class RateCardService {
  constructor(private readonly db: TenantAwareDb) {}

  async listForFacility(
    ctx: CallerCtx,
    facilityId: string,
    vehicleClass?: StorageVehicleClass,
  ): Promise<StorageRateCardDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [
        eq(storageRateCards.facilityId, facilityId),
        isNull(storageRateCards.deletedAt),
      ];
      if (vehicleClass) clauses.push(eq(storageRateCards.vehicleClass, vehicleClass));
      const rows = await tx.query.storageRateCards.findMany({
        where: and(...clauses),
        orderBy: (t, { asc, desc }) => [asc(t.vehicleClass), desc(t.effectiveFrom)],
      });
      return rows.map(toRateCardDto);
    });
  }

  async create(
    ctx: CallerCtx,
    facilityId: string,
    input: CreateStorageRateCardPayload,
  ): Promise<StorageRateCardDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const facility = await tx.query.yardFacilities.findFirst({
        where: and(eq(yardFacilities.id, facilityId), isNull(yardFacilities.deletedAt)),
      });
      if (!facility) throw notFound('Facility not found');
      await this.assertNoOverlap(tx, facilityId, input.vehicleClass, {
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      });
      const [row] = await tx
        .insert(storageRateCards)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          facilityId,
          name: input.name,
          vehicleClass: input.vehicleClass,
          dailyRateCents: input.dailyRateCents,
          freeDays: input.freeDays,
          maxDailyRateCents: input.maxDailyRateCents ?? null,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('createRateCard: insert returning() yielded no row');
      return toRateCardDto(row);
    });
  }

  async update(
    ctx: CallerCtx,
    rateCardId: string,
    input: UpdateStorageRateCardPayload,
  ): Promise<StorageRateCardDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.storageRateCards.findFirst({
        where: and(eq(storageRateCards.id, rateCardId), isNull(storageRateCards.deletedAt)),
      });
      if (!existing) throw notFound('Rate card not found');
      const nextFrom = input.effectiveFrom ?? existing.effectiveFrom;
      const nextTo = input.effectiveTo !== undefined ? input.effectiveTo : existing.effectiveTo;
      if (nextTo !== null && nextTo < nextFrom) {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'effectiveTo must be on or after effectiveFrom.',
        });
      }
      await this.assertNoOverlap(
        tx,
        existing.facilityId,
        existing.vehicleClass,
        { effectiveFrom: nextFrom, effectiveTo: nextTo },
        rateCardId,
      );
      const patch: Partial<typeof storageRateCards.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.dailyRateCents !== undefined) patch.dailyRateCents = input.dailyRateCents;
      if (input.freeDays !== undefined) patch.freeDays = input.freeDays;
      if (input.maxDailyRateCents !== undefined)
        patch.maxDailyRateCents = input.maxDailyRateCents ?? null;
      if (input.effectiveFrom !== undefined) patch.effectiveFrom = input.effectiveFrom;
      if (input.effectiveTo !== undefined) patch.effectiveTo = input.effectiveTo ?? null;
      const [row] = await tx
        .update(storageRateCards)
        .set(patch)
        .where(and(eq(storageRateCards.id, rateCardId), isNull(storageRateCards.deletedAt)))
        .returning();
      if (!row) throw notFound('Rate card not found');
      return toRateCardDto(row);
    });
  }

  async softDelete(ctx: CallerCtx, rateCardId: string): Promise<void> {
    await this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.storageRateCards.findFirst({
        where: and(eq(storageRateCards.id, rateCardId), isNull(storageRateCards.deletedAt)),
      });
      if (!existing) throw notFound('Rate card not found');
      await tx
        .update(storageRateCards)
        .set({ deletedAt: new Date() })
        .where(eq(storageRateCards.id, rateCardId));
    });
  }

  /** Reject a window that overlaps an existing live card for the same key. */
  private async assertNoOverlap(
    tx: Parameters<Parameters<TenantAwareDb['runInTenantContext']>[1]>[0],
    facilityId: string,
    vehicleClass: StorageVehicleClass,
    window: { effectiveFrom: string; effectiveTo: string | null },
    excludeId?: string,
  ): Promise<void> {
    const existing = await tx.query.storageRateCards.findMany({
      where: and(
        eq(storageRateCards.facilityId, facilityId),
        eq(storageRateCards.vehicleClass, vehicleClass),
        isNull(storageRateCards.deletedAt),
      ),
      columns: { id: true, effectiveFrom: true, effectiveTo: true },
    });
    for (const c of existing) {
      if (excludeId && c.id === excludeId) continue;
      if (
        rateWindowsOverlap(window, { effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo })
      ) {
        throw new ConflictException({
          code: 'RATE_WINDOW_OVERLAP',
          message: `Effective window overlaps an existing ${vehicleClass} rate card for this facility.`,
        });
      }
    }
  }
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

export function toRateCardDto(row: typeof storageRateCards.$inferSelect): StorageRateCardDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    facilityId: row.facilityId,
    name: row.name,
    vehicleClass: row.vehicleClass,
    dailyRateCents: row.dailyRateCents,
    freeDays: row.freeDays,
    maxDailyRateCents: row.maxDailyRateCents,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
