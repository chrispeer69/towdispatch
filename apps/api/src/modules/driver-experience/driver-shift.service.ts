/**
 * DriverShiftService (driver-experience) — driver-app-facing shift
 * operations.
 *
 * Delegates the heavy lifting (startShift / endShift) to the existing
 * dispatch `DriversService`. The role this service plays is:
 *
 *   1. Gate check-in on today's briefing being acknowledged (409 with
 *      BRIEFING_REQUIRED if not). The dispatch DriversService is
 *      operator-facing and intentionally has no such gate.
 *   2. Surface "my active shift" without taking a shift id (the driver
 *      app may have lost local state on a cold start).
 *
 * Note on the briefing gate: when no active briefing exists for the
 * tenant we treat that as "no gate required" so a workshop that hasn't
 * bothered with daily briefings can still run. The gate only kicks in
 * once an admin has published a briefing.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { driverShifts, drivers } from '@ustowdispatch/db';
import { type DriverShiftDto, ERROR_CODES } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { DriversService } from '../dispatch/drivers.service.js';
import type { DriverContext } from './driver-auth.service.js';
import { DriverBriefingService } from './driver-briefing.service.js';

export interface DriverCheckInPayload {
  truckId: string;
  dvirId?: string;
}

@Injectable()
export class DriverShiftService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly drivers: DriversService,
    private readonly briefings: DriverBriefingService,
  ) {}

  async checkIn(ctx: DriverContext, input: DriverCheckInPayload): Promise<DriverShiftDto> {
    // Gate: today's briefing must be acknowledged (when one exists).
    const acked = await this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => this.briefings.hasAckedToday(tx, ctx.tenantId, ctx.driverId),
    );
    if (!acked.ok) {
      throw new ConflictException({
        code: 'BRIEFING_REQUIRED',
        message: "Today's briefing has not been acknowledged",
      });
    }

    // Delegate to the existing dispatch DriversService. Its `role`
    // field is `Role | null`; we pass null because the driver-app
    // caller already proved identity via the driver JWT — the dispatch
    // service's role-based self-check is bypassed (request can only
    // ever carry this driver's id), and the rest of the validation
    // (active driver, truck in service, no overlap) still runs.
    return this.drivers.startShift(
      {
        tenantId: ctx.tenantId,
        userId: ctx.driverId,
        role: null,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      { driverId: ctx.driverId, truckId: input.truckId },
    );
  }

  async checkOut(ctx: DriverContext): Promise<DriverShiftDto> {
    const active = await this.getMyActiveShift(ctx);
    if (!active) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'No active shift to check out of',
      });
    }
    return this.drivers.endShift(
      {
        tenantId: ctx.tenantId,
        userId: ctx.driverId,
        role: null,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      active.id,
    );
  }

  async getMyActiveShift(ctx: DriverContext): Promise<DriverShiftDto | null> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        // Confirm the driver row still exists (and is active) before
        // returning a shift — a deactivated driver should look like
        // "no active shift" to the app, not 404 on the driver row.
        const driver = await tx.query.drivers.findFirst({
          where: and(eq(drivers.id, ctx.driverId), isNull(drivers.deletedAt)),
        });
        if (!driver) return null;
        const shift = await tx.query.driverShifts.findFirst({
          where: and(
            eq(driverShifts.driverId, ctx.driverId),
            isNull(driverShifts.endedAt),
            isNull(driverShifts.deletedAt),
          ),
        });
        return shift ? shiftRowToDto(shift) : null;
      },
    );
  }
}

function shiftRowToDto(s: typeof driverShifts.$inferSelect): DriverShiftDto {
  return {
    id: s.id,
    tenantId: s.tenantId,
    driverId: s.driverId,
    truckId: s.truckId,
    status: s.status,
    currentJobId: s.currentJobId,
    lastLat: s.lastLat ? Number(s.lastLat) : null,
    lastLng: s.lastLng ? Number(s.lastLng) : null,
    lastPositionAt: s.lastPositionAt ? s.lastPositionAt.toISOString() : null,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
  };
}
