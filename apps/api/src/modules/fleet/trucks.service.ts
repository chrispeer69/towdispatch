/**
 * TrucksService — full CRUD on the trucks table.
 *
 * Hot-path invariant: trucks.in_service stays in sync with status='active'.
 * Writes here update both columns; the dispatch board reads in_service for
 * the indexed boolean lookup, while reporting and alerts read status for
 * the four-way state.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { trucks, uuidv7 } from '@ustowdispatch/db';
import {
  type CreateTruckPayload,
  ERROR_CODES,
  type PaginatedTrucks,
  type TruckDto,
  type TruckFilters,
  type UpdateTruckPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const PG_UNIQUE_VIOLATION = '23505';
interface PgError {
  code?: string;
  constraint?: string;
}
const isUniqueViolation = (err: unknown): err is PgError =>
  Boolean(err && typeof err === 'object' && (err as PgError).code === PG_UNIQUE_VIOLATION);

@Injectable()
export class TrucksService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: CallerContext, filters: TruckFilters): Promise<PaginatedTrucks> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(trucks.deletedAt)];
      if (filters.status) conds.push(eq(trucks.status, filters.status));
      if (filters.capacityClass) conds.push(eq(trucks.capacityClass, filters.capacityClass));
      if (filters.equipment) {
        // text[] containment — equipment array contains the filter value.
        conds.push(sql`${trucks.equipment} @> ARRAY[${filters.equipment}]::text[]`);
      }
      if (filters.q) {
        const pat = `%${filters.q.toLowerCase()}%`;
        conds.push(
          or(
            sql`lower(${trucks.unitNumber}) LIKE ${pat}`,
            sql`lower(coalesce(${trucks.make}, '')) LIKE ${pat}`,
            sql`lower(coalesce(${trucks.model}, '')) LIKE ${pat}`,
            sql`lower(coalesce(${trucks.vin}, '')) LIKE ${pat}`,
            sql`lower(coalesce(${trucks.plate}, '')) LIKE ${pat}`,
          ) as ReturnType<typeof eq>,
        );
      }
      const whereExpr = and(...conds);

      const countRow = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(trucks)
        .where(whereExpr);
      const total = countRow[0]?.count ?? 0;
      const rows = await tx.query.trucks.findMany({
        where: whereExpr,
        orderBy: (t, { asc }) => [asc(t.unitNumber)],
        limit: filters.perPage,
        offset: (filters.page - 1) * filters.perPage,
      });
      return {
        data: rows.map(toTruckDto),
        page: filters.page,
        perPage: filters.perPage,
        total,
      };
    });
  }

  async get(ctx: CallerContext, id: string): Promise<TruckDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.trucks.findFirst({
        where: and(eq(trucks.id, id), isNull(trucks.deletedAt)),
      });
      if (!row) throw notFound();
      return toTruckDto(row);
    });
  }

  async create(ctx: CallerContext, input: CreateTruckPayload): Promise<TruckDto> {
    const id = uuidv7();
    try {
      const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const [r] = await tx
          .insert(trucks)
          .values({
            id,
            tenantId: ctx.tenantId,
            unitNumber: input.unitNumber,
            truckType: input.truckType,
            year: input.year ?? null,
            make: input.make ?? null,
            model: input.model ?? null,
            plate: input.plate ?? null,
            plateState: input.plateState ?? null,
            vin: input.vin ?? null,
            capacityClass: input.capacityClass ?? null,
            gvwrLbs: input.gvwrLbs ?? null,
            fuelType: input.fuelType ?? null,
            equipment: input.equipment ?? null,
            registrationExpiresAt: input.registrationExpiresAt ?? null,
            insuranceExpiresAt: input.insuranceExpiresAt ?? null,
            iftaLicense: input.iftaLicense ?? null,
            irpAccount: input.irpAccount ?? null,
            teslaCertified: input.teslaCertified ?? false,
            aaaFlatbed: input.aaaFlatbed ?? false,
            heavyDutyCapable: input.heavyDutyCapable ?? false,
            currentOdometer: input.currentOdometer ?? null,
            odometerUpdatedAt: input.currentOdometer !== undefined ? new Date() : null,
            status: input.status,
            inService: input.status === 'active',
            notes: input.notes ?? null,
            createdBy: ctx.userId,
          })
          .returning();
        if (!r) throw new Error('insert trucks .. returning() yielded no row');
        return r;
      });
      return toTruckDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict();
      throw err;
    }
  }

  async update(ctx: CallerContext, id: string, input: UpdateTruckPayload): Promise<TruckDto> {
    try {
      const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const existing = await tx.query.trucks.findFirst({
          where: and(eq(trucks.id, id), isNull(trucks.deletedAt)),
        });
        if (!existing) return null;
        const patch: Partial<typeof trucks.$inferInsert> & { updatedAt: Date } = {
          updatedAt: new Date(),
        };
        for (const k of Object.keys(input) as Array<keyof UpdateTruckPayload>) {
          const v = input[k];
          if (v === undefined) continue;
          // biome-ignore lint/suspicious/noExplicitAny: dynamic patch dispatch — schema-constrained at the Zod boundary
          (patch as any)[k] = v;
        }
        if (input.currentOdometer !== undefined) {
          patch.odometerUpdatedAt = new Date();
        }
        if (input.status !== undefined) {
          patch.inService = input.status === 'active';
        }
        const [row] = await tx.update(trucks).set(patch).where(eq(trucks.id, id)).returning();
        return row;
      });
      if (!updated) throw notFound();
      return toTruckDto(updated);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict();
      throw err;
    }
  }

  async softDelete(ctx: CallerContext, id: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .update(trucks)
        .set({ deletedAt: new Date(), updatedAt: new Date(), inService: false, status: 'retired' })
        .where(and(eq(trucks.id, id), isNull(trucks.deletedAt)))
        .returning({ id: trucks.id });
      return Boolean(row);
    });
    if (!ok) throw notFound();
  }

  /**
   * Internal hook used by DvirsService to flip a truck out of service when
   * an out_of_service DVIR is submitted. Same tenant context, same actor —
   * audit_log captures the cascading update.
   */
  async markInMaintenance(ctx: CallerContext, truckId: string, reason: string): Promise<void> {
    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      await tx
        .update(trucks)
        .set({
          status: 'in_maintenance',
          inService: false,
          updatedAt: new Date(),
          notes: sql`coalesce(${trucks.notes} || E'\n', '') || ${`[auto] ${reason}`}`,
        })
        .where(and(eq(trucks.id, truckId), isNull(trucks.deletedAt)));
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

const notFound = (): NotFoundException =>
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Truck not found' });
const conflict = (): ConflictException =>
  new ConflictException({
    code: ERROR_CODES.CONFLICT,
    message: 'A truck with that unit_number already exists',
  });

export function toTruckDto(t: typeof trucks.$inferSelect): TruckDto {
  return {
    id: t.id,
    tenantId: t.tenantId,
    unitNumber: t.unitNumber,
    truckType: t.truckType,
    year: t.year,
    make: t.make,
    model: t.model,
    plate: t.plate,
    plateState: t.plateState,
    vin: t.vin,
    capacityClass: t.capacityClass,
    gvwrLbs: t.gvwrLbs,
    fuelType: t.fuelType,
    equipment: (t.equipment as TruckDto['equipment']) ?? null,
    registrationExpiresAt: t.registrationExpiresAt,
    insuranceExpiresAt: t.insuranceExpiresAt,
    iftaLicense: t.iftaLicense,
    irpAccount: t.irpAccount,
    teslaCertified: t.teslaCertified,
    aaaFlatbed: t.aaaFlatbed,
    heavyDutyCapable: t.heavyDutyCapable,
    currentOdometer: t.currentOdometer,
    odometerUpdatedAt: t.odometerUpdatedAt ? t.odometerUpdatedAt.toISOString() : null,
    status: t.status,
    inService: t.inService,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
  };
}
