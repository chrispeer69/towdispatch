/**
 * DotService — Full DOT Compliance (Session 37).
 *
 * Operator-side orchestration for FMCSA recordkeeping:
 *   - carrier profile     : one per tenant (upsert)
 *   - driver DQ files      : extension of `drivers` + computed completeness
 *   - hours-of-service     : manual duty-status entries + week validation
 *   - drug & alcohol       : program test log
 *   - incidents            : accident/incident register
 *   - audit packet         : combined PDF over a date range
 *   - reports              : HOS violations / DQ deficiencies / open DVIRs
 *
 * DVIR is NOT written here — it is owned by the fleet module
 * (apps/api/src/modules/fleet/dvirs.service.ts, table `dvirs`). DOT reads
 * that table for the audit packet and the open-defects report. See
 * SESSION_37_DECISIONS.md.
 *
 * Every method runs inside `runInTenantContext` so RLS isolates tenants;
 * the controller gates each method by Role. Decision logic (HOS rules, DQ
 * completeness) lives in the pure helpers hos-rules.logic.ts /
 * dq-file.logic.ts — this service is data access + transaction boundaries.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type DotCarrierProfile,
  type DotDriverQualification,
  type DotDrugAlcoholTest,
  type DotHosLog,
  type DotIncidentReport,
  dotCarrierProfile,
  dotDriverQualifications,
  dotDrugAlcoholTests,
  dotHosLogs,
  dotIncidentReports,
  drivers,
  dvirs,
  trucks,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  AuditPacketQuery,
  DotCarrierProfileDto,
  DotDriverDqViewDto,
  DotDriverQualificationDto,
  DotDrugAlcoholTestDto,
  DotHosLogDto,
  DotHosViolationReportRow,
  DotHosWeekResultDto,
  DotIncidentReportDto,
  DotOpenDvirDto,
  ListDrugTestFilter,
  ListHosFilter,
  RecordDqEventPayload,
  RecordDrugTestPayload,
  RecordHosEntryPayload,
  RecordIncidentPayload,
  UpsertDotCarrierProfilePayload,
} from '@ustowdispatch/shared';
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { type AuditPacketData, DotAuditPacketRenderer } from './dot-audit-packet.renderer.js';
import { dqFileStatus } from './dq-file.logic.js';
import { type HosSegmentInput, validateHosWeek } from './hos-rules.logic.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

interface DefectShape {
  component?: unknown;
  severity?: unknown;
  notes?: unknown;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toCarrierDto(r: DotCarrierProfile): DotCarrierProfileDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    usdotNumber: r.usdotNumber,
    mcNumber: r.mcNumber,
    legalName: r.legalName,
    dbaName: r.dbaName,
    carrierType: r.carrierType,
    operatingClassification: r.operatingClassification ?? [],
    safetyRating: r.safetyRating ?? null,
    lastAuditedAt: iso(r.lastAuditedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toDqDto(r: DotDriverQualification): DotDriverQualificationDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    driverId: r.driverId,
    dqFileStatus: r.dqFileStatus,
    employmentAppSignedAt: iso(r.employmentAppSignedAt),
    mvrPulledAt: iso(r.mvrPulledAt),
    mvrExpiresAt: iso(r.mvrExpiresAt),
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toHosDto(r: DotHosLog): DotHosLogDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    driverId: r.driverId,
    logDate: r.logDate,
    status: r.status,
    startAt: r.startAt.toISOString(),
    endAt: iso(r.endAt),
    milesDriven: r.milesDriven,
    vehicleId: r.vehicleId,
    locationText: r.locationText,
    remarks: r.remarks,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toDrugDto(r: DotDrugAlcoholTest): DotDrugAlcoholTestDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    driverId: r.driverId,
    testType: r.testType,
    collectedAt: r.collectedAt.toISOString(),
    result: r.result,
    lab: r.lab,
    docKey: r.docKey,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toIncidentDto(r: DotIncidentReport): DotIncidentReportDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    jobId: r.jobId,
    driverId: r.driverId,
    truckId: r.truckId,
    occurredAt: r.occurredAt.toISOString(),
    locationText: r.locationText,
    severity: r.severity,
    fatalities: r.fatalities,
    injuries: r.injuries,
    hazmatRelease: r.hazmatRelease,
    towedAway: r.towedAway,
    narrative: r.narrative,
    dotReportable: r.dotReportable,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

@Injectable()
export class DotService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly packet: DotAuditPacketRenderer,
  ) {}

  // ===================================================================
  // Carrier profile (one per tenant)
  // ===================================================================

  async getCarrierProfile(ctx: CallerCtx): Promise<DotCarrierProfileDto | null> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.dotCarrierProfile.findFirst({
        where: isNull(dotCarrierProfile.deletedAt),
      });
      return row ? toCarrierDto(row) : null;
    });
  }

  async upsertCarrierProfile(
    ctx: CallerCtx,
    input: UpsertDotCarrierProfilePayload,
  ): Promise<DotCarrierProfileDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.dotCarrierProfile.findFirst({
        where: isNull(dotCarrierProfile.deletedAt),
      });
      const values = {
        usdotNumber: input.usdotNumber ?? null,
        mcNumber: input.mcNumber ?? null,
        legalName: input.legalName,
        dbaName: input.dbaName ?? null,
        carrierType: input.carrierType,
        operatingClassification: input.operatingClassification,
        safetyRating: input.safetyRating ?? null,
        lastAuditedAt: input.lastAuditedAt ? new Date(input.lastAuditedAt) : null,
      };
      if (existing) {
        const [row] = await tx
          .update(dotCarrierProfile)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(dotCarrierProfile.id, existing.id))
          .returning();
        return toCarrierDto(row as DotCarrierProfile);
      }
      const [row] = await tx
        .insert(dotCarrierProfile)
        .values({ id: uuidv7(), tenantId: ctx.tenantId, createdBy: ctx.userId, ...values })
        .returning();
      return toCarrierDto(row as DotCarrierProfile);
    });
  }

  // ===================================================================
  // Driver qualifications (DQ file)
  // ===================================================================

  async recordDqEvent(
    ctx: CallerCtx,
    input: RecordDqEventPayload,
  ): Promise<DotDriverQualificationDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const driver = await tx.query.drivers.findFirst({
        where: and(eq(drivers.id, input.driverId), isNull(drivers.deletedAt)),
        columns: { id: true },
      });
      if (!driver) throw new NotFoundException('driver not found');

      const existing = await tx.query.dotDriverQualifications.findFirst({
        where: and(
          eq(dotDriverQualifications.driverId, input.driverId),
          isNull(dotDriverQualifications.deletedAt),
        ),
      });

      const patch: Partial<typeof dotDriverQualifications.$inferInsert> = {};
      if (input.dqFileStatus !== undefined) patch.dqFileStatus = input.dqFileStatus;
      if (input.employmentAppSignedAt !== undefined)
        patch.employmentAppSignedAt = input.employmentAppSignedAt
          ? new Date(input.employmentAppSignedAt)
          : null;
      if (input.mvrPulledAt !== undefined)
        patch.mvrPulledAt = input.mvrPulledAt ? new Date(input.mvrPulledAt) : null;
      if (input.mvrExpiresAt !== undefined)
        patch.mvrExpiresAt = input.mvrExpiresAt ? new Date(input.mvrExpiresAt) : null;
      if (input.notes !== undefined) patch.notes = input.notes;

      if (existing) {
        const [row] = await tx
          .update(dotDriverQualifications)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(dotDriverQualifications.id, existing.id))
          .returning();
        return toDqDto(row as DotDriverQualification);
      }
      const [row] = await tx
        .insert(dotDriverQualifications)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          driverId: input.driverId,
          createdBy: ctx.userId,
          ...patch,
        })
        .returning();
      return toDqDto(row as DotDriverQualification);
    });
  }

  async listDriverDqViews(ctx: CallerCtx): Promise<DotDriverDqViewDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const driverRows = await tx.query.drivers.findMany({
        where: isNull(drivers.deletedAt),
        orderBy: (t, { asc: a }) => [a(t.lastName), a(t.firstName)],
      });
      const dqRows = await tx.query.dotDriverQualifications.findMany({
        where: isNull(dotDriverQualifications.deletedAt),
      });
      const dqByDriver = new Map(dqRows.map((r) => [r.driverId, r]));
      const today = new Date();
      return driverRows.map((d) => buildDqView(d, dqByDriver.get(d.id) ?? null, today));
    });
  }

  async getDriverDqView(ctx: CallerCtx, driverId: string): Promise<DotDriverDqViewDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const d = await tx.query.drivers.findFirst({
        where: and(eq(drivers.id, driverId), isNull(drivers.deletedAt)),
      });
      if (!d) throw new NotFoundException('driver not found');
      const dq = await tx.query.dotDriverQualifications.findFirst({
        where: and(
          eq(dotDriverQualifications.driverId, driverId),
          isNull(dotDriverQualifications.deletedAt),
        ),
      });
      return buildDqView(d, dq ?? null, new Date());
    });
  }

  // ===================================================================
  // Hours of service
  // ===================================================================

  async recordHosEntry(ctx: CallerCtx, input: RecordHosEntryPayload): Promise<DotHosLogDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const [row] = await tx
        .insert(dotHosLogs)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          driverId: input.driverId,
          logDate: input.logDate,
          status: input.status,
          startAt: new Date(input.startAt),
          endAt: input.endAt ? new Date(input.endAt) : null,
          milesDriven: input.milesDriven ?? null,
          vehicleId: input.vehicleId ?? null,
          locationText: input.locationText ?? null,
          remarks: input.remarks ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      return toHosDto(row as DotHosLog);
    });
  }

  async listHosEntries(ctx: CallerCtx, filter: ListHosFilter): Promise<DotHosLogDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [isNull(dotHosLogs.deletedAt)];
      if (filter.driverId) clauses.push(eq(dotHosLogs.driverId, filter.driverId));
      if (filter.from) clauses.push(gte(dotHosLogs.logDate, filter.from));
      if (filter.to) clauses.push(lte(dotHosLogs.logDate, filter.to));
      const rows = await tx
        .select()
        .from(dotHosLogs)
        .where(and(...clauses))
        .orderBy(asc(dotHosLogs.logDate), asc(dotHosLogs.startAt));
      return rows.map(toHosDto);
    });
  }

  async getHosWeek(
    ctx: CallerCtx,
    driverId: string,
    from: string,
    to: string,
  ): Promise<DotHosWeekResultDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(dotHosLogs)
        .where(
          and(
            eq(dotHosLogs.driverId, driverId),
            gte(dotHosLogs.logDate, from),
            lte(dotHosLogs.logDate, to),
            isNull(dotHosLogs.deletedAt),
          ),
        )
        .orderBy(asc(dotHosLogs.startAt));
      return runHosWeek(driverId, from, to, rows);
    });
  }

  // ===================================================================
  // Drug & alcohol
  // ===================================================================

  async recordDrugTest(
    ctx: CallerCtx,
    input: RecordDrugTestPayload,
  ): Promise<DotDrugAlcoholTestDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const [row] = await tx
        .insert(dotDrugAlcoholTests)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          driverId: input.driverId,
          testType: input.testType,
          collectedAt: new Date(input.collectedAt),
          result: input.result,
          lab: input.lab ?? null,
          docKey: input.docKey ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      return toDrugDto(row as DotDrugAlcoholTest);
    });
  }

  async listDrugTests(
    ctx: CallerCtx,
    filter: ListDrugTestFilter,
  ): Promise<DotDrugAlcoholTestDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [isNull(dotDrugAlcoholTests.deletedAt)];
      if (filter.driverId) clauses.push(eq(dotDrugAlcoholTests.driverId, filter.driverId));
      if (filter.testType) clauses.push(eq(dotDrugAlcoholTests.testType, filter.testType));
      if (filter.result) clauses.push(eq(dotDrugAlcoholTests.result, filter.result));
      const rows = await tx
        .select()
        .from(dotDrugAlcoholTests)
        .where(and(...clauses))
        .orderBy(desc(dotDrugAlcoholTests.collectedAt));
      return rows.map(toDrugDto);
    });
  }

  // ===================================================================
  // Incidents
  // ===================================================================

  async recordIncident(
    ctx: CallerCtx,
    input: RecordIncidentPayload,
  ): Promise<DotIncidentReportDto> {
    const derivedReportable =
      input.fatalities > 0 ||
      input.injuries > 0 ||
      input.towedAway ||
      input.severity === 'injury' ||
      input.severity === 'fatality';
    return this.db.runInTenantContext(ctx, async (tx) => {
      const [row] = await tx
        .insert(dotIncidentReports)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          jobId: input.jobId ?? null,
          driverId: input.driverId ?? null,
          truckId: input.truckId ?? null,
          occurredAt: new Date(input.occurredAt),
          locationText: input.locationText ?? null,
          severity: input.severity,
          fatalities: input.fatalities,
          injuries: input.injuries,
          hazmatRelease: input.hazmatRelease,
          towedAway: input.towedAway,
          narrative: input.narrative ?? null,
          dotReportable: input.dotReportable ?? derivedReportable,
          createdBy: ctx.userId,
        })
        .returning();
      return toIncidentDto(row as DotIncidentReport);
    });
  }

  async listIncidents(ctx: CallerCtx): Promise<DotIncidentReportDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(dotIncidentReports)
        .where(isNull(dotIncidentReports.deletedAt))
        .orderBy(desc(dotIncidentReports.occurredAt));
      return rows.map(toIncidentDto);
    });
  }

  // ===================================================================
  // Reports
  // ===================================================================

  /** HOS violations by driver over the trailing `days` window (default 90). */
  async hosViolationsReport(ctx: CallerCtx, days = 90): Promise<DotHosViolationReportRow[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const since = isoDate(new Date(Date.now() - days * 86_400_000));
      const driverRows = await tx.query.drivers.findMany({
        where: isNull(drivers.deletedAt),
        columns: { id: true, firstName: true, lastName: true },
      });
      const out: DotHosViolationReportRow[] = [];
      for (const d of driverRows) {
        const rows = await tx
          .select()
          .from(dotHosLogs)
          .where(
            and(
              eq(dotHosLogs.driverId, d.id),
              gte(dotHosLogs.logDate, since),
              isNull(dotHosLogs.deletedAt),
            ),
          )
          .orderBy(asc(dotHosLogs.startAt));
        if (rows.length === 0) continue;
        const result = validateHosWeek(rows.map(toSegment));
        if (result.violations.length === 0) continue;
        out.push({
          driverId: d.id,
          driverName: `${d.firstName} ${d.lastName}`,
          violationCount: result.violations.length,
          violations: result.violations.map((v) => ({
            rule: v.rule,
            at: v.at.toISOString(),
            severity: v.severity,
            detail: v.detail,
          })),
        });
      }
      return out.sort((a, b) => b.violationCount - a.violationCount);
    });
  }

  /** Drivers whose DQ file is incomplete or has an item expiring soon. */
  async dqDeficiencyReport(ctx: CallerCtx): Promise<DotDriverDqViewDto[]> {
    const views = await this.listDriverDqViews(ctx);
    return views.filter((v) => !v.complete || v.expiring.length > 0);
  }

  /** Open DVIR defects, sourced from the existing fleet `dvirs` table. */
  async openDvirReport(ctx: CallerCtx): Promise<DotOpenDvirDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => this.readOpenDvirs(tx));
  }

  private async readOpenDvirs(
    tx: Parameters<Parameters<TenantAwareDb['runInTenantContext']>[1]>[0],
  ): Promise<DotOpenDvirDto[]> {
    const rows = await tx
      .select({
        dvirId: dvirs.id,
        truckId: dvirs.truckId,
        truckUnit: trucks.unitNumber,
        driverId: dvirs.driverId,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        type: dvirs.type,
        submittedAt: dvirs.submittedAt,
        status: dvirs.status,
        defects: dvirs.defects,
      })
      .from(dvirs)
      .leftJoin(trucks, eq(trucks.id, dvirs.truckId))
      .leftJoin(drivers, eq(drivers.id, dvirs.driverId))
      .where(and(isNull(dvirs.deletedAt)))
      .orderBy(desc(dvirs.submittedAt));
    return rows
      .filter((r) => r.status !== 'no_defects')
      .map((r) => ({
        dvirId: r.dvirId,
        truckId: r.truckId,
        truckUnit: r.truckUnit ?? null,
        driverId: r.driverId,
        driverName: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
        type: r.type,
        submittedAt: r.submittedAt.toISOString(),
        status: r.status,
        defects: normalizeDefects(r.defects),
      }));
  }

  // ===================================================================
  // Audit packet (PDF)
  // ===================================================================

  async generateAuditPacket(ctx: CallerCtx, query: AuditPacketQuery): Promise<Buffer> {
    const data = await this.db.runInTenantContext(ctx, async (tx) => {
      const carrierRow = await tx.query.dotCarrierProfile.findFirst({
        where: isNull(dotCarrierProfile.deletedAt),
      });

      const driverRows = await tx.query.drivers.findMany({
        where: isNull(drivers.deletedAt),
        orderBy: (t, { asc: a }) => [a(t.lastName), a(t.firstName)],
      });
      const dqRows = await tx.query.dotDriverQualifications.findMany({
        where: isNull(dotDriverQualifications.deletedAt),
      });
      const dqByDriver = new Map(dqRows.map((r) => [r.driverId, r]));
      const today = new Date();
      const dqViews = driverRows.map((d) => buildDqView(d, dqByDriver.get(d.id) ?? null, today));

      // HOS week + violations per driver over the range.
      const hosByDriver: DotHosWeekResultDto[] = [];
      for (const d of driverRows) {
        const rows = await tx
          .select()
          .from(dotHosLogs)
          .where(
            and(
              eq(dotHosLogs.driverId, d.id),
              gte(dotHosLogs.logDate, query.from),
              lte(dotHosLogs.logDate, query.to),
              isNull(dotHosLogs.deletedAt),
            ),
          )
          .orderBy(asc(dotHosLogs.startAt));
        if (rows.length === 0) continue;
        hosByDriver.push(runHosWeek(d.id, query.from, query.to, rows));
      }

      const drugRows = await tx
        .select()
        .from(dotDrugAlcoholTests)
        .where(
          and(
            gte(dotDrugAlcoholTests.collectedAt, new Date(`${query.from}T00:00:00.000Z`)),
            lte(dotDrugAlcoholTests.collectedAt, new Date(`${query.to}T23:59:59.999Z`)),
            isNull(dotDrugAlcoholTests.deletedAt),
          ),
        )
        .orderBy(desc(dotDrugAlcoholTests.collectedAt));

      const incidentRows = await tx
        .select()
        .from(dotIncidentReports)
        .where(
          and(
            gte(dotIncidentReports.occurredAt, new Date(`${query.from}T00:00:00.000Z`)),
            lte(dotIncidentReports.occurredAt, new Date(`${query.to}T23:59:59.999Z`)),
            isNull(dotIncidentReports.deletedAt),
          ),
        )
        .orderBy(desc(dotIncidentReports.occurredAt));

      const openDvirs = await this.readOpenDvirs(tx);

      const driverNames = new Map(driverRows.map((d) => [d.id, `${d.firstName} ${d.lastName}`]));

      const out: AuditPacketData = {
        from: query.from,
        to: query.to,
        carrier: carrierRow ? toCarrierDto(carrierRow) : null,
        dqViews,
        hosByDriver,
        drugTests: drugRows.map(toDrugDto),
        incidents: incidentRows.map(toIncidentDto),
        openDvirs,
        driverNames,
      };
      return out;
    });

    return this.packet.render(data);
  }
}

// ---------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

function toSegment(r: DotHosLog): HosSegmentInput {
  return { status: r.status, startAt: r.startAt, endAt: r.endAt };
}

function runHosWeek(
  driverId: string,
  from: string,
  to: string,
  rows: DotHosLog[],
): DotHosWeekResultDto {
  const result = validateHosWeek(rows.map(toSegment));
  return {
    driverId,
    from,
    to,
    totalDrivingMinutes: result.totalDrivingMinutes,
    totalOnDutyMinutes: result.totalOnDutyMinutes,
    violations: result.violations.map((v) => ({
      rule: v.rule,
      at: v.at.toISOString(),
      severity: v.severity,
      detail: v.detail,
    })),
  };
}

function normalizeDefects(raw: unknown): DotOpenDvirDto['defects'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => {
    const o = (d ?? {}) as DefectShape;
    return {
      component: typeof o.component === 'string' ? o.component : 'unknown',
      severity: typeof o.severity === 'string' ? o.severity : 'unknown',
      notes: typeof o.notes === 'string' ? o.notes : null,
    };
  });
}

interface DriverRowLike {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  cdlClass: string;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpiresAt: string | null;
  medicalCardExpiresAt: string | null;
  drugTestLastAt: string | null;
  roadTestCompletedAt: string | null;
}

function buildDqView(
  d: DriverRowLike,
  dq: DotDriverQualification | null,
  today: Date,
): DotDriverDqViewDto {
  const ext = dq
    ? {
        employmentAppSignedAt: dq.employmentAppSignedAt
          ? dq.employmentAppSignedAt.toISOString()
          : null,
        mvrPulledAt: dq.mvrPulledAt ? dq.mvrPulledAt.toISOString() : null,
        mvrExpiresAt: dq.mvrExpiresAt ? dq.mvrExpiresAt.toISOString() : null,
      }
    : null;
  const status = dqFileStatus(
    {
      cdlClass: d.cdlClass,
      licenseNumber: d.licenseNumber,
      licenseExpiresAt: d.licenseExpiresAt,
      medicalCardExpiresAt: d.medicalCardExpiresAt,
      drugTestLastAt: d.drugTestLastAt,
      roadTestCompletedAt: d.roadTestCompletedAt,
    },
    ext,
    today,
  );
  return {
    driverId: d.id,
    firstName: d.firstName,
    lastName: d.lastName,
    employeeNumber: d.employeeNumber,
    cdlClass: d.cdlClass,
    licenseNumber: d.licenseNumber,
    licenseState: d.licenseState,
    licenseExpiresAt: d.licenseExpiresAt,
    medicalCardExpiresAt: d.medicalCardExpiresAt,
    drugTestLastAt: d.drugTestLastAt,
    roadTestCompletedAt: d.roadTestCompletedAt,
    employmentAppSignedAt: ext?.employmentAppSignedAt ?? null,
    mvrPulledAt: ext?.mvrPulledAt ?? null,
    mvrExpiresAt: ext?.mvrExpiresAt ?? null,
    dqFileStatus: dq?.dqFileStatus ?? 'incomplete',
    complete: status.complete,
    missing: status.missing,
    expiring: status.expiring,
  };
}
