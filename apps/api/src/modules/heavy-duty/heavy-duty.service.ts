/**
 * HeavyDutyService — Heavy-Duty Specialist (Session 36).
 *
 * Operator-side orchestration for the HD layer:
 *   - truck capabilities : set (upsert) / get / list
 *   - driver certs       : record (upsert) / list
 *   - job attributes     : mark HD (upsert) / detail (+ eligibility) /
 *                          on-scene estimate / finalize invoice
 *   - rate sheets        : list / create / update / soft-delete
 *   - reports            : HD jobs by month / cert-expiry roster /
 *                          equipment utilization
 *
 * Every method runs inside runInTenantContext so RLS isolates tenants; the
 * controller gates each method by Role. All decision logic (eligibility,
 * estimate math, cert status) lives in the pure helpers
 * (heavy-duty-eligibility.logic.ts / heavy-duty-rates.logic.ts) — this
 * service is data access + transaction boundaries. Data access is inline
 * (no repository), matching the impound / lien modules.
 *
 * Cross-module write: setTruckCapabilities flips trucks.heavy_duty_capable
 * true (tenant-scoped UPDATE; never clears it). No trucks-module/schema
 * change. See SESSION_36_DECISIONS.md.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  drivers,
  hdDriverCertifications,
  hdJobAttributes,
  hdRateSheets,
  hdTruckCapabilities,
  jobs,
  trucks,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  CreateHdRateSheetPayload,
  FinalizeHdInvoicePayload,
  GenerateHdEstimatePayload,
  HdCertExpiryReportDto,
  HdDriverCertificationDto,
  HdEquipmentUtilizationReportDto,
  HdJobAttributeDto,
  HdJobDetailDto,
  HdJobsByMonthReportDto,
  HdOnSceneEstimateDto,
  HdRateSheetDto,
  HdTruckCapabilityDto,
  MarkJobHdPayload,
  RecordHdDriverCertPayload,
  SetHdTruckCapabilitiesPayload,
  UpdateHdRateSheetPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import {
  type DriverFacts,
  type HdJobRequirements,
  type TruckFacts,
  certStatus,
  eligibleDriversForHdJob,
  eligibleTrucksForHdJob,
} from './heavy-duty-eligibility.logic.js';
import { computeOnSceneEstimate } from './heavy-duty-rates.logic.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

@Injectable()
export class HeavyDutyService {
  constructor(private readonly db: TenantAwareDb) {}

  // ===================================================================
  // Truck capabilities
  // ===================================================================

  async setTruckCapabilities(
    ctx: CallerCtx,
    truckId: string,
    input: SetHdTruckCapabilitiesPayload,
  ): Promise<HdTruckCapabilityDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const truck = await tx.query.trucks.findFirst({
        where: and(eq(trucks.id, truckId), isNull(trucks.deletedAt)),
        columns: { id: true },
      });
      if (!truck) throw notFound('Truck not found in this tenant');

      const existing = await tx.query.hdTruckCapabilities.findFirst({
        where: and(eq(hdTruckCapabilities.truckId, truckId), isNull(hdTruckCapabilities.deletedAt)),
      });

      const fields = {
        gvwrClass: input.gvwrClass ?? null,
        winchCapacityLbs: input.winchCapacityLbs ?? null,
        boomCapacityLbs: input.boomCapacityLbs ?? null,
        hasRotator: input.hasRotator,
        hasUnderLift: input.hasUnderLift,
        hasAirCushions: input.hasAirCushions,
        axleCount: input.axleCount ?? null,
        maxRecoveryWeightLbs: input.maxRecoveryWeightLbs ?? null,
        notes: input.notes ?? null,
      };

      let row: typeof hdTruckCapabilities.$inferSelect | undefined;
      if (existing) {
        [row] = await tx
          .update(hdTruckCapabilities)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(hdTruckCapabilities.id, existing.id))
          .returning();
      } else {
        [row] = await tx
          .insert(hdTruckCapabilities)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            truckId,
            createdBy: ctx.userId,
            ...fields,
          })
          .returning();
      }
      if (!row) throw new Error('setTruckCapabilities: returning() yielded no row');

      // Keep the dispatch hot-path flag honest: a truck with an HD profile is
      // HD-capable. Only ever set true (never clear) so we don't fight a
      // manual fleet edit.
      await tx
        .update(trucks)
        .set({ heavyDutyCapable: true, updatedAt: new Date() })
        .where(and(eq(trucks.id, truckId), eq(trucks.heavyDutyCapable, false)));

      return toCapabilityDto(row);
    });
  }

  async getTruckCapabilities(
    ctx: CallerCtx,
    truckId: string,
  ): Promise<HdTruckCapabilityDto | null> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.hdTruckCapabilities.findFirst({
        where: and(eq(hdTruckCapabilities.truckId, truckId), isNull(hdTruckCapabilities.deletedAt)),
      });
      return row ? toCapabilityDto(row) : null;
    });
  }

  async listTruckCapabilities(ctx: CallerCtx): Promise<HdTruckCapabilityDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.hdTruckCapabilities.findMany({
        where: isNull(hdTruckCapabilities.deletedAt),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      });
      return rows.map(toCapabilityDto);
    });
  }

  // ===================================================================
  // Driver certifications
  // ===================================================================

  async recordDriverCert(
    ctx: CallerCtx,
    driverId: string,
    input: RecordHdDriverCertPayload,
  ): Promise<HdDriverCertificationDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const driver = await tx.query.drivers.findFirst({
        where: and(eq(drivers.id, driverId), isNull(drivers.deletedAt)),
        columns: { id: true },
      });
      if (!driver) throw notFound('Driver not found in this tenant');

      const now = new Date();
      const verifiedAt = input.verified ? now : null;
      const verifiedBy = input.verified ? ctx.userId : null;
      const fields = {
        issuedAt: input.issuedAt ?? null,
        expiresAt: input.expiresAt ?? null,
        docKey: input.docKey ?? null,
        verifiedAt,
        verifiedBy,
        notes: input.notes ?? null,
      };

      // Upsert: one live cert per (driver, cert_type); a renewal supersedes.
      const existing = await tx.query.hdDriverCertifications.findFirst({
        where: and(
          eq(hdDriverCertifications.driverId, driverId),
          eq(hdDriverCertifications.certType, input.certType),
          isNull(hdDriverCertifications.deletedAt),
        ),
      });

      let row: typeof hdDriverCertifications.$inferSelect | undefined;
      if (existing) {
        [row] = await tx
          .update(hdDriverCertifications)
          .set({ ...fields, updatedAt: now })
          .where(eq(hdDriverCertifications.id, existing.id))
          .returning();
      } else {
        [row] = await tx
          .insert(hdDriverCertifications)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            driverId,
            certType: input.certType,
            createdBy: ctx.userId,
            ...fields,
          })
          .returning();
      }
      if (!row) throw new Error('recordDriverCert: returning() yielded no row');
      return toCertDto(row);
    });
  }

  async listDriverCerts(ctx: CallerCtx, driverId: string): Promise<HdDriverCertificationDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.hdDriverCertifications.findMany({
        where: and(
          eq(hdDriverCertifications.driverId, driverId),
          isNull(hdDriverCertifications.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.certType)],
      });
      return rows.map(toCertDto);
    });
  }

  // ===================================================================
  // Job attributes + eligibility
  // ===================================================================

  async markJobHd(
    ctx: CallerCtx,
    jobId: string,
    input: MarkJobHdPayload,
  ): Promise<HdJobAttributeDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
        columns: { id: true },
      });
      if (!job) throw notFound('Job not found in this tenant');

      const fields = {
        vehicleClass: input.vehicleClass ?? null,
        vehicleGvwrLbs: input.vehicleGvwrLbs ?? null,
        vehicleAxleCount: input.vehicleAxleCount ?? null,
        incidentType: input.incidentType ?? null,
        cargoType: input.cargoType ?? null,
        requiresRotator: input.requiresRotator,
        requiresHazmat: input.requiresHazmat,
        requiresDotReport: input.requiresDotReport,
        notes: input.notes ?? null,
      };

      const existing = await tx.query.hdJobAttributes.findFirst({
        where: and(eq(hdJobAttributes.jobId, jobId), isNull(hdJobAttributes.deletedAt)),
      });

      let row: typeof hdJobAttributes.$inferSelect | undefined;
      if (existing) {
        [row] = await tx
          .update(hdJobAttributes)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(hdJobAttributes.id, existing.id))
          .returning();
      } else {
        [row] = await tx
          .insert(hdJobAttributes)
          .values({ id: uuidv7(), tenantId: ctx.tenantId, jobId, createdBy: ctx.userId, ...fields })
          .returning();
      }
      if (!row) throw new Error('markJobHd: returning() yielded no row');
      return toJobAttrDto(row);
    });
  }

  async getJobAttributes(ctx: CallerCtx, jobId: string): Promise<HdJobAttributeDto | null> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.hdJobAttributes.findFirst({
        where: and(eq(hdJobAttributes.jobId, jobId), isNull(hdJobAttributes.deletedAt)),
      });
      return row ? toJobAttrDto(row) : null;
    });
  }

  async getJobDetail(
    ctx: CallerCtx,
    jobId: string,
    now: Date = new Date(),
  ): Promise<HdJobDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const attr = await tx.query.hdJobAttributes.findFirst({
        where: and(eq(hdJobAttributes.jobId, jobId), isNull(hdJobAttributes.deletedAt)),
      });
      if (!attr) throw notFound('Job is not marked heavy-duty');

      const req: HdJobRequirements = {
        vehicleClass: attr.vehicleClass,
        vehicleGvwrLbs: attr.vehicleGvwrLbs,
        requiresRotator: attr.requiresRotator,
        requiresHazmat: attr.requiresHazmat,
      };

      // Candidate trucks: the HD fleet (heavy_duty_capable or with a
      // capability profile). Join trucks → their capability row.
      const truckRows = await tx.query.trucks.findMany({
        where: isNull(trucks.deletedAt),
        columns: { id: true, unitNumber: true, status: true, heavyDutyCapable: true },
      });
      const caps = await tx.query.hdTruckCapabilities.findMany({
        where: isNull(hdTruckCapabilities.deletedAt),
      });
      const capByTruck = new Map(caps.map((c) => [c.truckId, c]));
      const truckFacts: TruckFacts[] = truckRows
        .filter((t) => t.heavyDutyCapable || capByTruck.has(t.id))
        .map((t) => {
          const c = capByTruck.get(t.id);
          return {
            truckId: t.id,
            unitNumber: t.unitNumber,
            status: t.status,
            heavyDutyCapable: t.heavyDutyCapable,
            hasCapabilities: c != null,
            gvwrClass: c?.gvwrClass ?? null,
            hasRotator: c?.hasRotator ?? false,
            maxRecoveryWeightLbs: c?.maxRecoveryWeightLbs ?? null,
          };
        });

      // Candidate drivers: active drivers holding ≥1 HD cert.
      const driverRows = await tx.query.drivers.findMany({
        where: isNull(drivers.deletedAt),
        columns: { id: true, firstName: true, lastName: true, preferredName: true, active: true },
      });
      const certRows = await tx.query.hdDriverCertifications.findMany({
        where: isNull(hdDriverCertifications.deletedAt),
        columns: { driverId: true, certType: true, expiresAt: true },
      });
      const certsByDriver = new Map<
        string,
        { certType: (typeof certRows)[number]['certType']; expiresAt: string | null }[]
      >();
      for (const c of certRows) {
        const list = certsByDriver.get(c.driverId) ?? [];
        list.push({ certType: c.certType, expiresAt: c.expiresAt });
        certsByDriver.set(c.driverId, list);
      }
      const driverFacts: DriverFacts[] = driverRows
        .filter((d) => certsByDriver.has(d.id))
        .map((d) => ({
          driverId: d.id,
          name: `${d.preferredName ?? d.firstName} ${d.lastName}`.trim(),
          active: d.active,
          certs: certsByDriver.get(d.id) ?? [],
        }));

      return {
        attributes: toJobAttrDto(attr),
        eligibleTrucks: eligibleTrucksForHdJob(req, truckFacts),
        eligibleDrivers: eligibleDriversForHdJob(req, driverFacts, todayUtc(now)),
      };
    });
  }

  async generateOnSceneEstimate(
    ctx: CallerCtx,
    jobId: string,
    input: GenerateHdEstimatePayload,
  ): Promise<HdOnSceneEstimateDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const attr = await tx.query.hdJobAttributes.findFirst({
        where: and(eq(hdJobAttributes.jobId, jobId), isNull(hdJobAttributes.deletedAt)),
      });
      if (!attr) throw notFound('Job is not marked heavy-duty');

      const sheet = await tx.query.hdRateSheets.findFirst({
        where: and(eq(hdRateSheets.id, input.rateSheetId), isNull(hdRateSheets.deletedAt)),
      });
      if (!sheet) throw notFound('Rate sheet not found in this tenant');

      const estimate = computeOnSceneEstimate(
        {
          hourlyRateCents: sheet.hourlyRateCents,
          hookupFeeCents: sheet.hookupFeeCents,
          winchingPerHrCents: sheet.winchingPerHrCents,
          recoveryPerHrCents: sheet.recoveryPerHrCents,
          rotatorPerHrCents: sheet.rotatorPerHrCents,
          mileageLoadedCents: sheet.mileageLoadedCents,
          mileageDeadheadCents: sheet.mileageDeadheadCents,
          afterHoursMultiplier: Number(sheet.afterHoursMultiplier),
          holidayMultiplier: Number(sheet.holidayMultiplier),
        },
        {
          laborHours: input.laborHours,
          winchingHours: input.winchingHours,
          recoveryHours: input.recoveryHours,
          rotatorHours: input.rotatorHours,
          loadedMiles: input.loadedMiles,
          deadheadMiles: input.deadheadMiles,
          includeHookup: input.includeHookup,
          afterHours: input.afterHours,
          holiday: input.holiday,
        },
      );

      await tx
        .update(hdJobAttributes)
        .set({ onSceneEstimateCents: estimate.totalCents, updatedAt: new Date() })
        .where(eq(hdJobAttributes.id, attr.id));

      return {
        rateSheetId: sheet.id,
        rateSheetName: sheet.name,
        lines: estimate.lines,
        subtotalCents: estimate.subtotalCents,
        multiplier: estimate.multiplier,
        totalCents: estimate.totalCents,
      };
    });
  }

  async finalizeHdInvoice(
    ctx: CallerCtx,
    jobId: string,
    input: FinalizeHdInvoicePayload,
  ): Promise<HdJobAttributeDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const attr = await tx.query.hdJobAttributes.findFirst({
        where: and(eq(hdJobAttributes.jobId, jobId), isNull(hdJobAttributes.deletedAt)),
      });
      if (!attr) throw notFound('Job is not marked heavy-duty');
      const [row] = await tx
        .update(hdJobAttributes)
        .set({ finalInvoiceCents: input.finalInvoiceCents, updatedAt: new Date() })
        .where(eq(hdJobAttributes.id, attr.id))
        .returning();
      if (!row) throw notFound('Job is not marked heavy-duty');
      return toJobAttrDto(row);
    });
  }

  // ===================================================================
  // Rate sheets
  // ===================================================================

  async listRateSheets(ctx: CallerCtx): Promise<HdRateSheetDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.hdRateSheets.findMany({
        where: isNull(hdRateSheets.deletedAt),
        orderBy: (t, { asc }) => [asc(t.name)],
      });
      return rows.map(toRateSheetDto);
    });
  }

  async getRateSheet(ctx: CallerCtx, id: string): Promise<HdRateSheetDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.hdRateSheets.findFirst({
        where: and(eq(hdRateSheets.id, id), isNull(hdRateSheets.deletedAt)),
      });
      if (!row) throw notFound('Rate sheet not found');
      return toRateSheetDto(row);
    });
  }

  async createRateSheet(ctx: CallerCtx, input: CreateHdRateSheetPayload): Promise<HdRateSheetDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const [row] = await tx
        .insert(hdRateSheets)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          name: input.name,
          hourlyRateCents: input.hourlyRateCents,
          hookupFeeCents: input.hookupFeeCents,
          winchingPerHrCents: input.winchingPerHrCents,
          recoveryPerHrCents: input.recoveryPerHrCents,
          rotatorPerHrCents: input.rotatorPerHrCents,
          mileageLoadedCents: input.mileageLoadedCents,
          mileageDeadheadCents: input.mileageDeadheadCents,
          afterHoursMultiplier: input.afterHoursMultiplier.toFixed(2),
          holidayMultiplier: input.holidayMultiplier.toFixed(2),
          isActive: input.isActive,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('createRateSheet: returning() yielded no row');
      return toRateSheetDto(row);
    });
  }

  async updateRateSheet(
    ctx: CallerCtx,
    id: string,
    input: UpdateHdRateSheetPayload,
  ): Promise<HdRateSheetDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.hdRateSheets.findFirst({
        where: and(eq(hdRateSheets.id, id), isNull(hdRateSheets.deletedAt)),
      });
      if (!existing) throw notFound('Rate sheet not found');
      const patch: Partial<typeof hdRateSheets.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.hourlyRateCents !== undefined) patch.hourlyRateCents = input.hourlyRateCents;
      if (input.hookupFeeCents !== undefined) patch.hookupFeeCents = input.hookupFeeCents;
      if (input.winchingPerHrCents !== undefined)
        patch.winchingPerHrCents = input.winchingPerHrCents;
      if (input.recoveryPerHrCents !== undefined)
        patch.recoveryPerHrCents = input.recoveryPerHrCents;
      if (input.rotatorPerHrCents !== undefined) patch.rotatorPerHrCents = input.rotatorPerHrCents;
      if (input.mileageLoadedCents !== undefined)
        patch.mileageLoadedCents = input.mileageLoadedCents;
      if (input.mileageDeadheadCents !== undefined)
        patch.mileageDeadheadCents = input.mileageDeadheadCents;
      if (input.afterHoursMultiplier !== undefined)
        patch.afterHoursMultiplier = input.afterHoursMultiplier.toFixed(2);
      if (input.holidayMultiplier !== undefined)
        patch.holidayMultiplier = input.holidayMultiplier.toFixed(2);
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      const [row] = await tx
        .update(hdRateSheets)
        .set(patch)
        .where(and(eq(hdRateSheets.id, id), isNull(hdRateSheets.deletedAt)))
        .returning();
      if (!row) throw notFound('Rate sheet not found');
      return toRateSheetDto(row);
    });
  }

  async softDeleteRateSheet(ctx: CallerCtx, id: string): Promise<void> {
    await this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.hdRateSheets.findFirst({
        where: and(eq(hdRateSheets.id, id), isNull(hdRateSheets.deletedAt)),
      });
      if (!existing) throw notFound('Rate sheet not found');
      await tx.update(hdRateSheets).set({ deletedAt: new Date() }).where(eq(hdRateSheets.id, id));
    });
  }

  // ===================================================================
  // Reports
  // ===================================================================

  async hdJobsByMonth(ctx: CallerCtx): Promise<HdJobsByMonthReportDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.hdJobAttributes.findMany({
        where: isNull(hdJobAttributes.deletedAt),
        columns: { createdAt: true, finalInvoiceCents: true },
      });
      const byMonth = new Map<
        string,
        { jobCount: number; revenueCents: number; ticketed: number }
      >();
      for (const r of rows) {
        const month = r.createdAt.toISOString().slice(0, 7);
        const agg = byMonth.get(month) ?? { jobCount: 0, revenueCents: 0, ticketed: 0 };
        agg.jobCount += 1;
        if (r.finalInvoiceCents != null) {
          agg.revenueCents += r.finalInvoiceCents;
          agg.ticketed += 1;
        }
        byMonth.set(month, agg);
      }
      const reportRows = [...byMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, a]) => ({
          month,
          jobCount: a.jobCount,
          revenueCents: a.revenueCents,
          avgTicketCents: a.ticketed > 0 ? Math.round(a.revenueCents / a.ticketed) : 0,
        }));
      return {
        rows: reportRows,
        totalJobs: rows.length,
        totalRevenueCents: reportRows.reduce((acc, r) => acc + r.revenueCents, 0),
      };
    });
  }

  async certExpiryRoster(
    ctx: CallerCtx,
    windowDays = 60,
    now: Date = new Date(),
  ): Promise<HdCertExpiryReportDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const certRows = await tx.query.hdDriverCertifications.findMany({
        where: isNull(hdDriverCertifications.deletedAt),
        columns: { driverId: true, certType: true, expiresAt: true },
      });
      const driverRows = await tx.query.drivers.findMany({
        where: isNull(drivers.deletedAt),
        columns: { id: true, firstName: true, lastName: true, preferredName: true },
      });
      const nameById = new Map(
        driverRows.map((d) => [d.id, `${d.preferredName ?? d.firstName} ${d.lastName}`.trim()]),
      );
      const today = todayUtc(now);
      const rows = certRows
        .map((c) => {
          const { status, daysUntilExpiry } = certStatus(c.expiresAt, today, windowDays);
          return {
            driverId: c.driverId,
            driverName: nameById.get(c.driverId) ?? 'Unknown driver',
            certType: c.certType,
            expiresAt: c.expiresAt,
            daysUntilExpiry,
            status,
          };
        })
        // Roster = certs expiring within the window or already expired.
        .filter((r) => r.status === 'expiring' || r.status === 'expired')
        .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''));
      return {
        windowDays,
        rows,
        expiringCount: rows.filter((r) => r.status === 'expiring').length,
        expiredCount: rows.filter((r) => r.status === 'expired').length,
      };
    });
  }

  async equipmentUtilization(ctx: CallerCtx): Promise<HdEquipmentUtilizationReportDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.hdJobAttributes.findMany({
        where: isNull(hdJobAttributes.deletedAt),
        columns: { requiresRotator: true },
      });
      const totalHdJobs = rows.length;
      const rotatorJobs = rows.filter((r) => r.requiresRotator).length;
      return {
        totalHdJobs,
        rotatorJobs,
        rotatorUtilizationPct:
          totalHdJobs > 0 ? Math.round((rotatorJobs / totalHdJobs) * 1000) / 10 : 0,
      };
    });
  }
}

// ======================================================================
// DTO mappers
// ======================================================================

function toCapabilityDto(row: typeof hdTruckCapabilities.$inferSelect): HdTruckCapabilityDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    truckId: row.truckId,
    gvwrClass: row.gvwrClass,
    winchCapacityLbs: row.winchCapacityLbs,
    boomCapacityLbs: row.boomCapacityLbs,
    hasRotator: row.hasRotator,
    hasUnderLift: row.hasUnderLift,
    hasAirCushions: row.hasAirCushions,
    axleCount: row.axleCount,
    maxRecoveryWeightLbs: row.maxRecoveryWeightLbs,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toCertDto(row: typeof hdDriverCertifications.$inferSelect): HdDriverCertificationDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    driverId: row.driverId,
    certType: row.certType,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    docKey: row.docKey,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    verifiedBy: row.verifiedBy,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toJobAttrDto(row: typeof hdJobAttributes.$inferSelect): HdJobAttributeDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    vehicleClass: row.vehicleClass,
    vehicleGvwrLbs: row.vehicleGvwrLbs,
    vehicleAxleCount: row.vehicleAxleCount,
    incidentType: row.incidentType,
    cargoType: row.cargoType,
    requiresRotator: row.requiresRotator,
    requiresHazmat: row.requiresHazmat,
    requiresDotReport: row.requiresDotReport,
    onSceneEstimateCents: row.onSceneEstimateCents,
    finalInvoiceCents: row.finalInvoiceCents,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toRateSheetDto(row: typeof hdRateSheets.$inferSelect): HdRateSheetDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    hourlyRateCents: row.hourlyRateCents,
    hookupFeeCents: row.hookupFeeCents,
    winchingPerHrCents: row.winchingPerHrCents,
    recoveryPerHrCents: row.recoveryPerHrCents,
    rotatorPerHrCents: row.rotatorPerHrCents,
    mileageLoadedCents: row.mileageLoadedCents,
    mileageDeadheadCents: row.mileageDeadheadCents,
    afterHoursMultiplier: Number(row.afterHoursMultiplier),
    holidayMultiplier: Number(row.holidayMultiplier),
    isActive: row.isActive,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
