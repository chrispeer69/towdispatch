/**
 * DriverTrucksService — driver-JWT-scoped truck lookup.
 *
 * Returns the trucks this driver is qualified to operate. Used by the
 * Session 3 workspace's "Start shift" dialog so the driver can pick the
 * truck they're about to take out for the day.
 *
 * Separate from the operator-facing fleet endpoints because those are
 * RBAC-gated for operator JWTs. We don't want to relax those guards.
 */
import { Injectable } from '@nestjs/common';
import { driverTruckAssignments, trucks } from '@ustowdispatch/db';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import type { DriverContext } from './driver-auth.service.js';

export interface DriverTruckSummary {
  id: string;
  unitNumber: string;
  make: string | null;
  model: string | null;
  status: string;
}

@Injectable()
export class DriverTrucksService {
  constructor(private readonly db: TenantAwareDb) {}

  async listMine(ctx: DriverContext): Promise<DriverTruckSummary[]> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId, requestId: ctx.requestId },
      async (tx) => {
        const rows = await tx
          .select({
            id: trucks.id,
            unitNumber: trucks.unitNumber,
            make: trucks.make,
            model: trucks.model,
            status: trucks.status,
          })
          .from(driverTruckAssignments)
          .innerJoin(trucks, eq(trucks.id, driverTruckAssignments.truckId))
          .where(
            and(
              eq(driverTruckAssignments.driverId, ctx.driverId),
              isNull(driverTruckAssignments.deletedAt),
              isNull(trucks.deletedAt),
            ),
          );
        return rows;
      },
    );
  }
}
