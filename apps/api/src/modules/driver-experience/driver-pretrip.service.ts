/**
 * DriverPretripService — DVIR submissions from the in-truck app and the
 * "last 10 inspections" read for the driver dashboard.
 *
 * The shared `createDriverPretripInspectionSchema` already validates the
 * item-state enum + photo key shape; this service trusts the parse and
 * persists the row.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { driverPretripInspections, driverShifts, drivers, trucks, uuidv7 } from '@ustowdispatch/db';
import {
  type CreateDriverPretripInspectionPayload,
  type DriverPretripInspectionDto,
  ERROR_CODES,
  type PretripInspectionItem,
  driverPretripInspectionSchema,
} from '@ustowdispatch/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import type { DriverContext } from './driver-auth.service.js';

@Injectable()
export class DriverPretripService {
  constructor(private readonly db: TenantAwareDb) {}

  async create(
    ctx: DriverContext,
    input: CreateDriverPretripInspectionPayload,
  ): Promise<DriverPretripInspectionDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        // Confirm the truck exists in this tenant (RLS would also catch
        // a cross-tenant id but a friendly 404 beats a constraint
        // failure thrown deep in the insert).
        const truck = await tx.query.trucks.findFirst({
          where: and(eq(trucks.id, input.truckId), isNull(trucks.deletedAt)),
        });
        if (!truck) {
          throw new NotFoundException({
            code: ERROR_CODES.NOT_FOUND,
            message: 'Truck not found',
          });
        }

        // If shiftId was provided, verify it belongs to this driver and
        // is still active. Otherwise auto-resolve to the driver's open
        // shift if one exists, falling back to null when none does
        // (a DVIR submitted before clock-on is allowed — it's how
        // "fail_unsafe" can prevent the shift from ever starting).
        let shiftId: string | null = input.shiftId ?? null;
        if (shiftId) {
          const explicit = await tx.query.driverShifts.findFirst({
            where: and(
              eq(driverShifts.id, shiftId),
              eq(driverShifts.driverId, ctx.driverId),
              isNull(driverShifts.deletedAt),
            ),
          });
          if (!explicit) {
            throw new NotFoundException({
              code: ERROR_CODES.NOT_FOUND,
              message: 'Shift not found for this driver',
            });
          }
        } else {
          const open = await tx.query.driverShifts.findFirst({
            where: and(
              eq(driverShifts.driverId, ctx.driverId),
              isNull(driverShifts.endedAt),
              isNull(driverShifts.deletedAt),
            ),
            columns: { id: true },
          });
          shiftId = open?.id ?? null;
        }

        const id = uuidv7();
        const [row] = await tx
          .insert(driverPretripInspections)
          .values({
            id,
            tenantId: ctx.tenantId,
            driverId: ctx.driverId,
            truckId: input.truckId,
            shiftId,
            status: input.status,
            items: input.items as unknown as PretripInspectionItem[],
            odometerMiles: input.odometerMiles ?? null,
            signatureDataUrl: input.signatureDataUrl ?? null,
            notes: input.notes ?? null,
            submittedAt: input.submittedAt ? new Date(input.submittedAt) : new Date(),
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
            createdBy: null,
          })
          .returning();
        if (!row) throw new Error('insert driver_pretrip_inspections .. yielded no row');
        return inspectionRowToDto(row);
      },
    );
  }

  async listMyRecent(ctx: DriverContext): Promise<DriverPretripInspectionDto[]> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        // Confirm the driver row still exists before scanning the table.
        // Removes a deactivated-driver edge case from the list view.
        const driver = await tx.query.drivers.findFirst({
          where: and(eq(drivers.id, ctx.driverId), isNull(drivers.deletedAt)),
          columns: { id: true },
        });
        if (!driver) return [];
        const rows = await tx
          .select()
          .from(driverPretripInspections)
          .where(eq(driverPretripInspections.driverId, ctx.driverId))
          .orderBy(desc(driverPretripInspections.submittedAt))
          .limit(10);
        return rows.map(inspectionRowToDto);
      },
    );
  }
}

function inspectionRowToDto(
  r: typeof driverPretripInspections.$inferSelect,
): DriverPretripInspectionDto {
  const dto = {
    id: r.id,
    tenantId: r.tenantId,
    driverId: r.driverId,
    truckId: r.truckId,
    shiftId: r.shiftId,
    status: r.status,
    items: (r.items as PretripInspectionItem[]) ?? [],
    odometerMiles: r.odometerMiles,
    signatureDataUrl: r.signatureDataUrl,
    notes: r.notes,
    submittedAt: r.submittedAt.toISOString(),
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
  // Last-line guard so the DTO genuinely matches the shared schema —
  // catches accidental type drift between Drizzle and Zod.
  return driverPretripInspectionSchema.parse(dto);
}
