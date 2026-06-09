/**
 * ServiceCatalogService — list / get / create / update / soft-delete the
 * tenant-level Service Catalog (Tow, Mileage, Admin Fee, Storage, …).
 *
 * Pricing is intentionally NOT on this surface — that lands with the
 * Master Rate Sheet (build 2 of the Admin Settings rollout).
 *
 * All reads/writes flow through TenantAwareDb so RLS enforces isolation
 * even when a query forgets a tenant_id filter. The audit trigger on
 * service_catalog captures every mutation.
 *
 * Concurrency: uniqueness on (tenant_id, code) is enforced by the partial
 * unique index in migration 0022; we still pre-check for a friendlier 409,
 * and the DB index is the source of truth if the pre-check races.
 */
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { serviceCatalog, uuidv7 } from '@towdispatch/db';
import {
  type CreateServiceCatalogPayload,
  ERROR_CODES,
  type SeedDefaultServiceCatalogResponse,
  type ServiceCatalogEntryDto,
  type ServiceCatalogFilters,
  type UpdateServiceCatalogPayload,
} from '@towdispatch/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class ServiceCatalogService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(
    ctx: CallerContext,
    filters: ServiceCatalogFilters,
  ): Promise<ServiceCatalogEntryDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(serviceCatalog.deletedAt)];
      if (filters.category) conds.push(eq(serviceCatalog.category, filters.category));
      if (filters.active !== undefined) conds.push(eq(serviceCatalog.isActive, filters.active));
      if (filters.vehicleClass) {
        // text[] contains check. Empty applicable_vehicle_classes means
        // "class-independent" so those rows match every vehicle-class filter.
        conds.push(
          sql`(${serviceCatalog.applicableVehicleClasses} @> ARRAY[${filters.vehicleClass}]::text[]
               OR cardinality(${serviceCatalog.applicableVehicleClasses}) = 0)`,
        );
      }
      if (filters.q) {
        const pattern = `%${filters.q.toLowerCase()}%`;
        conds.push(
          sql`(lower(${serviceCatalog.name}) LIKE ${pattern}
               OR lower(${serviceCatalog.code}) LIKE ${pattern})`,
        );
      }

      const rows = await tx
        .select()
        .from(serviceCatalog)
        .where(and(...conds))
        .orderBy(
          asc(serviceCatalog.category),
          asc(serviceCatalog.sortOrder),
          asc(serviceCatalog.name),
        );
      return rows.map(toDto);
    });
  }

  async get(ctx: CallerContext, id: string): Promise<ServiceCatalogEntryDto> {
    const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      return tx.query.serviceCatalog.findFirst({
        where: and(eq(serviceCatalog.id, id), isNull(serviceCatalog.deletedAt)),
      });
    });
    if (!row) throw notFound();
    return toDto(row);
  }

  async create(
    ctx: CallerContext,
    input: CreateServiceCatalogPayload,
  ): Promise<ServiceCatalogEntryDto> {
    const id = uuidv7();
    const isQuoted = input.calculationUnit === 'quoted';
    const inserted = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conflict = await tx.query.serviceCatalog.findFirst({
        where: and(eq(serviceCatalog.code, input.code), isNull(serviceCatalog.deletedAt)),
      });
      if (conflict) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: `A service with code "${input.code}" already exists`,
        });
      }
      const [row] = await tx
        .insert(serviceCatalog)
        .values({
          id,
          tenantId: ctx.tenantId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          category: input.category,
          calculationUnit: input.calculationUnit,
          applicableVehicleClasses: input.applicableVehicleClasses,
          isQuoted,
          defaultCommissionPctOverride: input.defaultCommissionPctOverride ?? null,
          supportsPerResourceMultiplier: input.supportsPerResourceMultiplier ?? false,
          isActive: input.isActive ?? true,
          sortOrder: input.sortOrder ?? 0,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      if (!row) {
        throw new InternalServerErrorException({
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'insert service_catalog returned no row',
        });
      }
      return row;
    });
    return toDto(inserted);
  }

  async update(
    ctx: CallerContext,
    id: string,
    input: UpdateServiceCatalogPayload,
  ): Promise<ServiceCatalogEntryDto> {
    const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.serviceCatalog.findFirst({
        where: and(eq(serviceCatalog.id, id), isNull(serviceCatalog.deletedAt)),
      });
      if (!existing) return null;

      // Resolve the final calculation_unit + is_quoted pair atomically so the
      // CHECK constraint never sees an inconsistent intermediate state.
      const finalCalcUnit = input.calculationUnit ?? existing.calculationUnit;
      const finalIsQuoted = finalCalcUnit === 'quoted';

      if (input.code !== undefined && input.code !== existing.code) {
        const conflict = await tx.query.serviceCatalog.findFirst({
          where: and(eq(serviceCatalog.code, input.code), isNull(serviceCatalog.deletedAt)),
        });
        if (conflict && conflict.id !== id) {
          throw new ConflictException({
            code: ERROR_CODES.CONFLICT,
            message: `A service with code "${input.code}" already exists`,
          });
        }
      }

      const patch: Partial<typeof serviceCatalog.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
        updatedBy: ctx.userId,
        calculationUnit: finalCalcUnit,
        isQuoted: finalIsQuoted,
      };
      if (input.code !== undefined) patch.code = input.code;
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;
      if (input.category !== undefined) patch.category = input.category;
      if (input.applicableVehicleClasses !== undefined) {
        patch.applicableVehicleClasses = input.applicableVehicleClasses;
      }
      if (input.defaultCommissionPctOverride !== undefined) {
        patch.defaultCommissionPctOverride = input.defaultCommissionPctOverride;
      }
      if (input.supportsPerResourceMultiplier !== undefined) {
        patch.supportsPerResourceMultiplier = input.supportsPerResourceMultiplier;
      }
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

      const [row] = await tx
        .update(serviceCatalog)
        .set(patch)
        .where(eq(serviceCatalog.id, id))
        .returning();
      return row ?? null;
    });
    if (!updated) throw notFound();
    return toDto(updated);
  }

  async softDelete(ctx: CallerContext, id: string): Promise<void> {
    const result = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.serviceCatalog.findFirst({
        where: and(eq(serviceCatalog.id, id), isNull(serviceCatalog.deletedAt)),
      });
      if (!existing) return { ok: false as const };
      const [row] = await tx
        .update(serviceCatalog)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          isActive: false,
          updatedBy: ctx.userId,
        })
        .where(and(eq(serviceCatalog.id, id), isNull(serviceCatalog.deletedAt)))
        .returning({ id: serviceCatalog.id });
      return { ok: Boolean(row) };
    });
    if (!result.ok) throw notFound();
  }

  /**
   * Idempotent: invokes the SECURITY DEFINER fn_seed_default_service_catalog
   * which inserts the 45-row default catalog only when the tenant currently
   * has zero rows. Used by the empty-state "Seed default services" button so
   * tenants that somehow ended up with an empty catalog can recover without
   * an ops escalation.
   */
  async seedDefaults(ctx: CallerContext): Promise<SeedDefaultServiceCatalogResponse> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (_tx, client) => {
      const result = await client.query<{ inserted: number }>(
        'SELECT fn_seed_default_service_catalog($1)::int AS inserted',
        [ctx.tenantId],
      );
      const inserted = Number(result.rows[0]?.inserted ?? 0);
      return { inserted };
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
  new NotFoundException({
    code: ERROR_CODES.NOT_FOUND,
    message: 'Service not found',
  });

function toDto(r: typeof serviceCatalog.$inferSelect): ServiceCatalogEntryDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    code: r.code,
    name: r.name,
    description: r.description,
    category: r.category,
    calculationUnit: r.calculationUnit,
    applicableVehicleClasses:
      r.applicableVehicleClasses as ServiceCatalogEntryDto['applicableVehicleClasses'],
    isQuoted: r.isQuoted,
    defaultCommissionPctOverride: r.defaultCommissionPctOverride,
    supportsPerResourceMultiplier: r.supportsPerResourceMultiplier,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
  };
}
