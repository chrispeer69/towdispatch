/**
 * EvRecoveryService — EV-Specific Recovery Workflows (Session 48).
 *
 * EV-aware layer over the dispatch (jobs) module:
 *   - attributes : mark a job EV + record the on-scene charge-state / HV /
 *                  tow-mode intake (one row per job, upserted)
 *   - oem        : look up the most-specific OEM tow procedure (global ref)
 *   - thermal    : record a battery thermal event + surface its escalation
 *   - charge     : log a charge stop during a long-haul recovery
 *
 * Every tenant query runs inside `runInTenantContext` so RLS isolates tenants.
 * All DECISIONS (equipment, escalation, OEM match) live in the pure engine
 * ev-rules.logic.ts; this service is data access + the detail composition.
 * Dispatch core (jobs) is read-only here — no jobs file is modified.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type EvOemProcedureRow,
  evChargeStationVisits,
  evJobAttributes,
  evThermalEvents,
  jobs,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  EvChargeStopDto,
  EvJobAttributesDto,
  EvJobDetailDto,
  EvOemProcedureDto,
  EvThermalEventDto,
  LogChargeStopPayload,
  MarkJobEvPayload,
  RecordEvIntakePayload,
  ReportThermalEventPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import {
  type EvEquipmentFacts,
  matchOemProcedure,
  requiredEquipmentForEv,
  thermalEventEscalation,
} from './ev-rules.logic.js';

export interface EvCallerCtx {
  tenantId: string;
  // Audit actor for app.current_user_id — an operator user id OR a driver id.
  userId: string;
  requestId: string;
  // FK to users(id); null for driver-originated writes (a driverId is not a
  // users.id), mirroring the driver-experience write pattern.
  createdBy: string | null;
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class EvRecoveryService {
  constructor(private readonly db: TenantAwareDb) {}

  // ===================================================================
  // Attributes (mark EV + intake)
  // ===================================================================

  async markJobEv(
    ctx: EvCallerCtx,
    jobId: string,
    input: MarkJobEvPayload,
  ): Promise<EvJobDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireJob(tx, jobId);
      await this.upsertAttributes(tx, ctx, jobId, input);
      return this.buildDetail(tx, jobId);
    });
  }

  async recordIntake(
    ctx: EvCallerCtx,
    jobId: string,
    input: RecordEvIntakePayload,
  ): Promise<EvJobDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireJob(tx, jobId);
      await this.upsertAttributes(tx, ctx, jobId, input);
      return this.buildDetail(tx, jobId);
    });
  }

  async getJobDetail(ctx: EvCallerCtx, jobId: string): Promise<EvJobDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireAttributes(tx, jobId);
      return this.buildDetail(tx, jobId);
    });
  }

  // ===================================================================
  // OEM procedures (global reference data)
  // ===================================================================

  async lookupOemProcedure(
    ctx: EvCallerCtx,
    make: string,
    model?: string,
    year?: number,
  ): Promise<EvOemProcedureDto | null> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const candidates = await this.loadOemByMake(tx, make);
      const match = matchOemProcedure(candidates, make, model ?? null, year ?? null);
      return match ? toOemDto(match) : null;
    });
  }

  async listOemProcedures(ctx: EvCallerCtx): Promise<EvOemProcedureDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.evOemProcedures.findMany({
        orderBy: (t, { asc }) => [asc(t.make), asc(t.model)],
      });
      return rows.map(toOemDto);
    });
  }

  // ===================================================================
  // Thermal events
  // ===================================================================

  async reportThermalEvent(
    ctx: EvCallerCtx,
    jobId: string,
    input: ReportThermalEventPayload,
  ): Promise<EvJobDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireJob(tx, jobId);
      // Ensure the job is flagged EV; create a bare attributes row if needed so
      // a driver can quick-report before formal intake.
      const attrs = await this.loadAttributes(tx, jobId);
      if (!attrs) await this.upsertAttributes(tx, ctx, jobId, {});

      await tx.insert(evThermalEvents).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        jobId,
        observedAt: input.observedAt ? new Date(input.observedAt) : new Date(),
        severity: input.severity,
        actionTaken: input.actionTaken ?? null,
        hazmatCalled: input.hazmatCalled ?? false,
        fireDeptCalled: input.fireDeptCalled ?? false,
        customerEvacuated: input.customerEvacuated ?? false,
        sceneSecured: input.sceneSecured ?? false,
        photoKeys: input.photoKeys ?? [],
        createdBy: ctx.createdBy,
      });

      // Flip the observed flag on the attributes row (drives HV-isolation
      // guidance in the equipment rules).
      await tx
        .update(evJobAttributes)
        .set({ thermalEventObserved: true, updatedAt: new Date() })
        .where(and(eq(evJobAttributes.jobId, jobId), isNull(evJobAttributes.deletedAt)));

      return this.buildDetail(tx, jobId);
    });
  }

  // ===================================================================
  // Charge stops
  // ===================================================================

  async logChargeStop(
    ctx: EvCallerCtx,
    jobId: string,
    input: LogChargeStopPayload,
  ): Promise<EvJobDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireJob(tx, jobId);
      const attrs = await this.loadAttributes(tx, jobId);
      if (!attrs) await this.upsertAttributes(tx, ctx, jobId, {});

      await tx.insert(evChargeStationVisits).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        jobId,
        stationNetwork: input.stationNetwork ?? null,
        stationAddress: input.stationAddress ?? null,
        arrivedAt: input.arrivedAt ? new Date(input.arrivedAt) : new Date(),
        departedAt: input.departedAt ? new Date(input.departedAt) : null,
        kwhDelivered: input.kwhDelivered !== undefined ? String(input.kwhDelivered) : null,
        costCents: input.costCents ?? null,
        paidBy: input.paidBy ?? 'tenant',
        createdBy: ctx.createdBy,
      });

      return this.buildDetail(tx, jobId);
    });
  }

  // ===================================================================
  // Internals
  // ===================================================================

  private async requireJob(tx: Tx, jobId: string): Promise<typeof jobs.$inferSelect> {
    const row = await tx.query.jobs.findFirst({
      where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
    });
    if (!row) throw notFound('Job not found in this tenant');
    return row;
  }

  private async loadAttributes(
    tx: Tx,
    jobId: string,
  ): Promise<typeof evJobAttributes.$inferSelect | null> {
    const row = await tx.query.evJobAttributes.findFirst({
      where: and(eq(evJobAttributes.jobId, jobId), isNull(evJobAttributes.deletedAt)),
    });
    return row ?? null;
  }

  private async requireAttributes(
    tx: Tx,
    jobId: string,
  ): Promise<typeof evJobAttributes.$inferSelect> {
    const row = await this.loadAttributes(tx, jobId);
    if (!row) throw notFound('This job is not marked as an EV recovery');
    return row;
  }

  /** Create the single attributes row, or patch the existing one (idempotent). */
  private async upsertAttributes(
    tx: Tx,
    ctx: EvCallerCtx,
    jobId: string,
    input: MarkJobEvPayload | RecordEvIntakePayload,
  ): Promise<void> {
    const existing = await this.loadAttributes(tx, jobId);
    const patch = {
      make: input.make,
      model: input.model,
      modelYear: input.modelYear,
      batteryChemistry: input.batteryChemistry,
      batteryKwh: input.batteryKwh !== undefined ? String(input.batteryKwh) : undefined,
      stateOfChargePct: input.stateOfChargePct,
      chargePortLocked: input.chargePortLocked,
      hvIsolated: input.hvIsolated,
      towModeEngaged: input.towModeEngaged,
      oemTowProcedureAcknowledged: input.oemTowProcedureAcknowledged,
      thermalEventObserved: input.thermalEventObserved,
      thermalEventNotes:
        input.thermalEventNotes === undefined ? undefined : input.thermalEventNotes,
    };
    // Drop keys the caller did not supply so we never clobber with undefined.
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;

    if (existing) {
      if (Object.keys(set).length === 0) return;
      set.updatedAt = new Date();
      await tx
        .update(evJobAttributes)
        .set(set)
        .where(and(eq(evJobAttributes.jobId, jobId), isNull(evJobAttributes.deletedAt)));
      return;
    }
    await tx.insert(evJobAttributes).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      jobId,
      createdBy: ctx.createdBy,
      ...set,
    });
  }

  private async loadOemByMake(tx: Tx, make: string): Promise<EvOemProcedureRow[]> {
    // ev_oem_procedures is global reference data (no RLS); a plain make-scoped
    // read is safe. The most-specific match is resolved in the pure engine.
    const rows = await tx.query.evOemProcedures.findMany();
    const m = make.trim().toLowerCase();
    return rows.filter((r) => r.make.trim().toLowerCase() === m);
  }

  private async buildDetail(tx: Tx, jobId: string): Promise<EvJobDetailDto> {
    const attrs = await this.requireAttributes(tx, jobId);
    const job = await tx.query.jobs.findFirst({ where: eq(jobs.id, jobId) });

    const facts: EvEquipmentFacts = {
      make: attrs.make,
      model: attrs.model,
      towModeEngaged: attrs.towModeEngaged,
      hvIsolated: attrs.hvIsolated,
      stateOfChargePct: attrs.stateOfChargePct,
      // intow_miles is the pickup→dropoff (wheels-down) distance.
      distanceMiles: job ? num(job.intowMiles) : null,
      thermalEventObserved: attrs.thermalEventObserved,
    };
    const equipment = requiredEquipmentForEv(facts);

    let oemProcedure: EvOemProcedureDto | null = null;
    if (attrs.make) {
      const candidates = await this.loadOemByMake(tx, attrs.make);
      const match = matchOemProcedure(
        candidates,
        attrs.make,
        attrs.model ?? null,
        attrs.modelYear ?? null,
      );
      oemProcedure = match ? toOemDto(match) : null;
    }

    const thermalRows = await tx.query.evThermalEvents.findMany({
      where: and(eq(evThermalEvents.jobId, jobId), isNull(evThermalEvents.deletedAt)),
      orderBy: (t, { desc: d }) => [d(t.observedAt)],
    });
    const chargeRows = await tx.query.evChargeStationVisits.findMany({
      where: and(eq(evChargeStationVisits.jobId, jobId), isNull(evChargeStationVisits.deletedAt)),
      orderBy: (t, { desc: d }) => [d(t.arrivedAt)],
    });

    return {
      attributes: toAttributesDto(attrs),
      equipment,
      oemProcedure,
      thermalEvents: thermalRows.map(toThermalDto),
      chargeStops: chargeRows.map(toChargeDto),
    };
  }
}

// ======================================================================
// Pure helpers / mappers
// ======================================================================

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

function toAttributesDto(row: typeof evJobAttributes.$inferSelect): EvJobAttributesDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    make: row.make,
    model: row.model,
    modelYear: row.modelYear,
    batteryChemistry: row.batteryChemistry,
    batteryKwh: num(row.batteryKwh),
    stateOfChargePct: row.stateOfChargePct,
    chargePortLocked: row.chargePortLocked,
    hvIsolated: row.hvIsolated,
    towModeEngaged: row.towModeEngaged,
    oemTowProcedureAcknowledged: row.oemTowProcedureAcknowledged,
    thermalEventObserved: row.thermalEventObserved,
    thermalEventNotes: row.thermalEventNotes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toOemDto(row: EvOemProcedureRow): EvOemProcedureDto {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    modelYearFrom: row.modelYearFrom,
    modelYearTo: row.modelYearTo,
    towModeSteps: row.towModeSteps,
    hvDisconnectSteps: row.hvDisconnectSteps,
    jackingPointsUrl: row.jackingPointsUrl,
    officialDocUrl: row.officialDocUrl,
    lastVerifiedAt: row.lastVerifiedAt.toISOString(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toThermalDto(row: typeof evThermalEvents.$inferSelect): EvThermalEventDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    observedAt: row.observedAt.toISOString(),
    severity: row.severity,
    actionTaken: row.actionTaken,
    hazmatCalled: row.hazmatCalled,
    fireDeptCalled: row.fireDeptCalled,
    customerEvacuated: row.customerEvacuated,
    sceneSecured: row.sceneSecured,
    photoKeys: row.photoKeys,
    escalation: thermalEventEscalation(row.severity),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function toChargeDto(row: typeof evChargeStationVisits.$inferSelect): EvChargeStopDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    stationNetwork: row.stationNetwork,
    stationAddress: row.stationAddress,
    arrivedAt: row.arrivedAt.toISOString(),
    departedAt: row.departedAt ? row.departedAt.toISOString() : null,
    kwhDelivered: num(row.kwhDelivered),
    costCents: row.costCents,
    paidBy: row.paidBy,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
