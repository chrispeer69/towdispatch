/**
 * DriversService — read-mostly access to drivers, trucks, and shifts for the
 * dispatch board, plus the small set of mutations dispatch needs:
 *   - start a shift (clock on, optionally with a truck)
 *   - end a shift (clock off)
 *   - update shift status (available / break / etc.)
 *   - update last-known GPS position
 *
 * Driver/truck creation lives in dedicated admin endpoints later; for v1 the
 * seed populates a fleet for the test tenants and the dispatch UI binds
 * against that.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { driverShifts, drivers, jobs, trucks, uuidv7 } from '@ustowdispatch/db';
import {
  DISPATCH_EVENTS,
  type DriverDto,
  type DriverRosterRow,
  type DriverShiftDto,
  ERROR_CODES,
  ROLES,
  type Role,
  type TruckDto,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { DispatchEventsService } from './dispatch-events.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  role: Role | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

async function resolveSelfDriverId(tx: Tx, userId: string): Promise<string> {
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

@Injectable()
export class DriversService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly events: DispatchEventsService,
  ) {}

  async listDrivers(ctx: CallerContext): Promise<DriverDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.drivers.findMany({
        where: isNull(drivers.deletedAt),
        orderBy: (t, { asc }) => [asc(t.lastName), asc(t.firstName)],
      });
      return rows.map(driverRowToDto);
    });
  }

  async listTrucks(ctx: CallerContext): Promise<TruckDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.trucks.findMany({
        where: isNull(trucks.deletedAt),
        orderBy: (t, { asc }) => [asc(t.unitNumber)],
      });
      return rows.map(truckRowToDto);
    });
  }

  /**
   * Roster: every active driver, paired with their open shift (if any),
   * the truck on that shift, and the job number of any in-flight job.
   */
  async roster(ctx: CallerContext): Promise<DriverRosterRow[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const driverRows = await tx.query.drivers.findMany({
        where: and(eq(drivers.active, true), isNull(drivers.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.lastName), asc(t.firstName)],
      });
      const shiftRows = await tx.query.driverShifts.findMany({
        where: and(isNull(driverShifts.endedAt), isNull(driverShifts.deletedAt)),
      });
      const truckRows = await tx.query.trucks.findMany({
        where: isNull(trucks.deletedAt),
      });
      const jobRows = await tx.query.jobs.findMany({
        where: isNull(jobs.deletedAt),
      });

      const truckById = new Map(truckRows.map((t) => [t.id, t]));
      const jobById = new Map(jobRows.map((j) => [j.id, j]));
      const shiftByDriver = new Map(shiftRows.map((s) => [s.driverId, s]));

      return driverRows.map((d) => {
        const shift = shiftByDriver.get(d.id) ?? null;
        const truck = shift?.truckId ? (truckById.get(shift.truckId) ?? null) : null;
        const currentJobNumber = shift?.currentJobId
          ? (jobById.get(shift.currentJobId)?.jobNumber ?? null)
          : null;
        return {
          driver: driverRowToDto(d),
          shift: shift ? shiftRowToDto(shift) : null,
          truck: truck ? truckRowToDto(truck) : null,
          currentJobNumber,
        };
      });
    });
  }

  async startShift(
    ctx: CallerContext,
    input: { driverId: string; truckId?: string },
  ): Promise<DriverShiftDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // Drivers may only clock themselves on.
      if (ctx.role === ROLES.DRIVER) {
        const selfDriverId = await resolveSelfDriverId(tx, ctx.userId);
        if (selfDriverId !== input.driverId) {
          throw new ForbiddenException({
            code: ERROR_CODES.FORBIDDEN,
            message: 'Drivers may only start their own shift',
          });
        }
      }
      const driver = await tx.query.drivers.findFirst({
        where: and(eq(drivers.id, input.driverId), isNull(drivers.deletedAt)),
      });
      if (!driver) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Driver not found',
        });
      }
      if (!driver.active) {
        throw new ConflictException({
          code: ERROR_CODES.DRIVER_OFF_SHIFT,
          message: 'Driver is not active',
        });
      }
      const existing = await tx.query.driverShifts.findFirst({
        where: and(
          eq(driverShifts.driverId, input.driverId),
          isNull(driverShifts.endedAt),
          isNull(driverShifts.deletedAt),
        ),
      });
      if (existing) {
        throw new ConflictException({
          code: ERROR_CODES.DRIVER_ALREADY_ON_SHIFT,
          message: 'Driver already has an active shift',
        });
      }
      if (input.truckId) {
        const truck = await tx.query.trucks.findFirst({
          where: and(eq(trucks.id, input.truckId), isNull(trucks.deletedAt)),
        });
        if (!truck) {
          throw new NotFoundException({
            code: ERROR_CODES.NOT_FOUND,
            message: 'Truck not found',
          });
        }
        if (!truck.inService) {
          throw new ConflictException({
            code: ERROR_CODES.TRUCK_NOT_IN_SERVICE,
            message: 'Truck is out of service',
          });
        }
        const truckBusy = await tx.query.driverShifts.findFirst({
          where: and(
            eq(driverShifts.truckId, input.truckId),
            isNull(driverShifts.endedAt),
            isNull(driverShifts.deletedAt),
          ),
        });
        if (truckBusy) {
          throw new ConflictException({
            code: ERROR_CODES.TRUCK_ALREADY_ASSIGNED,
            message: 'Truck is already on an active shift',
          });
        }
      }

      const id = uuidv7();
      const [row] = await tx
        .insert(driverShifts)
        .values({
          id,
          tenantId: ctx.tenantId,
          driverId: input.driverId,
          truckId: input.truckId ?? null,
          status: 'available',
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('insert driver_shifts .. returning() yielded no row');
      const dto = shiftRowToDto(row);
      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.DRIVER_SHIFT_STARTED, {
        shiftId: dto.id,
        driverId: dto.driverId,
        truckId: dto.truckId,
        startedAt: dto.startedAt,
      });
      return dto;
    });
  }

  async endShift(ctx: CallerContext, shiftId: string): Promise<DriverShiftDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.driverShifts.findFirst({
        where: and(eq(driverShifts.id, shiftId), isNull(driverShifts.deletedAt)),
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Shift not found',
        });
      }
      // Drivers may only clock themselves off — and only their own shift.
      if (ctx.role === ROLES.DRIVER) {
        const selfDriverId = await resolveSelfDriverId(tx, ctx.userId);
        if (selfDriverId !== existing.driverId) {
          throw new ForbiddenException({
            code: ERROR_CODES.FORBIDDEN,
            message: 'Drivers may only end their own shift',
          });
        }
      }
      if (existing.endedAt) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'Shift already ended',
        });
      }
      if (existing.currentJobId) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'Cannot end a shift with an in-flight job. Reassign or complete first.',
        });
      }
      const [row] = await tx
        .update(driverShifts)
        .set({
          endedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(driverShifts.id, shiftId))
        .returning();
      if (!row) throw new Error('update driver_shifts .. returning() yielded no row');
      const dto = shiftRowToDto(row);
      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.DRIVER_SHIFT_ENDED, {
        shiftId: dto.id,
        driverId: dto.driverId,
        endedAt: dto.endedAt as string,
      });
      return dto;
    });
  }

  async updateShiftStatus(
    ctx: CallerContext,
    shiftId: string,
    status: DriverShiftDto['status'],
  ): Promise<DriverShiftDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.driverShifts.findFirst({
        where: and(eq(driverShifts.id, shiftId), isNull(driverShifts.deletedAt)),
      });
      if (!existing || existing.endedAt) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Active shift not found',
        });
      }
      if (ctx.role === ROLES.DRIVER) {
        const selfDriverId = await resolveSelfDriverId(tx, ctx.userId);
        if (selfDriverId !== existing.driverId) {
          throw new ForbiddenException({
            code: ERROR_CODES.FORBIDDEN,
            message: 'Drivers may only update their own shift',
          });
        }
      }
      const [row] = await tx
        .update(driverShifts)
        .set({ status, updatedAt: new Date() })
        .where(eq(driverShifts.id, shiftId))
        .returning();
      if (!row) throw new Error('update driver_shifts .. returning() yielded no row');
      const dto = shiftRowToDto(row);
      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.DRIVER_STATUS_CHANGED, {
        shiftId: dto.id,
        driverId: dto.driverId,
        status: dto.status,
      });
      return dto;
    });
  }

  async updateShiftLocation(
    ctx: CallerContext,
    shiftId: string,
    lat: number,
    lng: number,
  ): Promise<DriverShiftDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.driverShifts.findFirst({
        where: and(eq(driverShifts.id, shiftId), isNull(driverShifts.deletedAt)),
      });
      if (!existing || existing.endedAt) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Active shift not found',
        });
      }
      if (ctx.role === ROLES.DRIVER) {
        const selfDriverId = await resolveSelfDriverId(tx, ctx.userId);
        if (selfDriverId !== existing.driverId) {
          throw new ForbiddenException({
            code: ERROR_CODES.FORBIDDEN,
            message: 'Drivers may only update their own shift',
          });
        }
      }
      const recordedAt = new Date();
      const [row] = await tx
        .update(driverShifts)
        .set({
          lastLat: String(lat),
          lastLng: String(lng),
          lastPositionAt: recordedAt,
          updatedAt: recordedAt,
        })
        .where(eq(driverShifts.id, shiftId))
        .returning();
      if (!row) throw new Error('update driver_shifts .. returning() yielded no row');
      const dto = shiftRowToDto(row);
      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.DRIVER_LOCATION_CHANGED, {
        shiftId: dto.id,
        driverId: dto.driverId,
        lat,
        lng,
        recordedAt: recordedAt.toISOString(),
      });
      return dto;
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

// Session-5↔Session-8 merge: DriverDto/TruckDto are now the Session-8
// superset (fleet.ts). We expand these mappers locally rather than import
// from the fleet module so dispatch keeps its independence.
function driverRowToDto(d: typeof drivers.$inferSelect): DriverDto {
  return {
    id: d.id,
    tenantId: d.tenantId,
    userId: d.userId,
    employeeNumber: d.employeeNumber,
    firstName: d.firstName,
    lastName: d.lastName,
    preferredName: d.preferredName,
    phone: d.phone,
    email: d.email,
    cdlClass: d.cdlClass,
    cdlExpiresAt: d.cdlExpiresAt,
    licenseNumber: d.licenseNumber,
    licenseState: d.licenseState,
    licenseExpiresAt: d.licenseExpiresAt,
    medicalCardExpiresAt: d.medicalCardExpiresAt,
    drugTestLastAt: d.drugTestLastAt,
    roadTestCompletedAt: d.roadTestCompletedAt,
    motorClubCredentials: (d.motorClubCredentials as DriverDto['motorClubCredentials']) ?? null,
    certifications: (d.certifications as DriverDto['certifications']) ?? null,
    hiredAt: d.hiredAt,
    employmentStatus: d.employmentStatus,
    assignedYardId: d.assignedYardId,
    commissionRuleId: d.commissionRuleId,
    notes: d.notes,
    active: d.active,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
  };
}

function truckRowToDto(t: typeof trucks.$inferSelect): TruckDto {
  return {
    id: t.id,
    tenantId: t.tenantId,
    unitNumber: t.unitNumber,
    truckType: t.truckType,
    year: t.year,
    make: t.make,
    model: t.model,
    plate: t.plate,
    plateState: t.plateState,
    vin: t.vin,
    capacityClass: t.capacityClass,
    gvwrLbs: t.gvwrLbs,
    fuelType: t.fuelType,
    equipment: (t.equipment as TruckDto['equipment']) ?? null,
    registrationExpiresAt: t.registrationExpiresAt,
    insuranceExpiresAt: t.insuranceExpiresAt,
    iftaLicense: t.iftaLicense,
    irpAccount: t.irpAccount,
    teslaCertified: t.teslaCertified,
    aaaFlatbed: t.aaaFlatbed,
    heavyDutyCapable: t.heavyDutyCapable,
    currentOdometer: t.currentOdometer,
    odometerUpdatedAt: t.odometerUpdatedAt ? t.odometerUpdatedAt.toISOString() : null,
    status: t.status,
    inService: t.inService,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
  };
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
