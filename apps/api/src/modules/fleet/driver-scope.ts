/**
 * driver-scope — shared helpers for service-layer driver scoping.
 *
 * The /fleet/* surface widened in Session 6.2 to admit role=DRIVER. The
 * controller's role gate is necessary but not sufficient: every service that
 * reads fleet data has to filter to "records owned by *this* driver or its
 * current truck assignment" when the caller's role is DRIVER. Centralising
 * the lookup here keeps the rule in one place and prevents future internal
 * callers (background jobs, gateways) from accidentally bypassing it.
 *
 * Both helpers assume the calling code is already inside a
 * runInTenantContext() transaction so RLS is in effect.
 */
import { ForbiddenException } from '@nestjs/common';
import { driverTruckAssignments, drivers } from '@ustowdispatch/db';
import { ERROR_CODES, ROLES, type Role } from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-aware-db.service.js';

export const isDriverRole = (role: Role | null | undefined): boolean => role === ROLES.DRIVER;

/**
 * Resolve the drivers.id linked to the calling user. Throws 403 when the
 * caller is a driver but no drivers row points at them — without a driver
 * record we have no way to scope reads and refuse to fall back to "see
 * everything."
 */
export async function resolveDriverIdForUser(tx: Tx, userId: string): Promise<string> {
  const row = await tx.query.drivers.findFirst({
    where: and(eq(drivers.userId, userId), isNull(drivers.deletedAt)),
    columns: { id: true },
  });
  if (!row) {
    throw new ForbiddenException({
      code: ERROR_CODES.FORBIDDEN,
      message: 'No driver record is linked to this user',
    });
  }
  return row.id;
}

/** Truck ids currently assigned to the given driver (any live assignment). */
export async function resolveTruckIdsForDriver(tx: Tx, driverId: string): Promise<string[]> {
  const rows = await tx.query.driverTruckAssignments.findMany({
    where: and(
      eq(driverTruckAssignments.driverId, driverId),
      isNull(driverTruckAssignments.deletedAt),
    ),
    columns: { truckId: true },
  });
  return rows.map((r) => r.truckId);
}
