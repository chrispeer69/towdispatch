/**
 * ServiceRatesService — Master Rate Sheet (Admin Settings build 2 of 6).
 *
 * Reads the rate grid grouped by service for the Rate Sheet view, and lets
 * the operator bulk-upsert any number of (service, vehicleClass) → price
 * cells in a single transaction. All writes flow through TenantAwareDb so
 * RLS + the per-row tenant-consistency trigger enforce isolation.
 *
 * The grid shape:
 *   - For each service in the catalog, the response carries the rate rows
 *     keyed by vehicle class. Services with empty applicableVehicleClasses
 *     show one cell (vehicleClass='any'); class-dependent services show
 *     one cell per declared class.
 *   - Missing cells (no row in service_rates yet) are surfaced as priceCents
 *     = null so the UI can render "not set" without inventing a $0 default.
 */
import { Injectable } from '@nestjs/common';
import { type ServiceRateRow, serviceCatalog, serviceRates, uuidv7 } from '@ustowdispatch/db';
import {
  type RateVehicleClass,
  SERVICE_RATE_ANY_CLASS,
  type ServiceRateDto,
  type ServiceRatesBulkUpsertPayload,
  type ServiceRatesBulkUpsertResponse,
} from '@ustowdispatch/shared';
import { and, inArray, isNull, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class ServiceRatesService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(ctx: CallerContext): Promise<ServiceRateDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.select().from(serviceRates);
      return rows.map(toDto);
    });
  }

  async bulkUpsert(
    ctx: CallerContext,
    input: ServiceRatesBulkUpsertPayload,
  ): Promise<ServiceRatesBulkUpsertResponse> {
    if (input.rates.length === 0) {
      return { saved: 0, rates: [] };
    }

    const serviceIds = Array.from(new Set(input.rates.map((r) => r.serviceId)));

    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // Load referenced catalog rows so we can validate (a) all serviceIds
      // belong to the caller's tenant and (b) the vehicleClass each upsert
      // names is actually applicable to that service. RLS would silently
      // hide foreign rows; turning that miss into a clear 400 beats a
      // confusing "service not found".
      const catalogRows = await tx
        .select({
          id: serviceCatalog.id,
          tenantId: serviceCatalog.tenantId,
          applicableVehicleClasses: serviceCatalog.applicableVehicleClasses,
          deletedAt: serviceCatalog.deletedAt,
        })
        .from(serviceCatalog)
        .where(and(inArray(serviceCatalog.id, serviceIds), isNull(serviceCatalog.deletedAt)));

      const byId = new Map(catalogRows.map((r) => [r.id, r]));
      for (const item of input.rates) {
        const row = byId.get(item.serviceId);
        if (!row) {
          throw new Error(
            `service_rates upsert: service ${item.serviceId} not found in this tenant`,
          );
        }
        const applicable = row.applicableVehicleClasses as string[];
        const isClassIndependent = applicable.length === 0;
        if (isClassIndependent) {
          if (item.vehicleClass !== SERVICE_RATE_ANY_CLASS) {
            throw new Error(
              `service_rates upsert: service ${item.serviceId} is class-independent; expected vehicleClass='any', got '${item.vehicleClass}'`,
            );
          }
        } else {
          if (item.vehicleClass === SERVICE_RATE_ANY_CLASS) {
            throw new Error(
              `service_rates upsert: service ${item.serviceId} requires a specific vehicleClass, got 'any'`,
            );
          }
          if (!applicable.includes(item.vehicleClass)) {
            throw new Error(
              `service_rates upsert: vehicleClass '${item.vehicleClass}' is not applicable to service ${item.serviceId}`,
            );
          }
        }
      }

      // Bulk upsert via ON CONFLICT (service_id, vehicle_class). Drizzle's
      // .onConflictDoUpdate clamps to the unique index defined in the
      // 0023 migration.
      const values = input.rates.map((r) => ({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        serviceId: r.serviceId,
        vehicleClass: r.vehicleClass,
        priceCents: r.priceCents,
        updatedBy: ctx.userId,
      }));

      const inserted = await tx
        .insert(serviceRates)
        .values(values)
        .onConflictDoUpdate({
          target: [serviceRates.serviceId, serviceRates.vehicleClass],
          set: {
            priceCents: sql`EXCLUDED.price_cents`,
            updatedAt: sql`now()`,
            updatedBy: sql`EXCLUDED.updated_by`,
          },
        })
        .returning();

      return {
        saved: inserted.length,
        rates: inserted.map(toDto),
      };
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

function toDto(r: ServiceRateRow): ServiceRateDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    serviceId: r.serviceId,
    vehicleClass: r.vehicleClass as RateVehicleClass,
    priceCents: Number(r.priceCents),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  };
}
