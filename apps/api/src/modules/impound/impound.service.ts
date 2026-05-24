/**
 * ImpoundService — Impound & Storage (Session 22).
 *
 * Owns the operator-side orchestration for the impound yard:
 *   - yards     : list / create / update / soft-delete
 *   - records   : list / detail / intake / update / photos / close
 *   - holds     : add / release (police, abandoned, accident, owner-request)
 *   - fees      : add manual line items (daily accrual is the cron's job)
 *   - release   : the documented release workflow + its gate
 *   - forms     : state-form generation stubs (Session 23 renders them)
 *
 * Every method runs inside `runInTenantContext` so RLS isolates tenants;
 * the controller gates each method by Role. All decision logic
 * (accrual math, the release gate, form stubs) lives in the pure helpers
 * in impound-fees.logic.ts / impound-release.logic.ts — this service is
 * data access + transaction boundaries.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  impoundFees,
  impoundHolds,
  impoundRecords,
  impoundReleases,
  impoundYards,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  AddImpoundFeePayload,
  AddImpoundHoldPayload,
  CloseImpoundRecordPayload,
  CreateImpoundRecordPayload,
  CreateImpoundReleasePayload,
  CreateImpoundYardPayload,
  ImpoundFeeDto,
  ImpoundFormKind,
  ImpoundFormStub,
  ImpoundHoldDto,
  ImpoundRecordDetailDto,
  ImpoundRecordDto,
  ImpoundReleaseDto,
  ImpoundYardDto,
  ListImpoundRecordsFilter,
  RegisterImpoundPhotosPayload,
  ReleaseImpoundHoldPayload,
  UpdateImpoundRecordPayload,
  UpdateImpoundYardPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { diffUtcDays, sumFeeCents, toUtcDateString } from './impound-fees.logic.js';
import { buildImpoundFormStub, evaluateReleaseGate } from './impound-release.logic.js';

export interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class ImpoundService {
  constructor(private readonly db: TenantAwareDb) {}

  // ===================================================================
  // Yards
  // ===================================================================

  async listYards(ctx: CallerCtx): Promise<ImpoundYardDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const rows = await tx.query.impoundYards.findMany({
        where: isNull(impoundYards.deletedAt),
        orderBy: (t, { asc }) => [asc(t.name)],
      });
      return rows.map(toYardDto);
    });
  }

  async createYard(ctx: CallerCtx, input: CreateImpoundYardPayload): Promise<ImpoundYardDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const id = uuidv7();
      const [row] = await tx
        .insert(impoundYards)
        .values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          code: input.code,
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          postalCode: input.postalCode ?? null,
          capacity: input.capacity ?? null,
          isActive: input.isActive,
          notes: input.notes ?? null,
        })
        .returning();
      if (!row) throw new Error('createYard: insert returning() yielded no row');
      return toYardDto(row);
    });
  }

  async updateYard(
    ctx: CallerCtx,
    yardId: string,
    input: UpdateImpoundYardPayload,
  ): Promise<ImpoundYardDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.impoundYards.findFirst({
        where: and(eq(impoundYards.id, yardId), isNull(impoundYards.deletedAt)),
      });
      if (!existing) throw notFound('Yard not found');
      const patch: Partial<typeof impoundYards.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.code !== undefined) patch.code = input.code;
      if (input.addressLine1 !== undefined) patch.addressLine1 = input.addressLine1 ?? null;
      if (input.addressLine2 !== undefined) patch.addressLine2 = input.addressLine2 ?? null;
      if (input.city !== undefined) patch.city = input.city ?? null;
      if (input.state !== undefined) patch.state = input.state ?? null;
      if (input.postalCode !== undefined) patch.postalCode = input.postalCode ?? null;
      if (input.capacity !== undefined) patch.capacity = input.capacity ?? null;
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      const [row] = await tx
        .update(impoundYards)
        .set(patch)
        .where(and(eq(impoundYards.id, yardId), isNull(impoundYards.deletedAt)))
        .returning();
      if (!row) throw notFound('Yard not found');
      return toYardDto(row);
    });
  }

  async softDeleteYard(ctx: CallerCtx, yardId: string): Promise<void> {
    await this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.impoundYards.findFirst({
        where: and(eq(impoundYards.id, yardId), isNull(impoundYards.deletedAt)),
      });
      if (!existing) throw notFound('Yard not found');
      // Refuse to delete a yard that still holds live vehicles.
      const live = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.yardId, yardId), isNull(impoundRecords.deletedAt)),
        columns: { id: true, status: true },
      });
      if (live && (live.status === 'stored' || live.status === 'pending_release')) {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: 'Cannot delete a yard that still holds active vehicles.',
        });
      }
      await tx
        .update(impoundYards)
        .set({ deletedAt: new Date() })
        .where(eq(impoundYards.id, yardId));
    });
  }

  // ===================================================================
  // Records
  // ===================================================================

  async listRecords(ctx: CallerCtx, filter: ListImpoundRecordsFilter): Promise<ImpoundRecordDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [isNull(impoundRecords.deletedAt)];
      if (filter.status) clauses.push(eq(impoundRecords.status, filter.status));
      if (filter.yardId) clauses.push(eq(impoundRecords.yardId, filter.yardId));
      if (filter.lienEligible !== undefined) {
        clauses.push(eq(impoundRecords.lienEligible, filter.lienEligible === 'true'));
      }
      const rows = await tx.query.impoundRecords.findMany({
        where: and(...clauses),
        orderBy: (t, { desc }) => [desc(t.arrivedAt)],
      });
      return rows.map(toRecordDto);
    });
  }

  async getRecordDetail(ctx: CallerCtx, recordId: string): Promise<ImpoundRecordDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const record = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)),
      });
      if (!record) throw notFound('Impound record not found');
      const yard = await tx.query.impoundYards.findFirst({
        where: eq(impoundYards.id, record.yardId),
      });
      if (!yard) throw notFound('Yard not found');
      const holds = await tx.query.impoundHolds.findMany({
        where: and(eq(impoundHolds.impoundRecordId, recordId), isNull(impoundHolds.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.placedAt)],
      });
      const fees = await tx.query.impoundFees.findMany({
        where: and(eq(impoundFees.impoundRecordId, recordId), isNull(impoundFees.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      });
      const release = await tx.query.impoundReleases.findFirst({
        where: and(
          eq(impoundReleases.impoundRecordId, recordId),
          isNull(impoundReleases.deletedAt),
        ),
      });
      const activeHoldCount = holds.filter((h) => h.releasedAt === null).length;
      return {
        record: toRecordDto(record),
        yard: toYardDto(yard),
        holds: holds.map(toHoldDto),
        fees: fees.map(toFeeDto),
        release: release ? toReleaseDto(release) : null,
        feeTotalCents: sumFeeCents(fees),
        activeHoldCount,
      };
    });
  }

  async intakeRecord(ctx: CallerCtx, input: CreateImpoundRecordPayload): Promise<ImpoundRecordDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      // Yard must exist + be live in this tenant. RLS already blocks
      // cross-tenant yards; a clean 404 beats a constraint failure.
      const yard = await tx.query.impoundYards.findFirst({
        where: and(eq(impoundYards.id, input.yardId), isNull(impoundYards.deletedAt)),
      });
      if (!yard) throw notFound('Yard not found in this tenant');
      const arrivedAt = input.arrivedAt ? new Date(input.arrivedAt) : new Date();
      const storageStartedAt = input.storageStartedAt
        ? new Date(input.storageStartedAt)
        : arrivedAt;
      const id = uuidv7();
      const [row] = await tx
        .insert(impoundRecords)
        .values({
          id,
          tenantId: ctx.tenantId,
          yardId: input.yardId,
          jobId: input.jobId ?? null,
          vehicleId: input.vehicleId ?? null,
          vehicleMake: input.vehicleMake ?? null,
          vehicleModel: input.vehicleModel ?? null,
          vehicleYear: input.vehicleYear ?? null,
          vehicleColor: input.vehicleColor ?? null,
          vehicleVin: input.vehicleVin ?? null,
          licensePlate: input.licensePlate ?? null,
          licenseState: input.licenseState ?? null,
          status: 'stored',
          arrivedAt,
          storageStartedAt,
          dailyFeeCents: input.dailyFeeCents,
          intakeMileage: input.intakeMileage ?? null,
          intakePhotoKeys: input.intakePhotoKeys,
          conditionNotes: input.conditionNotes ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('intakeRecord: insert returning() yielded no row');
      return toRecordDto(row);
    });
  }

  async updateRecord(
    ctx: CallerCtx,
    recordId: string,
    input: UpdateImpoundRecordPayload,
  ): Promise<ImpoundRecordDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)),
      });
      if (!existing) throw notFound('Impound record not found');
      if (existing.status !== 'stored' && existing.status !== 'pending_release') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: `Cannot edit a record in '${existing.status}' state.`,
        });
      }
      if (input.yardId !== undefined && input.yardId !== existing.yardId) {
        const yard = await tx.query.impoundYards.findFirst({
          where: and(eq(impoundYards.id, input.yardId), isNull(impoundYards.deletedAt)),
        });
        if (!yard) throw notFound('Target yard not found');
      }
      const patch: Partial<typeof impoundRecords.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.yardId !== undefined) patch.yardId = input.yardId;
      if (input.vehicleMake !== undefined) patch.vehicleMake = input.vehicleMake ?? null;
      if (input.vehicleModel !== undefined) patch.vehicleModel = input.vehicleModel ?? null;
      if (input.vehicleYear !== undefined) patch.vehicleYear = input.vehicleYear ?? null;
      if (input.vehicleColor !== undefined) patch.vehicleColor = input.vehicleColor ?? null;
      if (input.vehicleVin !== undefined) patch.vehicleVin = input.vehicleVin ?? null;
      if (input.licensePlate !== undefined) patch.licensePlate = input.licensePlate ?? null;
      if (input.licenseState !== undefined) patch.licenseState = input.licenseState ?? null;
      if (input.dailyFeeCents !== undefined) patch.dailyFeeCents = input.dailyFeeCents;
      if (input.intakeMileage !== undefined) patch.intakeMileage = input.intakeMileage ?? null;
      if (input.conditionNotes !== undefined) patch.conditionNotes = input.conditionNotes ?? null;
      const [row] = await tx
        .update(impoundRecords)
        .set(patch)
        .where(and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)))
        .returning();
      if (!row) throw notFound('Impound record not found');
      return toRecordDto(row);
    });
  }

  async registerPhotos(
    ctx: CallerCtx,
    recordId: string,
    input: RegisterImpoundPhotosPayload,
  ): Promise<ImpoundRecordDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)),
      });
      if (!existing) throw notFound('Impound record not found');
      // Append, de-duplicating, and cap at 50 to match the column intent.
      const merged = Array.from(new Set([...existing.intakePhotoKeys, ...input.keys])).slice(0, 50);
      const [row] = await tx
        .update(impoundRecords)
        .set({ intakePhotoKeys: merged, updatedAt: new Date() })
        .where(eq(impoundRecords.id, recordId))
        .returning();
      if (!row) throw notFound('Impound record not found');
      return toRecordDto(row);
    });
  }

  async closeRecord(
    ctx: CallerCtx,
    recordId: string,
    input: CloseImpoundRecordPayload,
  ): Promise<ImpoundRecordDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)),
      });
      if (!existing) throw notFound('Impound record not found');
      if (existing.status !== 'stored' && existing.status !== 'pending_release') {
        throw new ConflictException({
          code: 'INVALID_STATE',
          message: `Record is '${existing.status}' and cannot be ${input.disposition}.`,
        });
      }
      const now = new Date();
      const note = input.notes
        ? `${existing.conditionNotes ? `${existing.conditionNotes}\n` : ''}[${input.disposition}] ${input.notes}`
        : existing.conditionNotes;
      const [row] = await tx
        .update(impoundRecords)
        .set({
          status: input.disposition,
          releasedAt: now,
          conditionNotes: note,
          updatedAt: now,
        })
        .where(eq(impoundRecords.id, recordId))
        .returning();
      if (!row) throw notFound('Impound record not found');
      return toRecordDto(row);
    });
  }

  // ===================================================================
  // Holds
  // ===================================================================

  async addHold(
    ctx: CallerCtx,
    recordId: string,
    input: AddImpoundHoldPayload,
  ): Promise<ImpoundHoldDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const record = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)),
      });
      if (!record) throw notFound('Impound record not found');
      const id = uuidv7();
      const [row] = await tx
        .insert(impoundHolds)
        .values({
          id,
          tenantId: ctx.tenantId,
          impoundRecordId: recordId,
          holdType: input.holdType,
          authorityName: input.authorityName ?? null,
          authorityReference: input.authorityReference ?? null,
          reason: input.reason ?? null,
          placedBy: ctx.userId,
          notes: input.notes ?? null,
        })
        .returning();
      if (!row) throw new Error('addHold: insert returning() yielded no row');
      return toHoldDto(row);
    });
  }

  async releaseHold(
    ctx: CallerCtx,
    recordId: string,
    holdId: string,
    input: ReleaseImpoundHoldPayload,
  ): Promise<ImpoundHoldDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const hold = await tx.query.impoundHolds.findFirst({
        where: and(eq(impoundHolds.id, holdId), isNull(impoundHolds.deletedAt)),
      });
      if (!hold || hold.impoundRecordId !== recordId) throw notFound('Hold not found');
      if (hold.releasedAt !== null) {
        // Idempotent: re-releasing a released hold is a no-op success.
        return toHoldDto(hold);
      }
      const now = new Date();
      const mergedNotes = input.notes
        ? `${hold.notes ? `${hold.notes}\n` : ''}[released] ${input.notes}`
        : hold.notes;
      const [row] = await tx
        .update(impoundHolds)
        .set({ releasedAt: now, releasedBy: ctx.userId, notes: mergedNotes, updatedAt: now })
        .where(eq(impoundHolds.id, holdId))
        .returning();
      if (!row) throw notFound('Hold not found');
      return toHoldDto(row);
    });
  }

  // ===================================================================
  // Fees
  // ===================================================================

  async addFee(
    ctx: CallerCtx,
    recordId: string,
    input: AddImpoundFeePayload,
  ): Promise<ImpoundFeeDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const record = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)),
      });
      if (!record) throw notFound('Impound record not found');
      const id = uuidv7();
      const [row] = await tx
        .insert(impoundFees)
        .values({
          id,
          tenantId: ctx.tenantId,
          impoundRecordId: recordId,
          feeType: input.feeType,
          description: input.description ?? null,
          amountCents: input.amountCents,
          accruedForDate: null,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('addFee: insert returning() yielded no row');
      return toFeeDto(row);
    });
  }

  // ===================================================================
  // Release workflow
  // ===================================================================

  async releaseRecord(
    ctx: CallerCtx,
    recordId: string,
    input: CreateImpoundReleasePayload,
  ): Promise<{ record: ImpoundRecordDto; release: ImpoundReleaseDto }> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const record = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)),
      });
      if (!record) throw notFound('Impound record not found');

      const holds = await tx.query.impoundHolds.findMany({
        where: and(eq(impoundHolds.impoundRecordId, recordId), isNull(impoundHolds.deletedAt)),
        columns: { releasedAt: true },
      });
      const activeHoldCount = holds.filter((h) => h.releasedAt === null).length;

      const gate = evaluateReleaseGate({
        recordStatus: record.status,
        activeHoldCount,
        idVerified: input.idVerified,
        ownershipDocVerified: input.ownershipDocVerified,
      });
      if (!gate.ok) {
        throw new ConflictException({
          code: 'RELEASE_BLOCKED',
          message: gate.reasons.join(' '),
          reasons: gate.reasons,
        });
      }

      const fees = await tx.query.impoundFees.findMany({
        where: and(eq(impoundFees.impoundRecordId, recordId), isNull(impoundFees.deletedAt)),
        columns: { amountCents: true, deletedAt: true },
      });
      const totalFeesCents = sumFeeCents(fees);

      const now = new Date();
      const releaseId = uuidv7();
      const [releaseRow] = await tx
        .insert(impoundReleases)
        .values({
          id: releaseId,
          tenantId: ctx.tenantId,
          impoundRecordId: recordId,
          releasedToName: input.releasedToName,
          releasedToType: input.releasedToType,
          idVerified: input.idVerified,
          ownershipDocVerified: input.ownershipDocVerified,
          authorizationDocRef: input.authorizationDocRef ?? null,
          paymentReceivedCents: input.paymentReceivedCents,
          paymentMethod: input.paymentMethod ?? null,
          totalFeesCents,
          releasedBy: ctx.userId,
          releasedAt: now,
          notes: input.notes ?? null,
        })
        .returning();
      if (!releaseRow) throw new Error('releaseRecord: release insert yielded no row');

      const [recordRow] = await tx
        .update(impoundRecords)
        .set({ status: 'released', releasedAt: now, updatedAt: now })
        .where(eq(impoundRecords.id, recordId))
        .returning();
      if (!recordRow) throw notFound('Impound record not found');

      return { record: toRecordDto(recordRow), release: toReleaseDto(releaseRow) };
    });
  }

  // ===================================================================
  // State-form generation stubs (Session 23 renders the documents)
  // ===================================================================

  async generateFormStub(
    ctx: CallerCtx,
    recordId: string,
    kind: ImpoundFormKind,
  ): Promise<ImpoundFormStub> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const record = await tx.query.impoundRecords.findFirst({
        where: and(eq(impoundRecords.id, recordId), isNull(impoundRecords.deletedAt)),
      });
      if (!record) throw notFound('Impound record not found');
      const yard = await tx.query.impoundYards.findFirst({
        where: eq(impoundYards.id, record.yardId),
      });
      const fees = await tx.query.impoundFees.findMany({
        where: and(eq(impoundFees.impoundRecordId, recordId), isNull(impoundFees.deletedAt)),
        columns: { amountCents: true, deletedAt: true },
      });
      const now = new Date();
      const daysStored = Math.max(
        0,
        diffUtcDays(toUtcDateString(record.storageStartedAt), toUtcDateString(now)),
      );
      const vehicleDescription =
        [record.vehicleYear, record.vehicleColor, record.vehicleMake, record.vehicleModel]
          .filter((p) => p !== null && p !== undefined && `${p}`.length > 0)
          .join(' ') || 'Unidentified vehicle';
      return buildImpoundFormStub(
        kind,
        {
          recordId,
          yardName: yard?.name ?? 'Unknown yard',
          vehicleDescription,
          licensePlate: record.licensePlate,
          vehicleVin: record.vehicleVin,
          arrivedAt: record.arrivedAt.toISOString(),
          daysStored,
          feeTotalCents: sumFeeCents(fees),
          lienEligible: record.lienEligible,
        },
        now,
      );
    });
  }
}

// ======================================================================
// Helpers
// ======================================================================

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

function toYardDto(row: typeof impoundYards.$inferSelect): ImpoundYardDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    capacity: row.capacity,
    isActive: row.isActive,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toRecordDto(row: typeof impoundRecords.$inferSelect): ImpoundRecordDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    yardId: row.yardId,
    jobId: row.jobId,
    vehicleId: row.vehicleId,
    vehicleMake: row.vehicleMake,
    vehicleModel: row.vehicleModel,
    vehicleYear: row.vehicleYear,
    vehicleColor: row.vehicleColor,
    vehicleVin: row.vehicleVin,
    licensePlate: row.licensePlate,
    licenseState: row.licenseState,
    status: row.status,
    arrivedAt: row.arrivedAt.toISOString(),
    storageStartedAt: row.storageStartedAt.toISOString(),
    releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    dailyFeeCents: row.dailyFeeCents,
    intakeMileage: row.intakeMileage,
    intakePhotoKeys: row.intakePhotoKeys,
    conditionNotes: row.conditionNotes,
    lienEligible: row.lienEligible,
    lienEligibleAt: row.lienEligibleAt ? row.lienEligibleAt.toISOString() : null,
    accruedFeeCents: row.accruedFeeCents,
    lastAccruedOn: row.lastAccruedOn,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toHoldDto(row: typeof impoundHolds.$inferSelect): ImpoundHoldDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    impoundRecordId: row.impoundRecordId,
    holdType: row.holdType,
    authorityName: row.authorityName,
    authorityReference: row.authorityReference,
    reason: row.reason,
    placedBy: row.placedBy,
    placedAt: row.placedAt.toISOString(),
    releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    releasedBy: row.releasedBy,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toFeeDto(row: typeof impoundFees.$inferSelect): ImpoundFeeDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    impoundRecordId: row.impoundRecordId,
    feeType: row.feeType,
    description: row.description,
    amountCents: row.amountCents,
    accruedForDate: row.accruedForDate,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toReleaseDto(row: typeof impoundReleases.$inferSelect): ImpoundReleaseDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    impoundRecordId: row.impoundRecordId,
    releasedToName: row.releasedToName,
    releasedToType: row.releasedToType,
    idVerified: row.idVerified,
    ownershipDocVerified: row.ownershipDocVerified,
    authorizationDocRef: row.authorizationDocRef,
    paymentReceivedCents: row.paymentReceivedCents,
    paymentMethod: row.paymentMethod,
    totalFeesCents: row.totalFeesCents,
    releasedBy: row.releasedBy,
    releasedAt: row.releasedAt.toISOString(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
