/**
 * VehiclesService — full CRUD plus plate-or-VIN lookup and search.
 *
 * lookup() returns the matching vehicle for this tenant if known; if the
 * vehicle has not been seen before, the controller returns 404. A future
 * session will fall through to an external VIN-decode provider.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { customerVehicles, customers, uuidv7, vehicles } from '@ustowdispatch/db';
import {
  type CreateVehiclePayload,
  ERROR_CODES,
  type PaginatedVehicles,
  type UpdateVehiclePayload,
  type VehicleDto,
  type VehicleFilters,
  type VehicleLookupQuery,
  type VehicleSearchQuery,
  type VehicleWithCustomersDto,
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
}

const isUniqueViolation = (err: unknown): err is PgError => {
  if (!err || typeof err !== 'object') return false;
  return (err as PgError).code === PG_UNIQUE_VIOLATION;
};

@Injectable()
export class VehiclesService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: CallerContext, filters: VehicleFilters): Promise<PaginatedVehicles> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(vehicles.deletedAt)];
      if (filters.make) conds.push(sql`lower(${vehicles.make}) = ${filters.make.toLowerCase()}`);
      if (filters.year !== undefined) conds.push(eq(vehicles.year, filters.year));
      if (filters.vehicleClass) conds.push(eq(vehicles.vehicleClass, filters.vehicleClass));
      if (filters.q) {
        const pattern = `%${filters.q.toLowerCase()}%`;
        conds.push(
          or(
            sql`lower(coalesce(${vehicles.make}, '')) LIKE ${pattern}`,
            sql`lower(coalesce(${vehicles.model}, '')) LIKE ${pattern}`,
            sql`lower(coalesce(${vehicles.vin}, '')) LIKE ${pattern}`,
            sql`lower(coalesce(${vehicles.plate}, '')) LIKE ${pattern}`,
          ) as ReturnType<typeof eq>,
        );
      }
      const whereExpr = and(...conds);

      const countRow = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(vehicles)
        .where(whereExpr);
      const total = countRow[0]?.count ?? 0;

      const rows = await tx.query.vehicles.findMany({
        where: whereExpr,
        orderBy: (table, { desc }) => [desc(table.createdAt)],
        limit: filters.perPage,
        offset: (filters.page - 1) * filters.perPage,
      });
      return {
        data: rows.map(toDto),
        page: filters.page,
        perPage: filters.perPage,
        total,
      };
    });
  }

  async get(ctx: CallerContext, id: string): Promise<VehicleWithCustomersDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.vehicles.findFirst({
        where: and(eq(vehicles.id, id), isNull(vehicles.deletedAt)),
      });
      if (!row) throw notFound();
      const linked = await tx
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          relationship: customerVehicles.relationship,
          isPrimary: customerVehicles.isPrimary,
        })
        .from(customerVehicles)
        .innerJoin(customers, eq(customers.id, customerVehicles.customerId))
        .where(
          and(
            eq(customerVehicles.vehicleId, id),
            isNull(customerVehicles.deletedAt),
            isNull(customers.deletedAt),
          ),
        );
      return {
        ...toDto(row),
        customers: linked.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone ?? null,
          relationship: c.relationship,
          isPrimary: c.isPrimary,
        })),
      };
    });
  }

  async create(ctx: CallerContext, input: CreateVehiclePayload): Promise<VehicleDto> {
    const id = uuidv7();
    try {
      const inserted = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const [row] = await tx
          .insert(vehicles)
          .values({
            id,
            tenantId: ctx.tenantId,
            vin: input.vin ?? null,
            plate: input.plate ?? null,
            plateState: input.plateState ?? null,
            year: input.year ?? null,
            make: input.make ?? null,
            model: input.model ?? null,
            trim: input.trim ?? null,
            color: input.color ?? null,
            bodyClass: input.bodyClass ?? null,
            vehicleClass: input.vehicleClass,
            drivetrain: input.drivetrain ?? null,
            isElectric: input.isElectric ?? false,
            isLowClearance: input.isLowClearance ?? false,
            specialInstructions: input.specialInstructions ?? null,
            defaultCustomerId: input.defaultCustomerId ?? null,
            createdBy: ctx.userId,
          })
          .returning();
        if (!row) throw new Error('insert vehicles .. returning() yielded no row');
        return row;
      });
      return toDto(inserted);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'A vehicle with that VIN already exists in this tenant',
        });
      }
      throw err;
    }
  }

  async update(ctx: CallerContext, id: string, input: UpdateVehiclePayload): Promise<VehicleDto> {
    try {
      const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const existing = await tx.query.vehicles.findFirst({
          where: and(eq(vehicles.id, id), isNull(vehicles.deletedAt)),
        });
        if (!existing) return null;

        const patch: Partial<typeof vehicles.$inferInsert> & { updatedAt: Date } = {
          updatedAt: new Date(),
        };
        if (input.vin !== undefined) patch.vin = input.vin;
        if (input.plate !== undefined) patch.plate = input.plate;
        if (input.plateState !== undefined) patch.plateState = input.plateState;
        if (input.year !== undefined) patch.year = input.year;
        if (input.make !== undefined) patch.make = input.make;
        if (input.model !== undefined) patch.model = input.model;
        if (input.trim !== undefined) patch.trim = input.trim;
        if (input.color !== undefined) patch.color = input.color;
        if (input.bodyClass !== undefined) patch.bodyClass = input.bodyClass;
        if (input.vehicleClass !== undefined) patch.vehicleClass = input.vehicleClass;
        if (input.drivetrain !== undefined) patch.drivetrain = input.drivetrain;
        if (input.isElectric !== undefined) patch.isElectric = input.isElectric;
        if (input.isLowClearance !== undefined) patch.isLowClearance = input.isLowClearance;
        if (input.specialInstructions !== undefined)
          patch.specialInstructions = input.specialInstructions;
        if (input.defaultCustomerId !== undefined)
          patch.defaultCustomerId = input.defaultCustomerId;

        const [row] = await tx.update(vehicles).set(patch).where(eq(vehicles.id, id)).returning();
        return row;
      });
      if (!updated) throw notFound();
      return toDto(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'A vehicle with that VIN already exists in this tenant',
        });
      }
      throw err;
    }
  }

  async softDelete(ctx: CallerContext, id: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .update(vehicles)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(vehicles.id, id), isNull(vehicles.deletedAt)))
        .returning({ id: vehicles.id });
      return Boolean(row);
    });
    if (!ok) throw notFound();
  }

  async lookup(ctx: CallerContext, query: VehicleLookupQuery): Promise<VehicleDto> {
    const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      if (query.vin) {
        return tx.query.vehicles.findFirst({
          where: and(eq(vehicles.vin, query.vin), isNull(vehicles.deletedAt)),
        });
      }
      // plate + state branch — schema refine guarantees both are present.
      return tx.query.vehicles.findFirst({
        where: and(
          eq(vehicles.plate, query.plate as string),
          eq(vehicles.plateState, query.state as string),
          isNull(vehicles.deletedAt),
        ),
      });
    });
    if (!row) throw notFound();
    return toDto(row);
  }

  async search(
    ctx: CallerContext,
    query: VehicleSearchQuery,
  ): Promise<
    Array<Pick<VehicleDto, 'id' | 'year' | 'make' | 'model' | 'vin' | 'plate' | 'plateState'>>
  > {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const pattern = `%${query.q.toLowerCase()}%`;
      const rows = await tx
        .select({
          id: vehicles.id,
          year: vehicles.year,
          make: vehicles.make,
          model: vehicles.model,
          vin: vehicles.vin,
          plate: vehicles.plate,
          plateState: vehicles.plateState,
        })
        .from(vehicles)
        .where(
          and(
            isNull(vehicles.deletedAt),
            or(
              sql`lower(coalesce(${vehicles.make}, '')) LIKE ${pattern}`,
              sql`lower(coalesce(${vehicles.model}, '')) LIKE ${pattern}`,
              sql`lower(coalesce(${vehicles.vin}, '')) LIKE ${pattern}`,
              sql`lower(coalesce(${vehicles.plate}, '')) LIKE ${pattern}`,
            ),
          ),
        )
        .orderBy(vehicles.make, vehicles.model)
        .limit(query.limit);
      return rows;
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
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Vehicle not found' });

function toDto(v: typeof vehicles.$inferSelect): VehicleDto {
  return {
    id: v.id,
    tenantId: v.tenantId,
    vin: v.vin,
    plate: v.plate,
    plateState: v.plateState,
    year: v.year,
    make: v.make,
    model: v.model,
    trim: v.trim,
    color: v.color,
    bodyClass: v.bodyClass,
    vehicleClass: v.vehicleClass,
    drivetrain: v.drivetrain,
    isElectric: v.isElectric,
    isLowClearance: v.isLowClearance,
    specialInstructions: v.specialInstructions,
    defaultCustomerId: v.defaultCustomerId,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    deletedAt: v.deletedAt ? v.deletedAt.toISOString() : null,
    createdBy: v.createdBy,
  };
}
