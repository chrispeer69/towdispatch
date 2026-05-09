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
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  customerVehicles,
  customers,
  jobNumberSequences,
  jobs,
  uuidv7,
  vehicles,
} from '@towcommand/db';
import {
  type CreateJobIntakePayload,
  ERROR_CODES,
  type IntakeResultDto,
  type JobDto,
  type QuotePreviewPayload,
  type RateQuote,
} from '@towcommand/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { RateEngineService } from '../rates/rate-engine.service.js';

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

      return {
        job: rowToDto(row),
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
    const updated = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, id), isNull(jobs.deletedAt)),
      });
      if (!existing) return null;
      const [row] = await tx
        .update(jobs)
        .set({
          status: 'cancelled',
          cancelledReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, id))
        .returning();
      return row ?? null;
    });
    if (!updated) throw notFound();
    return rowToDto(updated);
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
    createdByUserId: j.createdByUserId,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    deletedAt: j.deletedAt ? j.deletedAt.toISOString() : null,
  };
}
