/**
 * Fleet DriversService — full CRUD on the drivers table.
 *
 * Distinct from the dispatch-side DriversService (Session 5) which deals in
 * shifts and roster. This one owns the long-lived driver profile: hire,
 * licenses, certifications, employment status, and the soft-delete edge.
 *
 * Soft-delete shaped, RLS-bound via TenantAwareDb.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { drivers, uuidv7 } from '@towdispatch/db';
import {
  type CreateDriverPayload,
  type DriverDto,
  type DriverFilters,
  ERROR_CODES,
  type PaginatedDrivers,
  type UpdateDriverPayload,
} from '@towdispatch/shared';
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
export class FleetDriversService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: CallerContext, filters: DriverFilters): Promise<PaginatedDrivers> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(drivers.deletedAt)];
      if (filters.employmentStatus)
        conds.push(eq(drivers.employmentStatus, filters.employmentStatus));
      if (filters.cdlClass) conds.push(eq(drivers.cdlClass, filters.cdlClass));
      if (filters.yardId) conds.push(eq(drivers.assignedYardId, filters.yardId));
      if (filters.q) {
        const pat = `%${filters.q.toLowerCase()}%`;
        conds.push(
          or(
            sql`lower(${drivers.firstName}) LIKE ${pat}`,
            sql`lower(${drivers.lastName}) LIKE ${pat}`,
            sql`lower(coalesce(${drivers.email}, '')) LIKE ${pat}`,
            sql`coalesce(${drivers.phone}, '') LIKE ${pat}`,
            sql`lower(coalesce(${drivers.employeeNumber}, '')) LIKE ${pat}`,
          ) as ReturnType<typeof eq>,
        );
      }
      const whereExpr = and(...conds);

      const countRow = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(drivers)
        .where(whereExpr);
      const total = countRow[0]?.count ?? 0;
      const rows = await tx.query.drivers.findMany({
        where: whereExpr,
        orderBy: (t, { asc }) => [asc(t.lastName), asc(t.firstName)],
        limit: filters.perPage,
        offset: (filters.page - 1) * filters.perPage,
      });
      return {
        data: rows.map(toDriverDto),
        page: filters.page,
        perPage: filters.perPage,
        total,
      };
    });
  }

  async get(ctx: CallerContext, id: string): Promise<DriverDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.drivers.findFirst({
        where: and(eq(drivers.id, id), isNull(drivers.deletedAt)),
      });
      if (!row) throw notFound();
      return toDriverDto(row);
    });
  }

  async create(ctx: CallerContext, input: CreateDriverPayload): Promise<DriverDto> {
    const id = uuidv7();
    try {
      const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const [r] = await tx
          .insert(drivers)
          .values({
            id,
            tenantId: ctx.tenantId,
            userId: input.userId ?? null,
            employeeNumber: input.employeeNumber ?? null,
            firstName: input.firstName,
            lastName: input.lastName,
            preferredName: input.preferredName ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            cdlClass: input.cdlClass,
            cdlExpiresAt: input.cdlExpiresAt ?? null,
            licenseNumber: input.licenseNumber ?? null,
            licenseState: input.licenseState ?? null,
            licenseExpiresAt: input.licenseExpiresAt ?? null,
            medicalCardExpiresAt: input.medicalCardExpiresAt ?? null,
            drugTestLastAt: input.drugTestLastAt ?? null,
            roadTestCompletedAt: input.roadTestCompletedAt ?? null,
            motorClubCredentials: input.motorClubCredentials ?? null,
            certifications: input.certifications ?? null,
            hiredAt: input.hiredAt ?? null,
            employmentStatus: input.employmentStatus,
            assignedYardId: input.assignedYardId ?? null,
            commissionRuleId: input.commissionRuleId ?? null,
            defaultCommissionPct:
              input.defaultCommissionPct === undefined
                ? null
                : input.defaultCommissionPct.toFixed(2),
            notes: input.notes ?? null,
            active: input.employmentStatus === 'active',
            createdBy: ctx.userId,
          })
          .returning();
        if (!r) throw new Error('insert drivers .. returning() yielded no row');
        return r;
      });
      return toDriverDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict();
      throw err;
    }
  }

  async update(ctx: CallerContext, id: string, input: UpdateDriverPayload): Promise<DriverDto> {
    try {
      const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const existing = await tx.query.drivers.findFirst({
          where: and(eq(drivers.id, id), isNull(drivers.deletedAt)),
        });
        if (!existing) return null;
        const patch: Partial<typeof drivers.$inferInsert> & { updatedAt: Date } = {
          updatedAt: new Date(),
        };
        for (const k of Object.keys(input) as Array<keyof UpdateDriverPayload>) {
          const v = input[k];
          if (v === undefined) continue;
          if (k === 'defaultCommissionPct') {
            // numeric(5,2) — drizzle expects a string for numeric columns.
            patch.defaultCommissionPct = v === null ? null : (v as number).toFixed(2);
            continue;
          }
          // biome-ignore lint/suspicious/noExplicitAny: dynamic patch dispatch — schema-constrained at the Zod boundary
          (patch as any)[k] = v;
        }
        // Keep the hot-path active flag in sync with employment_status.
        if (input.employmentStatus !== undefined) {
          patch.active = input.employmentStatus === 'active';
        }
        const [row] = await tx.update(drivers).set(patch).where(eq(drivers.id, id)).returning();
        return row;
      });
      if (!updated) throw notFound();
      return toDriverDto(updated);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict();
      throw err;
    }
  }

  async softDelete(ctx: CallerContext, id: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .update(drivers)
        .set({ deletedAt: new Date(), updatedAt: new Date(), active: false })
        .where(and(eq(drivers.id, id), isNull(drivers.deletedAt)))
        .returning({ id: drivers.id });
      return Boolean(row);
    });
    if (!ok) throw notFound();
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
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Driver not found' });

const conflict = (): ConflictException =>
  new ConflictException({
    code: ERROR_CODES.CONFLICT,
    message: 'Driver with that employee_number or user already exists',
  });

export function toDriverDto(d: typeof drivers.$inferSelect): DriverDto {
  return {
    id: d.id,
    tenantId: d.tenantId,
    userId: d.userId,
    employeeNumber: d.employeeNumber,
    firstName: d.firstName,
    lastName: d.lastName,
    preferredName: d.preferredName,
    phone: d.phone,
    email: d.email,
    cdlClass: d.cdlClass,
    cdlExpiresAt: d.cdlExpiresAt,
    licenseNumber: d.licenseNumber,
    licenseState: d.licenseState,
    licenseExpiresAt: d.licenseExpiresAt,
    medicalCardExpiresAt: d.medicalCardExpiresAt,
    drugTestLastAt: d.drugTestLastAt,
    roadTestCompletedAt: d.roadTestCompletedAt,
    motorClubCredentials: (d.motorClubCredentials as DriverDto['motorClubCredentials']) ?? null,
    certifications: (d.certifications as DriverDto['certifications']) ?? null,
    hiredAt: d.hiredAt,
    employmentStatus: d.employmentStatus,
    assignedYardId: d.assignedYardId,
    commissionRuleId: d.commissionRuleId,
    defaultCommissionPct: d.defaultCommissionPct === null ? null : Number(d.defaultCommissionPct),
    notes: d.notes,
    active: d.active,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
  };
}
