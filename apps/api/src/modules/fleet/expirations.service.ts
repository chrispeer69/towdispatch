/**
 * ExpirationsService — single endpoint that aggregates everything
 * "expiring soon" across drivers, trucks, and documents.
 *
 * Severity buckets are derived from days-until-expiry:
 *   expired    : <= 0
 *   critical   :  1..7
 *   warning    :  8..windowDays
 *
 * windowDays defaults to 30 (configurable via filter). Anything past the
 * window is dropped from the response.
 *
 * Rolled up here rather than computed at the SQL layer because the source
 * fields live on three tables with different expiry semantics; consolidating
 * the math in TypeScript trades a bit of memory for a far simpler query
 * and a reusable `bucketize` helper for the test.
 */
import { Injectable } from '@nestjs/common';
import { documents, drivers, trucks } from '@towcommand/db';
import {
  type ExpirationKind,
  type ExpirationRow,
  type ExpirationSeverity,
  type ExpirationsFilters,
  type ExpirationsResponse,
  type Role,
} from '@towcommand/shared';
import { type SQL, and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { isDriverRole, resolveDriverIdForUser, resolveTruckIdsForDriver } from './driver-scope.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class ExpirationsService {
  constructor(private readonly db: TenantAwareDb) {}

  /**
   * Pure helper — turns days-until-expiry into a severity bucket. Public
   * static so the unit test can drive it directly.
   */
  static bucketize(days: number, windowDays: number): ExpirationSeverity | null {
    if (days <= 0) return 'expired';
    if (days <= 7) return 'critical';
    if (days <= windowDays) return 'warning';
    return null;
  }

  static daysBetween(now: Date, expiry: Date): number {
    const ms = expiry.getTime() - now.getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }

  async list(ctx: CallerContext, filters: ExpirationsFilters): Promise<ExpirationsResponse> {
    const now = new Date();
    const windowDays = filters.windowDays;
    const rows: ExpirationRow[] = [];

    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // Drivers see only their own driver-row expirations + the trucks they
      // are currently assigned to + documents owned by either. We scope the
      // queries themselves rather than post-filtering because that keeps the
      // memory footprint small on large tenants.
      let driverScopeIds: string[] | null = null;
      let truckScopeIds: string[] | null = null;
      if (isDriverRole(ctx.role)) {
        const driverId = await resolveDriverIdForUser(tx, ctx.userId);
        const truckIds = await resolveTruckIdsForDriver(tx, driverId);
        driverScopeIds = [driverId];
        truckScopeIds = truckIds;
      }

      const driverRows =
        filters.entityType === 'truck'
          ? []
          : await tx.query.drivers.findMany({
              where: driverScopeIds
                ? and(isNull(drivers.deletedAt), inArray(drivers.id, driverScopeIds))
                : isNull(drivers.deletedAt),
            });
      const truckRows =
        filters.entityType === 'driver'
          ? []
          : truckScopeIds !== null
            ? truckScopeIds.length === 0
              ? []
              : await tx.query.trucks.findMany({
                  where: and(isNull(trucks.deletedAt), inArray(trucks.id, truckScopeIds)),
                })
            : await tx.query.trucks.findMany({ where: isNull(trucks.deletedAt) });
      const docRows = await tx.query.documents.findMany({
        where:
          driverScopeIds || truckScopeIds
            ? and(
                isNull(documents.deletedAt),
                buildDriverDocScopeFilter(driverScopeIds, truckScopeIds),
              )
            : and(isNull(documents.deletedAt)),
      });

      const driverName = (d: typeof drivers.$inferSelect): string =>
        `${d.firstName} ${d.lastName}`.trim();
      const truckLabel = (t: typeof trucks.$inferSelect): string => t.unitNumber;

      for (const d of driverRows) {
        push(
          rows,
          expirationFromDate(
            'driver_cdl',
            `Driver ${driverName(d)} • CDL`,
            d.id,
            'driver',
            d.cdlExpiresAt,
            null,
            now,
            windowDays,
          ),
        );
        push(
          rows,
          expirationFromDate(
            'driver_license',
            `Driver ${driverName(d)} • License`,
            d.id,
            'driver',
            d.licenseExpiresAt,
            null,
            now,
            windowDays,
          ),
        );
        push(
          rows,
          expirationFromDate(
            'driver_medical_card',
            `Driver ${driverName(d)} • Medical Card`,
            d.id,
            'driver',
            d.medicalCardExpiresAt,
            null,
            now,
            windowDays,
          ),
        );
      }
      for (const t of truckRows) {
        push(
          rows,
          expirationFromDate(
            'truck_registration',
            `Truck ${truckLabel(t)} • Registration`,
            t.id,
            'truck',
            t.registrationExpiresAt,
            null,
            now,
            windowDays,
          ),
        );
        push(
          rows,
          expirationFromDate(
            'truck_insurance',
            `Truck ${truckLabel(t)} • Insurance`,
            t.id,
            'truck',
            t.insuranceExpiresAt,
            null,
            now,
            windowDays,
          ),
        );
      }
      for (const d of docRows) {
        if (!d.expiresAt) continue;
        if (filters.entityType && d.ownerType !== filters.entityType) continue;
        if (d.ownerType !== 'driver' && d.ownerType !== 'truck') continue;
        const label = `${capitalize(d.ownerType)} doc • ${d.docType} • ${d.fileName}`;
        push(
          rows,
          expirationFromDate(
            'document',
            label,
            d.ownerId,
            d.ownerType as 'driver' | 'truck',
            d.expiresAt.toISOString().slice(0, 10),
            d.id,
            now,
            windowDays,
          ),
        );
      }
    });

    const filtered = filters.kind ? rows.filter((r) => r.kind === filters.kind) : rows;
    return {
      windowDays,
      expired: filtered.filter((r) => r.severity === 'expired').sort(byExpiryAsc),
      critical: filtered.filter((r) => r.severity === 'critical').sort(byExpiryAsc),
      warning: filtered.filter((r) => r.severity === 'warning').sort(byExpiryAsc),
    };
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

/**
 * Builds the document-scope filter for a driver — match docs whose
 * (ownerType, ownerId) is in {driver:self} ∪ {truck:any assigned truck}.
 * When neither side has any ids, returns a guaranteed-false predicate so
 * the query yields zero rows.
 */
function buildDriverDocScopeFilter(
  driverIds: string[] | null,
  truckIds: string[] | null,
): SQL<unknown> {
  const parts: SQL<unknown>[] = [];
  if (driverIds && driverIds.length > 0) {
    const expr = and(eq(documents.ownerType, 'driver'), inArray(documents.ownerId, driverIds));
    if (expr) parts.push(expr);
  }
  if (truckIds && truckIds.length > 0) {
    const expr = and(eq(documents.ownerType, 'truck'), inArray(documents.ownerId, truckIds));
    if (expr) parts.push(expr);
  }
  if (parts.length === 0) return sql`false`;
  if (parts.length === 1) return parts[0] as SQL<unknown>;
  return or(...parts) as SQL<unknown>;
}

function expirationFromDate(
  kind: ExpirationKind,
  label: string,
  entityId: string,
  entityType: 'driver' | 'truck',
  isoDate: string | null,
  documentId: string | null,
  now: Date,
  windowDays: number,
): ExpirationRow | null {
  if (!isoDate) return null;
  const expiry = new Date(`${isoDate}T00:00:00Z`);
  const days = ExpirationsService.daysBetween(now, expiry);
  const severity = ExpirationsService.bucketize(days, windowDays);
  if (!severity) return null;
  return {
    kind,
    severity,
    daysUntilExpiry: days,
    expiresAt: isoDate,
    label,
    entityId,
    entityType,
    documentId,
  };
}

function push(arr: ExpirationRow[], row: ExpirationRow | null): void {
  if (row) arr.push(row);
}

function byExpiryAsc(a: ExpirationRow, b: ExpirationRow): number {
  return a.daysUntilExpiry - b.daysUntilExpiry;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
