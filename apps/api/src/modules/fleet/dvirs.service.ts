/**
 * DvirsService — Driver Vehicle Inspection Reports.
 *
 * On submission:
 *   - Computes the rolled-up status from the defects[] severity values
 *     (no_defects | minor | out_of_service).
 *   - When the rolled-up status is out_of_service, calls
 *     TrucksService.markInMaintenance() in the same actor context. The
 *     trucks UPDATE fires the audit trigger so the in_maintenance flip is
 *     traceable; we do NOT use a DB trigger because (a) we want the actor
 *     to match the DVIR submitter, and (b) future workflows may want to
 *     gate the auto-flip on defect class.
 *   - Updates the truck's odometer when odometerReading is supplied and is
 *     ahead of the truck's currentOdometer.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { drivers, dvirs, trucks, uuidv7 } from '@towcommand/db';
import {
  type CreateDvirPayload,
  type DvirDto,
  type DvirFilters,
  type DvirStatus,
  ERROR_CODES,
} from '@towcommand/shared';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TrucksService } from './trucks.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class DvirsService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly trucksSvc: TrucksService,
  ) {}

  /**
   * Computes the rolled-up DVIR status from defects[]. Public-static so the
   * unit test can drive it directly without booting the module.
   */
  static rollupStatus(defects: CreateDvirPayload['defects']): DvirStatus {
    if (!defects || defects.length === 0) return 'no_defects';
    if (defects.some((d) => d.severity === 'out_of_service')) return 'out_of_service';
    return 'minor';
  }

  async list(ctx: CallerContext, filters: DvirFilters): Promise<DvirDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(dvirs.deletedAt)];
      if (filters.driverId) conds.push(eq(dvirs.driverId, filters.driverId));
      if (filters.truckId) conds.push(eq(dvirs.truckId, filters.truckId));
      if (filters.status) conds.push(eq(dvirs.status, filters.status));
      if (filters.fromDate) conds.push(gte(dvirs.submittedAt, new Date(filters.fromDate)));
      if (filters.toDate) conds.push(lte(dvirs.submittedAt, new Date(filters.toDate)));
      const rows = await tx.query.dvirs.findMany({
        where: and(...conds),
        orderBy: (t, { desc }) => [desc(t.submittedAt)],
        limit: 200,
      });
      return rows.map(toDto);
    });
  }

  async submit(ctx: CallerContext, input: CreateDvirPayload): Promise<DvirDto> {
    const status = DvirsService.rollupStatus(input.defects);
    const id = uuidv7();
    const inserted = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [d, t] = await Promise.all([
        tx.query.drivers.findFirst({
          where: and(eq(drivers.id, input.driverId), isNull(drivers.deletedAt)),
        }),
        tx.query.trucks.findFirst({
          where: and(eq(trucks.id, input.truckId), isNull(trucks.deletedAt)),
        }),
      ]);
      if (!d) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Driver not found',
        });
      }
      if (!t) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Truck not found' });
      }
      const [r] = await tx
        .insert(dvirs)
        .values({
          id,
          tenantId: ctx.tenantId,
          driverId: input.driverId,
          truckId: input.truckId,
          type: input.type,
          odometerReading: input.odometerReading ?? null,
          defects: input.defects,
          status,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      if (!r) throw new Error('insert dvirs returned no row');

      // Roll the truck's odometer forward if the reading advances it.
      if (input.odometerReading !== undefined) {
        const reading = input.odometerReading;
        const current = t.currentOdometer ?? -1;
        if (reading > current) {
          await tx
            .update(trucks)
            .set({
              currentOdometer: reading,
              odometerUpdatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(trucks.id, input.truckId));
        }
      }
      return r;
    });

    if (status === 'out_of_service') {
      await this.trucksSvc.markInMaintenance(
        ctx,
        input.truckId,
        `DVIR ${id} reported out_of_service defect(s)`,
      );
    }

    return toDto(inserted);
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

function toDto(d: typeof dvirs.$inferSelect): DvirDto {
  return {
    id: d.id,
    tenantId: d.tenantId,
    driverId: d.driverId,
    truckId: d.truckId,
    type: d.type,
    submittedAt: d.submittedAt.toISOString(),
    odometerReading: d.odometerReading,
    defects: (d.defects as DvirDto['defects']) ?? [],
    status: d.status,
    notes: d.notes,
  };
}
