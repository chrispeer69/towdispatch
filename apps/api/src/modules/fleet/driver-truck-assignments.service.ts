/**
 * DriverTruckAssignmentsService — long-running driver↔truck qualification.
 *
 * Different from driver_shifts (the live session record). An assignment
 * means "this driver is qualified to take this truck out." The fleet UI
 * surfaces assignments on both profile pages.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { driverTruckAssignments, drivers, trucks, uuidv7 } from '@towdispatch/db';
import {
  type CreateDriverTruckAssignmentPayload,
  type DriverTruckAssignmentDto,
  ERROR_CODES,
  type Role,
} from '@towdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { isDriverRole, resolveDriverIdForUser } from './driver-scope.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const PG_UNIQUE_VIOLATION = '23505';
interface PgError {
  code?: string;
}
const isUniqueViolation = (err: unknown): err is PgError =>
  Boolean(err && typeof err === 'object' && (err as PgError).code === PG_UNIQUE_VIOLATION);

@Injectable()
export class DriverTruckAssignmentsService {
  constructor(private readonly db: TenantAwareDb) {}

  async listForDriver(ctx: CallerContext, driverId: string): Promise<DriverTruckAssignmentDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // Drivers may only enumerate their own truck assignments.
      if (isDriverRole(ctx.role)) {
        const selfDriverId = await resolveDriverIdForUser(tx, ctx.userId);
        if (selfDriverId !== driverId) {
          throw new ForbiddenException({
            code: ERROR_CODES.FORBIDDEN,
            message: 'Drivers may only list their own truck assignments',
          });
        }
      }
      const rows = await tx.query.driverTruckAssignments.findMany({
        where: and(
          eq(driverTruckAssignments.driverId, driverId),
          isNull(driverTruckAssignments.deletedAt),
        ),
      });
      return rows.map(toDto);
    });
  }

  async listForTruck(ctx: CallerContext, truckId: string): Promise<DriverTruckAssignmentDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // Drivers should not see "who else drives this truck" — collapse the
      // result to just their own assignment row, if any.
      if (isDriverRole(ctx.role)) {
        const selfDriverId = await resolveDriverIdForUser(tx, ctx.userId);
        const rows = await tx.query.driverTruckAssignments.findMany({
          where: and(
            eq(driverTruckAssignments.truckId, truckId),
            eq(driverTruckAssignments.driverId, selfDriverId),
            isNull(driverTruckAssignments.deletedAt),
          ),
        });
        return rows.map(toDto);
      }
      const rows = await tx.query.driverTruckAssignments.findMany({
        where: and(
          eq(driverTruckAssignments.truckId, truckId),
          isNull(driverTruckAssignments.deletedAt),
        ),
      });
      return rows.map(toDto);
    });
  }

  async create(
    ctx: CallerContext,
    input: CreateDriverTruckAssignmentPayload,
  ): Promise<DriverTruckAssignmentDto> {
    try {
      const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
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
        // Resurrect a soft-deleted live link if one exists for this pair.
        const existing = await tx.query.driverTruckAssignments.findFirst({
          where: and(
            eq(driverTruckAssignments.driverId, input.driverId),
            eq(driverTruckAssignments.truckId, input.truckId),
            isNull(driverTruckAssignments.deletedAt),
          ),
        });
        if (existing) return existing;
        const [r] = await tx
          .insert(driverTruckAssignments)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            driverId: input.driverId,
            truckId: input.truckId,
            isPrimary: input.isPrimary ?? false,
            createdBy: ctx.userId,
          })
          .returning();
        if (!r) throw new Error('insert driver_truck_assignments returned no row');
        return r;
      });
      return toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'Assignment already exists',
        });
      }
      throw err;
    }
  }

  async remove(ctx: CallerContext, id: string): Promise<void> {
    const ok = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [r] = await tx
        .update(driverTruckAssignments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(driverTruckAssignments.id, id), isNull(driverTruckAssignments.deletedAt)))
        .returning({ id: driverTruckAssignments.id });
      return Boolean(r);
    });
    if (!ok) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Assignment not found',
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

function toDto(r: typeof driverTruckAssignments.$inferSelect): DriverTruckAssignmentDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    driverId: r.driverId,
    truckId: r.truckId,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
  };
}
