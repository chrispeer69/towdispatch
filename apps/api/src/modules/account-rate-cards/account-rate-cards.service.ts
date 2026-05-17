/**
 * AccountRateCardsService — Admin Settings build 6 of 7.
 *
 * Surfaces three closely-related editing surfaces against a single
 * account_id:
 *   - GET  /accounts/:id/rate-card        — full grid (master rates +
 *                                            overrides + availability)
 *   - PATCH/accounts/:id/rate-card/bulk   — upsert overrides and/or
 *                                            availability rows in one txn
 *   - DELETE single override or availability row
 *   - PATCH /accounts/:id/contract-terms  — the 6 contract-term columns
 *
 * The bulk upsert intentionally accepts both arrays nullable; UI surfaces
 * (Rate Card tab vs Service Availability tab) only send the section they
 * are saving. Tenant + cross-account-FK isolation comes from the DB's
 * row-level security + the BEFORE-INSERT trigger
 * fn_account_rate_overrides_tenant_consistency (see migration 0028).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AccountRateOverrideRow,
  type AccountServiceAvailabilityRow,
  type ServiceCatalogRow,
  type ServiceRateRow,
  accountRateOverrides,
  accountServiceAvailability,
  accounts,
  serviceCatalog,
  serviceRates,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type AccountRateCardDto,
  type AccountRateOverrideDto,
  type AccountServiceAvailabilityDto,
  type BulkUpdateAccountRateCardPayload,
  ERROR_CODES,
  type MasterRateRowDto,
  SERVICE_RATE_ANY_CLASS,
  type UpdateAccountContractTermsPayload,
  resolveAccountOverridePriceCents,
} from '@ustowdispatch/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AccountRateCardsService {
  constructor(private readonly db: TenantAwareDb) {}

  async getRateCard(ctx: CallerContext, accountId: string): Promise<AccountRateCardDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const account = await tx.query.accounts.findFirst({
        where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
      });
      if (!account) throw accountNotFound();

      const catalog = await tx.query.serviceCatalog.findMany({
        where: isNull(serviceCatalog.deletedAt),
      });
      const catalogById = new Map(catalog.map((c) => [c.id, c]));

      const rates = await tx.select().from(serviceRates);
      const overrides = await tx
        .select()
        .from(accountRateOverrides)
        .where(eq(accountRateOverrides.accountId, accountId));
      const availability = await tx
        .select()
        .from(accountServiceAvailability)
        .where(eq(accountServiceAvailability.accountId, accountId));

      const masterRates: MasterRateRowDto[] = buildMasterRateRows(catalog, rates);

      // Index master prices by (catalogId, vehicleClass) so each override
      // can compute its effectivePriceCents in one O(1) lookup.
      const masterIdx = indexMasterByServiceAndClass(rates);

      return {
        account: {
          id: account.id,
          name: account.name,
          isMotorClub: account.isMotorClub,
          active: account.active,
          motorClubNetworkCode: account.motorClubNetworkCode,
          accountNumber: account.accountNumber,
        },
        masterRates,
        overrides: overrides.map((r) => overrideToDto(r, catalogById, masterIdx)),
        availability: availability.map((r) => availabilityToDto(r, catalogById)),
      };
    });
  }

  async bulkUpsert(
    ctx: CallerContext,
    accountId: string,
    input: BulkUpdateAccountRateCardPayload,
  ): Promise<AccountRateCardDto> {
    const hasOverrides = (input.overrides?.length ?? 0) > 0;
    const hasAvailability = (input.availability?.length ?? 0) > 0;
    if (!hasOverrides && !hasAvailability) {
      // Nothing to do; just return the current state. Beats a "what now?"
      // 400 — the UI's Save button is gated on dirtyCount > 0 anyway.
      return this.getRateCard(ctx, accountId);
    }

    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const account = await tx.query.accounts.findFirst({
        where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
      });
      if (!account) throw accountNotFound();

      // Validate every referenced service_catalog id belongs to this
      // tenant and is not soft-deleted. RLS would already block foreign
      // tenants; we surface this explicitly for a clean 400 instead of a
      // confusing trigger error.
      const allServiceIds = Array.from(
        new Set([
          ...(input.overrides ?? []).map((o) => o.serviceCatalogId),
          ...(input.availability ?? []).map((a) => a.serviceCatalogId),
        ]),
      );
      if (allServiceIds.length > 0) {
        const found = await tx.query.serviceCatalog.findMany({
          where: isNull(serviceCatalog.deletedAt),
          columns: { id: true },
        });
        const foundSet = new Set(found.map((r) => r.id));
        for (const id of allServiceIds) {
          if (!foundSet.has(id)) {
            throw new BadRequestException({
              code: ERROR_CODES.VALIDATION_FAILED,
              message: `service_catalog_id ${id} not found in this tenant`,
            });
          }
        }
      }

      if (hasOverrides) {
        await this.upsertOverrides(tx, ctx, accountId, input.overrides ?? []);
      }
      if (hasAvailability) {
        await this.upsertAvailability(tx, ctx, accountId, input.availability ?? []);
      }
    });

    return this.getRateCard(ctx, accountId);
  }

  private async upsertOverrides(
    tx: Tx,
    ctx: CallerContext,
    accountId: string,
    overrides: NonNullable<BulkUpdateAccountRateCardPayload['overrides']>,
  ): Promise<void> {
    // Manual upsert because Postgres treats NULL as distinct in standard
    // unique indexes — our two partial unique indexes (one for NULL class,
    // one for non-NULL) cannot serve a single ON CONFLICT target. So we
    // delete-then-insert per row inside the same transaction. Volume is
    // bounded by the catalog size (well under 100 rows in practice).
    for (const item of overrides) {
      const isPercent = item.overrideType === 'percent_discount';
      const valueCents = isPercent ? 0 : (item.overrideValueCents ?? 0);
      const percent = isPercent ? (item.overridePercent ?? null) : null;

      const baseConds = [
        eq(accountRateOverrides.accountId, accountId),
        eq(accountRateOverrides.serviceCatalogId, item.serviceCatalogId),
      ];
      const classCond =
        item.vehicleClass == null
          ? isNull(accountRateOverrides.vehicleClass)
          : eq(accountRateOverrides.vehicleClass, item.vehicleClass);
      await tx.delete(accountRateOverrides).where(and(...baseConds, classCond));

      await tx.insert(accountRateOverrides).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        accountId,
        serviceCatalogId: item.serviceCatalogId,
        vehicleClass: item.vehicleClass,
        overrideType: item.overrideType,
        overrideValueCents: valueCents,
        overridePercent: percent,
        isActive: item.isActive ?? true,
        notes: item.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    }
  }

  private async upsertAvailability(
    tx: Tx,
    ctx: CallerContext,
    accountId: string,
    rows: NonNullable<BulkUpdateAccountRateCardPayload['availability']>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const values = rows.map((r) => ({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      accountId,
      serviceCatalogId: r.serviceCatalogId,
      availability: r.availability,
      notes: r.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    }));
    await tx
      .insert(accountServiceAvailability)
      .values(values)
      .onConflictDoUpdate({
        target: [
          accountServiceAvailability.tenantId,
          accountServiceAvailability.accountId,
          accountServiceAvailability.serviceCatalogId,
        ],
        set: {
          availability: sql`EXCLUDED.availability`,
          notes: sql`EXCLUDED.notes`,
          updatedAt: sql`now()`,
          updatedBy: sql`EXCLUDED.updated_by`,
        },
      });
  }

  async deleteOverride(ctx: CallerContext, accountId: string, overrideId: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const result = await tx
        .delete(accountRateOverrides)
        .where(
          and(
            eq(accountRateOverrides.id, overrideId),
            eq(accountRateOverrides.accountId, accountId),
          ),
        )
        .returning({ id: accountRateOverrides.id });
      return result.length > 0;
    });
    if (!ok) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Account rate override not found',
      });
    }
  }

  async deleteAvailability(
    ctx: CallerContext,
    accountId: string,
    availabilityId: string,
  ): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const result = await tx
        .delete(accountServiceAvailability)
        .where(
          and(
            eq(accountServiceAvailability.id, availabilityId),
            eq(accountServiceAvailability.accountId, accountId),
          ),
        )
        .returning({ id: accountServiceAvailability.id });
      return result.length > 0;
    });
    if (!ok) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Account service availability not found',
      });
    }
  }

  async updateContractTerms(
    ctx: CallerContext,
    accountId: string,
    input: UpdateAccountContractTermsPayload,
  ): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const patch: Partial<typeof accounts.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.paymentTerms !== undefined) patch.paymentTerms = input.paymentTerms;
      if (input.requiresPhotoBeforeBilling !== undefined)
        patch.requiresPhotoBeforeBilling = input.requiresPhotoBeforeBilling;
      if (input.requiresAuthorizationCode !== undefined)
        patch.requiresAuthorizationCode = input.requiresAuthorizationCode;
      if (input.goaPolicy !== undefined) patch.goaPolicy = input.goaPolicy;
      if (input.slaArrivalMinutes !== undefined) patch.slaArrivalMinutes = input.slaArrivalMinutes;
      if (input.afterHoursBillingAllowed !== undefined)
        patch.afterHoursBillingAllowed = input.afterHoursBillingAllowed;

      const result = await tx
        .update(accounts)
        .set(patch)
        .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
        .returning({ id: accounts.id });
      return result.length > 0;
    });
    if (!ok) throw accountNotFound();
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

const accountNotFound = (): NotFoundException =>
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Account not found' });

function indexMasterByServiceAndClass(rates: ServiceRateRow[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const r of rates) {
    let inner = m.get(r.serviceId);
    if (!inner) {
      inner = new Map<string, number>();
      m.set(r.serviceId, inner);
    }
    inner.set(r.vehicleClass, Number(r.priceCents));
  }
  return m;
}

function masterPriceFor(
  serviceId: string,
  vehicleClass: string | null,
  index: Map<string, Map<string, number>>,
): number | null {
  const inner = index.get(serviceId);
  if (!inner) return null;
  const key = vehicleClass ?? SERVICE_RATE_ANY_CLASS;
  if (inner.has(key)) return inner.get(key) ?? null;
  // Fall back to 'any' if specific class missing; mirrors the rate
  // engine's class-independent lookup.
  return inner.get(SERVICE_RATE_ANY_CLASS) ?? null;
}

function buildMasterRateRows(
  catalog: ServiceCatalogRow[],
  rates: ServiceRateRow[],
): MasterRateRowDto[] {
  const rateIdx = indexMasterByServiceAndClass(rates);
  const out: MasterRateRowDto[] = [];
  for (const svc of catalog) {
    if (svc.deletedAt) continue;
    const applicable = (svc.applicableVehicleClasses as string[]) ?? [];
    const classes = applicable.length === 0 ? [SERVICE_RATE_ANY_CLASS] : applicable;
    for (const vc of classes) {
      const inner = rateIdx.get(svc.id);
      const price = inner?.get(vc);
      out.push({
        serviceCatalogId: svc.id,
        serviceCode: svc.code,
        serviceName: svc.name,
        category: svc.category,
        calculationUnit: svc.calculationUnit,
        applicableVehicleClasses: applicable,
        sortOrder: svc.sortOrder,
        vehicleClass: vc,
        priceCents: price ?? null,
      });
    }
  }
  return out;
}

function overrideToDto(
  r: AccountRateOverrideRow,
  catalog: Map<string, ServiceCatalogRow>,
  masterIdx: Map<string, Map<string, number>>,
): AccountRateOverrideDto {
  const svc = catalog.get(r.serviceCatalogId);
  const masterPrice = masterPriceFor(r.serviceCatalogId, r.vehicleClass, masterIdx);
  const effective = resolveAccountOverridePriceCents(
    r.overrideType,
    r.overrideValueCents,
    r.overridePercent,
    masterPrice,
  );
  return {
    id: r.id,
    accountId: r.accountId,
    serviceCatalogId: r.serviceCatalogId,
    serviceCode: svc?.code ?? 'UNKNOWN',
    serviceName: svc?.name ?? '(unknown service)',
    category: svc?.category ?? '',
    vehicleClass: r.vehicleClass,
    overrideType: r.overrideType,
    overrideValueCents: r.overrideValueCents,
    overridePercent: r.overridePercent,
    isActive: r.isActive,
    notes: r.notes,
    effectivePriceCents: effective,
    priceDisplay: formatPriceDisplay(effective, r.overrideType, r.overridePercent),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function availabilityToDto(
  r: AccountServiceAvailabilityRow,
  catalog: Map<string, ServiceCatalogRow>,
): AccountServiceAvailabilityDto {
  const svc = catalog.get(r.serviceCatalogId);
  return {
    id: r.id,
    accountId: r.accountId,
    serviceCatalogId: r.serviceCatalogId,
    serviceCode: svc?.code ?? 'UNKNOWN',
    serviceName: svc?.name ?? '(unknown service)',
    category: svc?.category ?? '',
    availability: r.availability,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function formatPriceDisplay(
  effectiveCents: number | null,
  overrideType: AccountRateOverrideRow['overrideType'],
  overridePercent: string | null,
): string {
  if (effectiveCents == null) {
    // No master rate to apply the discount to. Surface the operator's
    // intent so the UI can still show "10% off (master unset)".
    if (overrideType === 'percent_discount') {
      return `${overridePercent ?? '0'}% off`;
    }
    return '—';
  }
  return `$${(effectiveCents / 100).toFixed(2)}`;
}
