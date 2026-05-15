/**
 * CustomersService — full CRUD plus search and customer↔vehicle linking.
 *
 * Search returns up to N matches with the vehicle count attached so the
 * dispatcher autocomplete can show "Sam Carter — 2 vehicles" inline.
 *
 * Phone uniqueness within a tenant (live rows only) is enforced by a partial
 * unique index in the DB. We catch the unique-violation 23505 SQLSTATE and
 * map it to a friendly 409.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { customerVehicles, customers, uuidv7, vehicles } from '@ustowdispatch/db';
import {
  type CreateCustomerPayload,
  type CustomerDto,
  type CustomerFilters,
  type CustomerSearchQuery,
  type CustomerSearchResult,
  type CustomerType,
  type CustomerWithVehiclesDto,
  ERROR_CODES,
  type FindOrCreateByContactPayload,
  type FindOrCreateByContactResult,
  type LinkCustomerVehiclePayload,
  type PaginatedCustomers,
  type UpdateCustomerPayload,
} from '@ustowdispatch/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
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

const isUniqueViolation = (err: unknown): err is PgError => {
  if (!err || typeof err !== 'object') return false;
  return (err as PgError).code === PG_UNIQUE_VIOLATION;
};

@Injectable()
export class CustomersService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: CallerContext, filters: CustomerFilters): Promise<PaginatedCustomers> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(customers.deletedAt)];
      if (filters.type) conds.push(eq(customers.type, filters.type));
      if (filters.accountId) conds.push(eq(customers.accountId, filters.accountId));
      if (filters.q) {
        const pattern = `%${filters.q.toLowerCase()}%`;
        conds.push(
          or(
            sql`lower(${customers.name}) LIKE ${pattern}`,
            sql`lower(coalesce(${customers.email}, '')) LIKE ${pattern}`,
            sql`coalesce(${customers.phone}, '') LIKE ${pattern}`,
          ) as ReturnType<typeof eq>,
        );
      }
      const whereExpr = and(...conds);

      const countRow = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(whereExpr);
      const total = countRow[0]?.count ?? 0;

      const rows = await tx.query.customers.findMany({
        where: whereExpr,
        orderBy: (table, { asc }) => [asc(table.name)],
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

  async get(ctx: CallerContext, id: string): Promise<CustomerWithVehiclesDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.customers.findFirst({
        where: and(eq(customers.id, id), isNull(customers.deletedAt)),
      });
      if (!row) throw notFound();

      const linked = await tx
        .select({
          id: vehicles.id,
          year: vehicles.year,
          make: vehicles.make,
          model: vehicles.model,
          vin: vehicles.vin,
          plate: vehicles.plate,
          plateState: vehicles.plateState,
          relationship: customerVehicles.relationship,
          isPrimary: customerVehicles.isPrimary,
        })
        .from(customerVehicles)
        .innerJoin(vehicles, eq(vehicles.id, customerVehicles.vehicleId))
        .where(
          and(
            eq(customerVehicles.customerId, id),
            isNull(customerVehicles.deletedAt),
            isNull(vehicles.deletedAt),
          ),
        );

      return {
        ...toDto(row),
        vehicles: linked.map((v) => ({
          id: v.id,
          year: v.year ?? null,
          make: v.make ?? null,
          model: v.model ?? null,
          vin: v.vin ?? null,
          plate: v.plate ?? null,
          plateState: v.plateState ?? null,
          relationship: v.relationship,
          isPrimary: v.isPrimary,
        })),
      };
    });
  }

  /**
   * Find a customer by phone within the caller's tenant; create one if none
   * exists. Used by Session 4 (Call Intake) when the dispatcher takes a call
   * from someone not yet on file. Newly-created customers are tagged
   * created_via='auto_intake' so the audit log distinguishes them from
   * manually-entered records via after_state.
   *
   * Always returns a customer; never returns null. The `created` flag tells
   * the caller whether a new row was inserted (true) or the existing one
   * was returned (false).
   *
   * Concurrency: two intakes for the same phone can race. The (tenant_id,
   * phone) partial unique index guarantees only one wins; the loser catches
   * the unique-violation and re-reads.
   */
  async findOrCreateByContact(
    ctx: CallerContext,
    input: FindOrCreateByContactPayload,
  ): Promise<FindOrCreateByContactResult> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.customers.findFirst({
        where: and(eq(customers.phone, input.phone), isNull(customers.deletedAt)),
      });
      if (existing) {
        return { customer: toDto(existing), created: false };
      }
      try {
        const id = uuidv7();
        const [row] = await tx
          .insert(customers)
          .values({
            id,
            tenantId: ctx.tenantId,
            type: 'cash',
            name: input.name,
            phone: input.phone,
            email: input.email ?? null,
            billingAddress: input.billingAddress ?? null,
            homeAddressStreet: input.homeAddressStreet ?? null,
            homeAddressCity: input.homeAddressCity ?? null,
            homeAddressState: input.homeAddressState ?? null,
            homeAddressZip: input.homeAddressZip ?? null,
            secondaryContactName: input.secondaryContactName ?? null,
            secondaryContactPhone: input.secondaryContactPhone ?? null,
            conviniAppDownloaded: input.conviniAppDownloaded ?? false,
            createdVia: 'auto_intake',
            createdBy: ctx.userId,
          })
          .returning();
        if (!row) throw new Error('insert customers .. returning() yielded no row');
        return { customer: toDto(row), created: true };
      } catch (err) {
        // Lost the race — the other writer just inserted with the same phone.
        // Re-fetch and treat as "found".
        if (isUniqueViolation(err)) {
          const winner = await tx.query.customers.findFirst({
            where: and(eq(customers.phone, input.phone), isNull(customers.deletedAt)),
          });
          if (winner) return { customer: toDto(winner), created: false };
        }
        throw err;
      }
    });
  }

  async create(ctx: CallerContext, input: CreateCustomerPayload): Promise<CustomerDto> {
    const id = uuidv7();
    try {
      const inserted = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const [row] = await tx
          .insert(customers)
          .values({
            id,
            tenantId: ctx.tenantId,
            type: input.type as CustomerType,
            name: input.name,
            email: input.email ?? null,
            phone: input.phone ?? null,
            billingAddress: input.billingAddress ?? null,
            homeAddressStreet: input.homeAddressStreet ?? null,
            homeAddressCity: input.homeAddressCity ?? null,
            homeAddressState: input.homeAddressState ?? null,
            homeAddressZip: input.homeAddressZip ?? null,
            secondaryContactName: input.secondaryContactName ?? null,
            secondaryContactPhone: input.secondaryContactPhone ?? null,
            conviniAppDownloaded: input.conviniAppDownloaded ?? false,
            accountId: input.accountId ?? null,
            taxExempt: input.taxExempt ?? false,
            taxExemptCertificateUrl: input.taxExemptCertificateUrl ?? null,
            notes: input.notes ?? null,
            createdBy: ctx.userId,
          })
          .returning();
        if (!row) throw new Error('insert customers .. returning() yielded no row');
        return row;
      });
      return toDto(inserted);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'A customer with that phone number already exists',
        });
      }
      throw err;
    }
  }

  async update(ctx: CallerContext, id: string, input: UpdateCustomerPayload): Promise<CustomerDto> {
    try {
      const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const existing = await tx.query.customers.findFirst({
          where: and(eq(customers.id, id), isNull(customers.deletedAt)),
        });
        if (!existing) return null;

        const patch: Partial<typeof customers.$inferInsert> & { updatedAt: Date } = {
          updatedAt: new Date(),
        };
        if (input.type !== undefined) patch.type = input.type;
        if (input.name !== undefined) patch.name = input.name;
        if (input.email !== undefined) patch.email = input.email;
        if (input.phone !== undefined) patch.phone = input.phone;
        if (input.billingAddress !== undefined) patch.billingAddress = input.billingAddress;
        if (input.homeAddressStreet !== undefined)
          patch.homeAddressStreet = input.homeAddressStreet;
        if (input.homeAddressCity !== undefined) patch.homeAddressCity = input.homeAddressCity;
        if (input.homeAddressState !== undefined) patch.homeAddressState = input.homeAddressState;
        if (input.homeAddressZip !== undefined) patch.homeAddressZip = input.homeAddressZip;
        if (input.secondaryContactName !== undefined)
          patch.secondaryContactName = input.secondaryContactName;
        if (input.secondaryContactPhone !== undefined)
          patch.secondaryContactPhone = input.secondaryContactPhone;
        if (input.conviniAppDownloaded !== undefined)
          patch.conviniAppDownloaded = input.conviniAppDownloaded;
        if (input.accountId !== undefined) patch.accountId = input.accountId;
        if (input.taxExempt !== undefined) patch.taxExempt = input.taxExempt;
        if (input.taxExemptCertificateUrl !== undefined)
          patch.taxExemptCertificateUrl = input.taxExemptCertificateUrl;
        if (input.notes !== undefined) patch.notes = input.notes;

        const [row] = await tx.update(customers).set(patch).where(eq(customers.id, id)).returning();
        return row;
      });
      if (!updated) throw notFound();
      return toDto(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'A customer with that phone number already exists',
        });
      }
      throw err;
    }
  }

  async softDelete(ctx: CallerContext, id: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .update(customers)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
        .returning({ id: customers.id });
      return Boolean(row);
    });
    if (!ok) throw notFound();
  }

  async search(ctx: CallerContext, query: CustomerSearchQuery): Promise<CustomerSearchResult[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const pattern = `%${query.q.toLowerCase()}%`;
      const matches = await tx
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          email: customers.email,
          type: customers.type,
        })
        .from(customers)
        .where(
          and(
            isNull(customers.deletedAt),
            or(
              sql`lower(${customers.name}) LIKE ${pattern}`,
              sql`lower(coalesce(${customers.email}, '')) LIKE ${pattern}`,
              sql`coalesce(${customers.phone}, '') LIKE ${pattern}`,
            ),
          ),
        )
        .orderBy(customers.name)
        .limit(query.limit);

      if (matches.length === 0) return [];

      const ids = matches.map((m) => m.id);
      const counts = await tx
        .select({
          customerId: customerVehicles.customerId,
          count: sql<number>`count(*)::int`,
        })
        .from(customerVehicles)
        .where(and(isNull(customerVehicles.deletedAt), inArray(customerVehicles.customerId, ids)))
        .groupBy(customerVehicles.customerId);
      const countMap = new Map(counts.map((c) => [c.customerId, c.count]));

      return matches.map((m) => ({
        id: m.id,
        name: m.name,
        phone: m.phone,
        email: m.email,
        type: m.type,
        vehicleCount: countMap.get(m.id) ?? 0,
      }));
    });
  }

  async linkVehicle(
    ctx: CallerContext,
    customerId: string,
    vehicleId: string,
    input: LinkCustomerVehiclePayload,
  ): Promise<void> {
    try {
      await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
        const [c, v] = await Promise.all([
          tx.query.customers.findFirst({
            where: and(eq(customers.id, customerId), isNull(customers.deletedAt)),
          }),
          tx.query.vehicles.findFirst({
            where: and(eq(vehicles.id, vehicleId), isNull(vehicles.deletedAt)),
          }),
        ]);
        if (!c) throw notFound();
        if (!v) {
          throw new NotFoundException({
            code: ERROR_CODES.NOT_FOUND,
            message: 'Vehicle not found',
          });
        }

        // Resurrect a soft-deleted link if there is one — partial unique
        // index allows this since the index ignores deleted rows.
        const existing = await tx.query.customerVehicles.findFirst({
          where: and(
            eq(customerVehicles.customerId, customerId),
            eq(customerVehicles.vehicleId, vehicleId),
            isNull(customerVehicles.deletedAt),
          ),
        });
        if (existing) return;

        await tx.insert(customerVehicles).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          customerId,
          vehicleId,
          relationship: input.relationship,
          isPrimary: input.isPrimary ?? false,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Race: another writer beat us — treat as idempotent success.
        return;
      }
      throw err;
    }
  }

  async unlinkVehicle(ctx: CallerContext, customerId: string, vehicleId: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .update(customerVehicles)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(customerVehicles.customerId, customerId),
            eq(customerVehicles.vehicleId, vehicleId),
            isNull(customerVehicles.deletedAt),
          ),
        )
        .returning({ id: customerVehicles.id });
      return Boolean(row);
    });
    if (!ok) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Customer–vehicle link not found',
      });
    }
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
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Customer not found' });

function toDto(c: typeof customers.$inferSelect): CustomerDto {
  return {
    id: c.id,
    tenantId: c.tenantId,
    type: c.type,
    name: c.name,
    email: c.email,
    phone: c.phone,
    billingAddress: (c.billingAddress as CustomerDto['billingAddress']) ?? null,
    homeAddressStreet: c.homeAddressStreet,
    homeAddressCity: c.homeAddressCity,
    homeAddressState: c.homeAddressState,
    homeAddressZip: c.homeAddressZip,
    secondaryContactName: c.secondaryContactName,
    secondaryContactPhone: c.secondaryContactPhone,
    conviniAppDownloaded: c.conviniAppDownloaded,
    accountId: c.accountId,
    taxExempt: c.taxExempt,
    taxExemptCertificateUrl: c.taxExemptCertificateUrl,
    notes: c.notes,
    createdVia: c.createdVia,
    defaultRateSheetId: c.defaultRateSheetId,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
    createdBy: c.createdBy,
  };
}
