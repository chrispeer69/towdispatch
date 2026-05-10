/**
 * MaintenanceService — schedules + records.
 *
 * Recompute rule: every record insert advances the parent schedule's
 * last_serviced_at / last_serviced_miles (when the record advances them) and
 * recomputes next_due_at / next_due_miles from the schedule's interval.
 *
 * Status:
 *   scheduled when neither next_due_at nor next_due_miles is past
 *   overdue   when either one is past
 *   completed terminal — set explicitly via updateStatus, never auto
 *
 * The recompute also clamps status back to 'scheduled' if the new dates
 * push the schedule into the future.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { maintenanceRecords, maintenanceSchedules, trucks, uuidv7 } from '@towcommand/db';
import {
  type CreateMaintenanceRecordPayload,
  type CreateMaintenanceSchedulePayload,
  ERROR_CODES,
  type MaintenanceRecordDto,
  type MaintenanceScheduleDto,
  type MaintenanceScheduleStatus,
} from '@towcommand/shared';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

interface ComputedNextDue {
  nextDueAt: string | null;
  nextDueMiles: number | null;
  status: MaintenanceScheduleStatus;
}

@Injectable()
export class MaintenanceService {
  constructor(private readonly db: TenantAwareDb) {}

  /**
   * Pure function — given a schedule shape and the latest service event,
   * compute the next due dates/miles and rolled-up status. Public-static
   * so the unit test can drive it directly.
   *
   * `now` is injectable so the unit test isn't time-dependent.
   */
  static computeNextDue(
    schedule: {
      scheduleType: 'mileage' | 'time' | 'both';
      intervalMiles: number | null;
      intervalDays: number | null;
    },
    latestServicedAt: Date | null,
    latestServicedMiles: number | null,
    now: Date = new Date(),
  ): ComputedNextDue {
    let nextDueAt: Date | null = null;
    let nextDueMiles: number | null = null;
    if (
      (schedule.scheduleType === 'time' || schedule.scheduleType === 'both') &&
      schedule.intervalDays &&
      latestServicedAt
    ) {
      nextDueAt = new Date(latestServicedAt);
      nextDueAt.setUTCDate(nextDueAt.getUTCDate() + schedule.intervalDays);
    }
    if (
      (schedule.scheduleType === 'mileage' || schedule.scheduleType === 'both') &&
      schedule.intervalMiles &&
      latestServicedMiles !== null
    ) {
      nextDueMiles = latestServicedMiles + schedule.intervalMiles;
    }

    const overdue =
      (nextDueAt !== null && nextDueAt.getTime() <= now.getTime()) ||
      // Mileage overdue requires a current odometer to check against; the
      // service path that calls this passes truck odometer, but the unit
      // test signature stays simple — caller decides the date overdue here
      // and the mileage overdue is computed where the truck row is in scope.
      false;

    return {
      nextDueAt: nextDueAt ? nextDueAt.toISOString().slice(0, 10) : null,
      nextDueMiles,
      status: overdue ? 'overdue' : 'scheduled',
    };
  }

  async listSchedulesForTruck(
    ctx: CallerContext,
    truckId: string,
  ): Promise<MaintenanceScheduleDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.maintenanceSchedules.findMany({
        where: and(
          eq(maintenanceSchedules.truckId, truckId),
          isNull(maintenanceSchedules.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.serviceType)],
      });
      return rows.map(toScheduleDto);
    });
  }

  async listRecordsForTruck(ctx: CallerContext, truckId: string): Promise<MaintenanceRecordDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.maintenanceRecords.findMany({
        where: and(eq(maintenanceRecords.truckId, truckId), isNull(maintenanceRecords.deletedAt)),
        orderBy: (t, { desc }) => [desc(t.performedAt)],
        limit: 200,
      });
      return rows.map(toRecordDto);
    });
  }

  async listDue(ctx: CallerContext): Promise<MaintenanceScheduleDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await tx.query.maintenanceSchedules.findMany({
        where: and(
          isNull(maintenanceSchedules.deletedAt),
          // 'overdue' or due today
          or(
            eq(maintenanceSchedules.status, 'overdue'),
            // SQL date <= today is the second filter — the first is already
            // computed, this catches schedules that haven't been recomputed yet.
            and(
              eq(maintenanceSchedules.status, 'scheduled'),
              lte(maintenanceSchedules.nextDueAt, today),
            ),
          ),
        ),
        orderBy: (t, { asc }) => [asc(t.nextDueAt)],
      });
      return rows.map(toScheduleDto);
    });
  }

  async createSchedule(
    ctx: CallerContext,
    input: CreateMaintenanceSchedulePayload,
  ): Promise<MaintenanceScheduleDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const t = await tx.query.trucks.findFirst({
        where: and(eq(trucks.id, input.truckId), isNull(trucks.deletedAt)),
      });
      if (!t) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Truck not found' });
      }
      const lastAtDate = input.lastServicedAt ? new Date(input.lastServicedAt) : null;
      const computed = MaintenanceService.computeNextDue(
        {
          scheduleType: input.scheduleType,
          intervalMiles: input.intervalMiles ?? null,
          intervalDays: input.intervalDays ?? null,
        },
        lastAtDate,
        input.lastServicedMiles ?? null,
      );
      const status = this.rollupStatus(
        computed.nextDueAt,
        computed.nextDueMiles,
        t.currentOdometer ?? null,
      );
      const [r] = await tx
        .insert(maintenanceSchedules)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          truckId: input.truckId,
          scheduleType: input.scheduleType,
          serviceType: input.serviceType,
          customLabel: input.customLabel ?? null,
          intervalMiles: input.intervalMiles ?? null,
          intervalDays: input.intervalDays ?? null,
          lastServicedAt: input.lastServicedAt ?? null,
          lastServicedMiles: input.lastServicedMiles ?? null,
          nextDueAt: computed.nextDueAt,
          nextDueMiles: computed.nextDueMiles,
          status,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      if (!r) throw new Error('insert maintenance_schedules returned no row');
      return toScheduleDto(r);
    });
  }

  async recordService(
    ctx: CallerContext,
    input: CreateMaintenanceRecordPayload,
  ): Promise<MaintenanceRecordDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const t = await tx.query.trucks.findFirst({
        where: and(eq(trucks.id, input.truckId), isNull(trucks.deletedAt)),
      });
      if (!t) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Truck not found' });
      }
      const [r] = await tx
        .insert(maintenanceRecords)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          truckId: input.truckId,
          scheduleId: input.scheduleId ?? null,
          performedAt: input.performedAt,
          performedMiles: input.performedMiles ?? null,
          serviceType: input.serviceType,
          customLabel: input.customLabel ?? null,
          costCents: input.costCents,
          vendor: input.vendor ?? null,
          notes: input.notes ?? null,
          documentIds: input.documentIds ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      if (!r) throw new Error('insert maintenance_records returned no row');

      // Roll truck odometer forward when this record advances it.
      if (input.performedMiles !== undefined) {
        const advance = input.performedMiles;
        const current = t.currentOdometer ?? -1;
        if (advance > current) {
          await tx
            .update(trucks)
            .set({
              currentOdometer: advance,
              odometerUpdatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(trucks.id, input.truckId));
        }
      }

      // Recompute the parent schedule's next_due / status.
      if (input.scheduleId) {
        const sched = await tx.query.maintenanceSchedules.findFirst({
          where: and(
            eq(maintenanceSchedules.id, input.scheduleId),
            isNull(maintenanceSchedules.deletedAt),
          ),
        });
        if (sched) {
          const performedAtDate = new Date(input.performedAt);
          const nextLastAt =
            !sched.lastServicedAt || performedAtDate > new Date(sched.lastServicedAt)
              ? performedAtDate
              : new Date(sched.lastServicedAt);
          const nextLastMiles =
            input.performedMiles !== undefined &&
            (sched.lastServicedMiles === null || input.performedMiles > sched.lastServicedMiles)
              ? input.performedMiles
              : sched.lastServicedMiles;
          const computed = MaintenanceService.computeNextDue(
            {
              scheduleType: sched.scheduleType,
              intervalMiles: sched.intervalMiles,
              intervalDays: sched.intervalDays,
            },
            nextLastAt,
            nextLastMiles,
          );
          const updatedTruckOdometer =
            input.performedMiles !== undefined && input.performedMiles > (t.currentOdometer ?? -1)
              ? input.performedMiles
              : t.currentOdometer;
          const status = this.rollupStatus(
            computed.nextDueAt,
            computed.nextDueMiles,
            updatedTruckOdometer ?? null,
          );
          await tx
            .update(maintenanceSchedules)
            .set({
              lastServicedAt: nextLastAt.toISOString().slice(0, 10),
              lastServicedMiles: nextLastMiles,
              nextDueAt: computed.nextDueAt,
              nextDueMiles: computed.nextDueMiles,
              status,
              updatedAt: new Date(),
            })
            .where(eq(maintenanceSchedules.id, input.scheduleId));
        }
      }
      return toRecordDto(r);
    });
  }

  /**
   * Rolled-up schedule status that takes truck odometer into account for
   * mileage-based schedules. 'overdue' if either next_due_at is past today
   * OR truck.currentOdometer >= nextDueMiles.
   */
  private rollupStatus(
    nextDueAt: string | null,
    nextDueMiles: number | null,
    currentOdometer: number | null,
  ): MaintenanceScheduleStatus {
    const today = new Date().toISOString().slice(0, 10);
    const overdueByDate = nextDueAt !== null && nextDueAt <= today;
    const overdueByMiles =
      nextDueMiles !== null && currentOdometer !== null && currentOdometer >= nextDueMiles;
    return overdueByDate || overdueByMiles ? 'overdue' : 'scheduled';
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

function toScheduleDto(s: typeof maintenanceSchedules.$inferSelect): MaintenanceScheduleDto {
  return {
    id: s.id,
    tenantId: s.tenantId,
    truckId: s.truckId,
    scheduleType: s.scheduleType,
    serviceType: s.serviceType,
    customLabel: s.customLabel,
    intervalMiles: s.intervalMiles,
    intervalDays: s.intervalDays,
    lastServicedAt: s.lastServicedAt,
    lastServicedMiles: s.lastServicedMiles,
    nextDueAt: s.nextDueAt,
    nextDueMiles: s.nextDueMiles,
    status: s.status,
    notes: s.notes,
  };
}

function toRecordDto(r: typeof maintenanceRecords.$inferSelect): MaintenanceRecordDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    truckId: r.truckId,
    scheduleId: r.scheduleId,
    performedAt: r.performedAt,
    performedMiles: r.performedMiles,
    serviceType: r.serviceType,
    customLabel: r.customLabel,
    costCents: r.costCents,
    vendor: r.vendor,
    notes: r.notes,
    documentIds: (r.documentIds as MaintenanceRecordDto['documentIds']) ?? null,
  };
}
