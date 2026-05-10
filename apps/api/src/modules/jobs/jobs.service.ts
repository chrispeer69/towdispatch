/**
 * JobsService — call intake creates jobs from a phone number, a vehicle
 * identifier, and a service request. The pieces are stitched together in a
 * single transaction:
 *
 *   1. findOrCreateByContact resolves (or creates) the customer.
 *   2. findOrCreateVehicle resolves (or creates) the vehicle by VIN, then
 *      by (plate, plateState) within the tenant, then creates a new row.
 *   3. RateEngineService.quote() generates a RateQuote.
 *   4. allocateJobNumber bumps the per-tenant per-day sequence and returns
 *      'YYYYMMDD-NNNN'.
 *   5. INSERT INTO jobs.
 *
 * Everything runs under runInTenantContext so RLS still enforces isolation.
 * The audit trigger captures the INSERT — no manual audit emission.
 *
 * The RateEngineService starts its own transaction for the quote step
 * because the engine doubles as the public quote-preview endpoint and we
 * want it to work standalone. That means the quote sees the same
 * tenant/user GUCs as everything else — the GUCs are global to the
 * connection, not the transaction handle. Fine for our purposes.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  customerVehicles,
  customers,
  driverShifts,
  drivers,
  jobStatusTransitions,
  jobs,
  trucks,
  uuidv7,
  vehicles,
} from '@towcommand/db';
import {
  type CreateJobIntakePayload,
  DISPATCH_EVENTS,
  ERROR_CODES,
  type IntakeResultDto,
  type JobDto,
  type JobStatus,
  type QuotePreviewPayload,
  type RateQuote,
} from '@towcommand/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { DispatchEventsService } from '../dispatch/dispatch-events.service.js';
import { RateEngineService } from '../rates/rate-engine.service.js';
import {
  InvalidJobTransitionError,
  TERMINAL_STATUSES,
  assertCanTransition,
} from './job-state-machine.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class JobsService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly customers: CustomersService,
    private readonly rateEngine: RateEngineService,
    private readonly events: DispatchEventsService,
  ) {}

  async quotePreview(ctx: CallerContext, input: QuotePreviewPayload): Promise<RateQuote> {
    return this.rateEngine.quote({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      serviceType: input.serviceType,
      vehicleClass: input.vehicleClass,
      pickupLat: input.pickup?.lat ?? null,
      pickupLng: input.pickup?.lng ?? null,
      dropoffLat: input.dropoff?.lat ?? null,
      dropoffLng: input.dropoff?.lng ?? null,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
      accountId: input.accountId ?? null,
    });
  }

  async createIntake(ctx: CallerContext, input: CreateJobIntakePayload): Promise<IntakeResultDto> {
    // findOrCreateByContact — runs its own transaction and returns the
    // resolved customer. We re-fetch the customer inside the job-creation
    // transaction so RLS sees it from the same connection. Email is required
    // by the createJobIntakeSchema, so it's always present here.
    const home = input.customer.homeAddress ?? {};
    const customerResult = await this.customers.findOrCreateByContact(ctx, {
      name: input.customer.name,
      phone: input.customer.phone,
      email: input.customer.email,
      ...(home.street ? { homeAddressStreet: home.street } : {}),
      ...(home.city ? { homeAddressCity: home.city } : {}),
      ...(home.state ? { homeAddressState: home.state } : {}),
      ...(home.zip ? { homeAddressZip: home.zip } : {}),
      ...(input.customer.secondaryContactName
        ? { secondaryContactName: input.customer.secondaryContactName }
        : {}),
      ...(input.customer.secondaryContactPhone
        ? { secondaryContactPhone: input.customer.secondaryContactPhone }
        : {}),
      ...(input.customer.conviniAppDownloaded !== undefined
        ? { conviniAppDownloaded: input.customer.conviniAppDownloaded }
        : {}),
    });

    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // Resolve the persisted customer row inside this transaction.
      const customerRow = await tx.query.customers.findFirst({
        where: and(eq(customers.id, customerResult.customer.id), isNull(customers.deletedAt)),
      });
      if (!customerRow) {
        // Should be impossible — customer was just created/looked up — but
        // surface a meaningful error if RLS or a race got in the way.
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Customer disappeared between resolve and intake',
        });
      }

      // Resolve / create vehicle.
      const vehicleResolution = await findOrCreateVehicle(tx, ctx.tenantId, ctx.userId, input);

      // Make sure the customer is linked to the vehicle for future autocomplete.
      // Idempotent: skip if already linked.
      const existingLink = await tx.query.customerVehicles.findFirst({
        where: and(
          eq(customerVehicles.customerId, customerRow.id),
          eq(customerVehicles.vehicleId, vehicleResolution.id),
          isNull(customerVehicles.deletedAt),
        ),
      });
      if (!existingLink) {
        await tx.insert(customerVehicles).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          customerId: customerRow.id,
          vehicleId: vehicleResolution.id,
          relationship: 'owner',
          isPrimary: false,
        });
      }

      // Generate the rate quote. The engine opens its own tenant context but
      // the GUCs are connection-wide, so it sees the same tenant we just set.
      const quote = await this.rateEngine.quote({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        serviceType: input.serviceType,
        vehicleClass: input.vehicle.vehicleClass,
        pickupLat: input.pickup.lat ?? null,
        pickupLng: input.pickup.lng ?? null,
        dropoffLat: input.dropoff?.lat ?? null,
        dropoffLng: input.dropoff?.lng ?? null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        accountId: input.accountId ?? null,
      });

      // Allocate job number under the active transaction.
      const jobNumber = await allocateJobNumber(tx, ctx.tenantId, new Date());

      // Insert the job.
      const id = uuidv7();
      const [row] = await tx
        .insert(jobs)
        .values({
          id,
          tenantId: ctx.tenantId,
          jobNumber,
          status: 'new',
          serviceType: input.serviceType,
          customerId: customerRow.id,
          vehicleId: vehicleResolution.id,
          accountId: input.accountId ?? null,
          pickupAddress: input.pickup.address,
          pickupLat: numToText(input.pickup.lat),
          pickupLng: numToText(input.pickup.lng),
          dropoffAddress: input.dropoff?.address ?? null,
          dropoffLat: numToText(input.dropoff?.lat),
          dropoffLng: numToText(input.dropoff?.lng),
          authorizedBy: input.authorizedBy,
          authorizedByName: input.authorizedByName ?? null,
          rateQuotedCents: quote.totalCents,
          rateBreakdown: quote,
          notes: input.notes ?? null,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('insert jobs .. returning() yielded no row');

      const jobDto = rowToDto(row);

      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.JOB_CREATED, { job: jobDto });

      return {
        job: jobDto,
        customer: {
          id: customerRow.id,
          name: customerRow.name,
          phone: customerRow.phone,
          email: customerRow.email,
          created: customerResult.created,
        },
        vehicle: {
          id: vehicleResolution.id,
          year: vehicleResolution.year,
          make: vehicleResolution.make,
          model: vehicleResolution.model,
          plate: vehicleResolution.plate,
          plateState: vehicleResolution.plateState,
          vin: vehicleResolution.vin,
          created: vehicleResolution.created,
        },
        rateQuote: quote,
      };
    });
  }

  async get(ctx: CallerContext, id: string): Promise<JobDto> {
    const row = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      return tx.query.jobs.findFirst({
        where: and(eq(jobs.id, id), isNull(jobs.deletedAt)),
      });
    });
    if (!row) throw notFound();
    return rowToDto(row);
  }

  async cancel(ctx: CallerContext, id: string, reason: string): Promise<JobDto> {
    return this.transition(ctx, id, 'cancelled', reason);
  }

  /**
   * Live dispatch board feed: the four buckets the UI reads on initial load.
   * Returns recently-created (`new`), in-flight, recently-completed today,
   * and the driver roster (each driver + active shift + truck + current job).
   */
  async dispatchBoard(ctx: CallerContext): Promise<{
    queue: JobDto[];
    active: JobDto[];
    recentlyCompleted: JobDto[];
  }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const queueRows = await tx.query.jobs.findMany({
        where: and(eq(jobs.status, 'new'), isNull(jobs.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
        limit: 200,
      });

      const activeRows = await tx.query.jobs.findMany({
        where: and(
          inArray(jobs.status, ['dispatched', 'enroute', 'on_scene', 'in_progress']),
          isNull(jobs.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.assignedAt), asc(t.createdAt)],
        limit: 200,
      });

      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const recentlyCompletedRows = await tx.query.jobs.findMany({
        where: and(
          inArray(jobs.status, ['completed', 'cancelled', 'goa']),
          isNull(jobs.deletedAt),
          sql`${jobs.updatedAt} >= ${startOfDay.toISOString()}`,
        ),
        orderBy: (t, { desc: descCol }) => [descCol(t.updatedAt)],
        limit: 10,
      });

      return {
        queue: queueRows.map(rowToDto),
        active: activeRows.map(rowToDto),
        recentlyCompleted: recentlyCompletedRows.map(rowToDto),
      };
    });
  }

  async assign(
    ctx: CallerContext,
    jobId: string,
    input: { driverId: string; truckId?: string; shiftId?: string },
  ): Promise<JobDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      });
      if (!job) throw notFound();
      if (TERMINAL_STATUSES.has(job.status)) {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: `Cannot assign a ${job.status} job`,
        });
      }
      // Allow reassign while job is still pre-enroute. Once a driver is on
      // the way / on scene / in progress, assignment is a different thing
      // we'd want explicit dispatcher friction for — block at service layer.
      if (job.status !== 'new' && job.status !== 'dispatched') {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: `Cannot reassign a job in '${job.status}' state. Unassign first.`,
        });
      }

      // Validate driver — must exist, be active, and have an open shift.
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

      // Resolve current shift if not supplied.
      let shiftId = input.shiftId ?? null;
      if (!shiftId) {
        const openShift = await tx.query.driverShifts.findFirst({
          where: and(
            eq(driverShifts.driverId, input.driverId),
            isNull(driverShifts.endedAt),
            isNull(driverShifts.deletedAt),
          ),
        });
        if (!openShift) {
          throw new ConflictException({
            code: ERROR_CODES.DRIVER_OFF_SHIFT,
            message: 'Driver has no active shift',
          });
        }
        shiftId = openShift.id;
      }

      const truckId = input.truckId ?? null;
      if (truckId) {
        const truck = await tx.query.trucks.findFirst({
          where: and(eq(trucks.id, truckId), isNull(trucks.deletedAt)),
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
      }

      const fromStatus: JobStatus = job.status;
      const toStatus: JobStatus = 'dispatched';
      // Walk the state machine. dispatched -> dispatched is a re-assign and
      // must be expressed as unassign + assign — the service-layer guard
      // above catches that case.
      if (fromStatus !== 'dispatched') {
        try {
          assertCanTransition(fromStatus, toStatus);
        } catch (err) {
          if (err instanceof InvalidJobTransitionError) {
            throw new BadRequestException({
              code: ERROR_CODES.INVALID_STATE_TRANSITION,
              message: err.message,
            });
          }
          throw err;
        }
      }

      const previousDriverId = job.assignedDriverId;

      const [updated] = await tx
        .update(jobs)
        .set({
          status: 'dispatched',
          assignedDriverId: input.driverId,
          assignedTruckId: truckId,
          assignedShiftId: shiftId,
          assignedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId))
        .returning();
      if (!updated) throw notFound();

      // Update the prior shift to clear current_job_id, and update the new
      // shift to reflect this job + on-the-way status.
      if (previousDriverId && previousDriverId !== input.driverId) {
        await tx
          .update(driverShifts)
          .set({ currentJobId: null, updatedAt: new Date() })
          .where(
            and(
              eq(driverShifts.driverId, previousDriverId),
              isNull(driverShifts.endedAt),
              isNull(driverShifts.deletedAt),
            ),
          );
      }
      if (shiftId) {
        await tx
          .update(driverShifts)
          .set({
            currentJobId: jobId,
            status: 'en_route',
            updatedAt: new Date(),
          })
          .where(eq(driverShifts.id, shiftId));
      }

      // Append a transition row and let the audit_log trigger capture the
      // jobs UPDATE.
      if (fromStatus !== toStatus) {
        await tx.insert(jobStatusTransitions).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          jobId,
          fromStatus,
          toStatus,
          actorUserId: ctx.userId,
          metadata: {
            driverId: input.driverId,
            truckId,
            shiftId,
            previousDriverId,
          },
        });
      }

      const dto = rowToDto(updated);
      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.JOB_ASSIGNED, {
        jobId: dto.id,
        jobNumber: dto.jobNumber,
        status: dto.status,
        driverId: input.driverId,
        truckId,
        shiftId,
        assignedByUserId: ctx.userId,
        previousDriverId,
      });
      if (fromStatus !== toStatus) {
        this.events.emit(ctx.tenantId, DISPATCH_EVENTS.JOB_STATUS_CHANGED, {
          jobId: dto.id,
          jobNumber: dto.jobNumber,
          fromStatus,
          toStatus,
          actorUserId: ctx.userId,
        });
      }
      return dto;
    });
  }

  async unassign(ctx: CallerContext, jobId: string, reason?: string): Promise<JobDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      });
      if (!job) throw notFound();
      if (job.status !== 'dispatched') {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: `Cannot unassign a job in '${job.status}' state`,
        });
      }
      const previousDriverId = job.assignedDriverId;

      const [updated] = await tx
        .update(jobs)
        .set({
          status: 'new',
          assignedDriverId: null,
          assignedTruckId: null,
          assignedShiftId: null,
          assignedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId))
        .returning();
      if (!updated) throw notFound();

      // Clear current_job_id on the previous driver's shift.
      if (previousDriverId) {
        await tx
          .update(driverShifts)
          .set({
            currentJobId: null,
            status: 'available',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(driverShifts.driverId, previousDriverId),
              isNull(driverShifts.endedAt),
              isNull(driverShifts.deletedAt),
            ),
          );
      }

      await tx.insert(jobStatusTransitions).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        jobId,
        fromStatus: 'dispatched',
        toStatus: 'new',
        actorUserId: ctx.userId,
        reason: reason ?? null,
        metadata: { previousDriverId },
      });

      const dto = rowToDto(updated);
      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.JOB_UNASSIGNED, {
        jobId: dto.id,
        jobNumber: dto.jobNumber,
        previousDriverId,
        reason: reason ?? null,
        unassignedByUserId: ctx.userId,
      });
      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.JOB_STATUS_CHANGED, {
        jobId: dto.id,
        jobNumber: dto.jobNumber,
        fromStatus: 'dispatched',
        toStatus: 'new',
        actorUserId: ctx.userId,
      });
      return dto;
    });
  }

  /**
   * Generic state transition. Used for cancel, mark-enroute, mark-on-scene,
   * mark-in-progress, mark-completed, mark-goa. Direct assign/unassign go
   * through their own methods because they need to touch shift state too.
   */
  async transition(
    ctx: CallerContext,
    jobId: string,
    toStatus: JobStatus,
    reason?: string,
  ): Promise<JobDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      });
      if (!job) throw notFound();
      const fromStatus: JobStatus = job.status;
      try {
        assertCanTransition(fromStatus, toStatus);
      } catch (err) {
        if (err instanceof InvalidJobTransitionError) {
          throw new BadRequestException({
            code: ERROR_CODES.INVALID_STATE_TRANSITION,
            message: err.message,
          });
        }
        throw err;
      }

      const updates: Record<string, unknown> = {
        status: toStatus,
        updatedAt: new Date(),
      };
      if (toStatus === 'cancelled' && reason) {
        updates.cancelledReason = reason;
      }
      if (toStatus === 'completed' || toStatus === 'cancelled' || toStatus === 'goa') {
        // Free the driver — terminal state means the job no longer pins them.
        updates.assignedAt = null;
      }

      const [updated] = await tx.update(jobs).set(updates).where(eq(jobs.id, jobId)).returning();
      if (!updated) throw notFound();

      // If terminal and a driver was on it, clear their currentJobId and
      // bring them back to available.
      if (TERMINAL_STATUSES.has(toStatus) && job.assignedShiftId) {
        await tx
          .update(driverShifts)
          .set({ currentJobId: null, status: 'available', updatedAt: new Date() })
          .where(eq(driverShifts.id, job.assignedShiftId));
      }

      // If the driver shift mirrors job-state for the available enums,
      // sync it (en_route / on_scene / in_progress).
      if (
        job.assignedShiftId &&
        (toStatus === 'enroute' || toStatus === 'on_scene' || toStatus === 'in_progress')
      ) {
        const mappedShiftStatus = toStatus === 'enroute' ? 'en_route' : toStatus;
        await tx
          .update(driverShifts)
          .set({ status: mappedShiftStatus, updatedAt: new Date() })
          .where(eq(driverShifts.id, job.assignedShiftId));
      }

      await tx.insert(jobStatusTransitions).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        jobId,
        fromStatus,
        toStatus,
        actorUserId: ctx.userId,
        reason: reason ?? null,
      });

      const dto = rowToDto(updated);
      this.events.emit(ctx.tenantId, DISPATCH_EVENTS.JOB_STATUS_CHANGED, {
        jobId: dto.id,
        jobNumber: dto.jobNumber,
        fromStatus,
        toStatus,
        actorUserId: ctx.userId,
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

/**
 * Resolve a vehicle by VIN, then by (plate, plateState), else create a new
 * row. Returns the row plus a `created` flag for the caller. Runs against
 * an active TX so the lookup, insert, and any link rows share isolation.
 */
async function findOrCreateVehicle(
  tx: Tx,
  tenantId: string,
  userId: string,
  input: CreateJobIntakePayload,
): Promise<{
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  plateState: string | null;
  vin: string | null;
  created: boolean;
}> {
  const v = input.vehicle;

  if (v.vin) {
    const byVin = await tx.query.vehicles.findFirst({
      where: and(eq(vehicles.vin, v.vin), isNull(vehicles.deletedAt)),
    });
    if (byVin) return { ...projection(byVin), created: false };
  }
  if (v.plate && v.plateState) {
    const byPlate = await tx.query.vehicles.findFirst({
      where: and(
        eq(vehicles.plate, v.plate),
        eq(vehicles.plateState, v.plateState),
        isNull(vehicles.deletedAt),
      ),
    });
    if (byPlate) return { ...projection(byPlate), created: false };
  }

  const id = uuidv7();
  const [row] = await tx
    .insert(vehicles)
    .values({
      id,
      tenantId,
      vin: v.vin ?? null,
      plate: v.plate ?? null,
      plateState: v.plateState ?? null,
      year: v.year ?? null,
      make: v.make ?? null,
      model: v.model ?? null,
      color: v.color ?? null,
      vehicleClass: v.vehicleClass,
      drivetrain: 'unknown',
      isElectric: false,
      isLowClearance: false,
      specialInstructions: v.specialInstructions ?? null,
      createdBy: userId,
    })
    .returning();
  if (!row) throw new Error('insert vehicles .. returning() yielded no row');
  return { ...projection(row), created: true };
}

function projection(v: typeof vehicles.$inferSelect): {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  plateState: string | null;
  vin: string | null;
} {
  return {
    id: v.id,
    year: v.year,
    make: v.make,
    model: v.model,
    plate: v.plate,
    plateState: v.plateState,
    vin: v.vin,
  };
}

/**
 * Allocate the next NNNN suffix for the day, atomically. Uses an UPSERT +
 * UPDATE … RETURNING pattern so concurrent intakes for the same tenant on
 * the same day cannot race past each other. The compound primary key
 * (tenant_id, day_key) makes the conflict target safe.
 */
async function allocateJobNumber(tx: Tx, tenantId: string, when: Date): Promise<string> {
  const dayKey = formatDayKey(when);
  // INSERT ... ON CONFLICT DO UPDATE SET last_seq = last_seq + 1 ... RETURNING.
  const result = await tx.execute<{ last_seq: string | number }>(
    sql`INSERT INTO job_number_sequences (tenant_id, day_key, last_seq, updated_at)
        VALUES (${tenantId}::uuid, ${dayKey}, 1, now())
        ON CONFLICT (tenant_id, day_key)
        DO UPDATE SET last_seq = job_number_sequences.last_seq + 1, updated_at = now()
        RETURNING last_seq`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('job_number_sequences upsert returned no row');
  const seq = typeof row.last_seq === 'string' ? Number(row.last_seq) : row.last_seq;
  return `${dayKey}-${String(seq).padStart(4, '0')}`;
}

function formatDayKey(when: Date): string {
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, '0');
  const d = String(when.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function numToText(n?: number | null): string | null {
  if (n == null) return null;
  return String(n);
}

function textToNum(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const notFound = (): NotFoundException =>
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Job not found' });

function rowToDto(j: typeof jobs.$inferSelect): JobDto {
  return {
    id: j.id,
    tenantId: j.tenantId,
    jobNumber: j.jobNumber,
    status: j.status,
    serviceType: j.serviceType,
    customerId: j.customerId,
    vehicleId: j.vehicleId,
    accountId: j.accountId,
    pickupAddress: j.pickupAddress,
    pickupLat: textToNum(j.pickupLat),
    pickupLng: textToNum(j.pickupLng),
    dropoffAddress: j.dropoffAddress,
    dropoffLat: textToNum(j.dropoffLat),
    dropoffLng: textToNum(j.dropoffLng),
    authorizedBy: j.authorizedBy,
    authorizedByName: j.authorizedByName,
    rateQuotedCents: j.rateQuotedCents,
    rateBreakdown: (j.rateBreakdown as JobDto['rateBreakdown']) ?? null,
    notes: j.notes,
    cancelledReason: j.cancelledReason,
    assignedDriverId: j.assignedDriverId,
    assignedTruckId: j.assignedTruckId,
    assignedShiftId: j.assignedShiftId,
    assignedAt: j.assignedAt ? j.assignedAt.toISOString() : null,
    createdByUserId: j.createdByUserId,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    deletedAt: j.deletedAt ? j.deletedAt.toISOString() : null,
  };
}
