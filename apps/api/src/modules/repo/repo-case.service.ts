/**
 * RepoCaseService — repossession case lifecycle (Repo Workflow Session 49).
 *
 * Owns the operator + driver orchestration for a repo case: intake, the field
 * attempt log, recovery (with the post-recovery redemption window), condition
 * photos, personal-property inventory + release, and the terminal close /
 * cancel transitions. Status-machine decisions live in the pure
 * repo-redemption.logic helpers; billing math in repo-billing.logic. This
 * service is data access + transaction boundaries (inline, S22 pattern).
 *
 * Distinct legal posture from impound/lien: no debtor signature, no debtor
 * notification — recovery is peaceful and the lienholder is the client.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type RepoCase,
  type RepoConditionPhoto,
  type RepoLocationAttempt,
  type RepoPersonalProperty,
  type RepoRecoveryEvent,
  lienholders,
  repoCases,
  repoConditionPhotos,
  repoLocationAttempts,
  repoPersonalProperty,
  repoRecoveryEvents,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type AddRepoConditionPhotosPayload,
  type AddRepoPersonalPropertyPayload,
  type CloseRepoCasePayload,
  type CreateRepoCasePayload,
  ERROR_CODES,
  type GenerateRepoInvoicePayload,
  type LienholderDto,
  type ListRepoCasesFilter,
  type MarkRepoCaseLocatedPayload,
  type RecordRepoAttemptPayload,
  type RecordRepoRecoveryPayload,
  type ReleaseRepoPersonalPropertyPayload,
  type RepoCaseDetailDto,
  type RepoCaseDto,
  type RepoConditionPhotoDto,
  type RepoInvoicePreviewDto,
  type RepoLocationAttemptDto,
  type RepoPersonalPropertyDto,
  type RepoRecoveryEventDto,
  type UpdateRepoCasePayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { computeRepoBillingLines, sumRepoBillingCents } from './repo-billing.logic.js';
import { toLienholderDto } from './repo-lienholder.service.js';
import { canTransition, computeRedemptionEnd, isAttemptable } from './repo-redemption.logic.js';

export interface RepoCallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class RepoCaseService {
  constructor(private readonly db: TenantAwareDb) {}

  // ===================================================================
  // Cases
  // ===================================================================

  async createCase(ctx: RepoCallerCtx, input: CreateRepoCasePayload): Promise<RepoCaseDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      // Lienholder must exist + be live in this tenant. RLS already blocks
      // cross-tenant rows; a clean 404 beats a constraint failure.
      const lh = await tx.query.lienholders.findFirst({
        where: and(eq(lienholders.id, input.lienholderId), isNull(lienholders.deletedAt)),
        columns: { id: true },
      });
      if (!lh) throw notFound('Lienholder not found in this tenant');

      const id = uuidv7();
      try {
        const [row] = await tx
          .insert(repoCases)
          .values({
            id,
            tenantId: ctx.tenantId,
            lienholderId: input.lienholderId,
            caseNumber: input.caseNumber,
            vin: input.vin ?? null,
            vehicleYear: input.vehicleYear ?? null,
            vehicleMake: input.vehicleMake ?? null,
            vehicleModel: input.vehicleModel ?? null,
            vehicleColor: input.vehicleColor ?? null,
            plate: input.plate ?? null,
            debtorName: input.debtorName ?? null,
            debtorAddress: input.debtorAddress ?? null,
            debtorPhone: input.debtorPhone ?? null,
            debtorSecondaryAddress: input.debtorSecondaryAddress ?? null,
            status: 'open',
            redemptionWindowDays: input.redemptionWindowDays ?? null,
            refAssignmentId: input.refAssignmentId ?? null,
            notes: input.notes ?? null,
            createdBy: ctx.userId,
          })
          .returning();
        if (!row) throw new Error('createCase: insert returning() yielded no row');
        return toCaseDto(row);
      } catch (err) {
        // Partial unique (tenant, lienholder, case_number) WHERE not cancelled.
        if (isUniqueViolation(err)) {
          throw new ConflictException({
            code: ERROR_CODES.REPO_CASE_DUPLICATE_NUMBER,
            message: `An active case already exists for this lienholder with case number "${input.caseNumber}".`,
          });
        }
        throw err;
      }
    });
  }

  async listCases(ctx: RepoCallerCtx, filter: ListRepoCasesFilter): Promise<RepoCaseDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const clauses = [isNull(repoCases.deletedAt)];
      if (filter.lienholderId) clauses.push(eq(repoCases.lienholderId, filter.lienholderId));
      if (filter.status) clauses.push(eq(repoCases.status, filter.status));
      if (filter.minDaysOpen !== undefined) {
        const cutoff = new Date(Date.now() - filter.minDaysOpen * 86_400_000);
        clauses.push(lte(repoCases.assignedAt, cutoff));
      }
      const rows = await tx.query.repoCases.findMany({
        where: and(...clauses),
        orderBy: (t, { desc: d }) => [d(t.assignedAt)],
        limit: filter.limit ?? 100,
        offset: filter.offset ?? 0,
      });
      return rows.map(toCaseDto);
    });
  }

  async getCaseDetail(ctx: RepoCallerCtx, caseId: string): Promise<RepoCaseDetailDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const row = await tx.query.repoCases.findFirst({
        where: and(eq(repoCases.id, caseId), isNull(repoCases.deletedAt)),
      });
      if (!row) throw notFound('Repo case not found');
      const lh = await tx.query.lienholders.findFirst({
        where: eq(lienholders.id, row.lienholderId),
      });
      if (!lh) throw notFound('Lienholder not found');
      const attempts = await tx.query.repoLocationAttempts.findMany({
        where: and(
          eq(repoLocationAttempts.repoCaseId, caseId),
          isNull(repoLocationAttempts.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.attemptedAt)],
      });
      const recoveryEvents = await tx.query.repoRecoveryEvents.findMany({
        where: and(eq(repoRecoveryEvents.repoCaseId, caseId), isNull(repoRecoveryEvents.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.recoveredAt)],
      });
      const personalProperty = await tx.query.repoPersonalProperty.findMany({
        where: and(
          eq(repoPersonalProperty.repoCaseId, caseId),
          isNull(repoPersonalProperty.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.recordedAt)],
      });
      const conditionPhotos = await tx.query.repoConditionPhotos.findMany({
        where: and(
          eq(repoConditionPhotos.repoCaseId, caseId),
          isNull(repoConditionPhotos.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.takenAt)],
      });
      return {
        case: toCaseDto(row),
        lienholder: toLienholderDto(lh) as LienholderDto,
        attempts: attempts.map(toAttemptDto),
        recoveryEvents: recoveryEvents.map(toRecoveryDto),
        personalProperty: personalProperty.map(toPropertyDto),
        conditionPhotos: conditionPhotos.map(toPhotoDto),
        attemptCount: attempts.length,
      };
    });
  }

  async updateCase(
    ctx: RepoCallerCtx,
    caseId: string,
    input: UpdateRepoCasePayload,
  ): Promise<RepoCaseDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireOpenish(tx, caseId, 'edit');
      const patch: Partial<typeof repoCases.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.vin !== undefined) patch.vin = input.vin ?? null;
      if (input.vehicleYear !== undefined) patch.vehicleYear = input.vehicleYear ?? null;
      if (input.vehicleMake !== undefined) patch.vehicleMake = input.vehicleMake ?? null;
      if (input.vehicleModel !== undefined) patch.vehicleModel = input.vehicleModel ?? null;
      if (input.vehicleColor !== undefined) patch.vehicleColor = input.vehicleColor ?? null;
      if (input.plate !== undefined) patch.plate = input.plate ?? null;
      if (input.debtorName !== undefined) patch.debtorName = input.debtorName ?? null;
      if (input.debtorAddress !== undefined) patch.debtorAddress = input.debtorAddress ?? null;
      if (input.debtorPhone !== undefined) patch.debtorPhone = input.debtorPhone ?? null;
      if (input.debtorSecondaryAddress !== undefined) {
        patch.debtorSecondaryAddress = input.debtorSecondaryAddress ?? null;
      }
      if (input.redemptionWindowDays !== undefined) {
        patch.redemptionWindowDays = input.redemptionWindowDays ?? null;
      }
      if (input.refAssignmentId !== undefined)
        patch.refAssignmentId = input.refAssignmentId ?? null;
      if (input.notes !== undefined) patch.notes = input.notes ?? null;
      const [row] = await tx
        .update(repoCases)
        .set(patch)
        .where(eq(repoCases.id, existing.id))
        .returning();
      if (!row) throw notFound('Repo case not found');
      return toCaseDto(row);
    });
  }

  async markLocated(
    ctx: RepoCallerCtx,
    caseId: string,
    input: MarkRepoCaseLocatedPayload,
  ): Promise<RepoCaseDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireCase(tx, caseId);
      if (!canTransition(existing.status, 'located')) {
        throw invalidState(`Cannot mark a '${existing.status}' case located.`);
      }
      const now = new Date();
      const [row] = await tx
        .update(repoCases)
        .set({
          status: 'located',
          locatedAt: existing.locatedAt ?? now,
          notes: mergeNote(existing.notes, input.notes, 'located'),
          updatedAt: now,
        })
        .where(eq(repoCases.id, caseId))
        .returning();
      if (!row) throw notFound('Repo case not found');
      return toCaseDto(row);
    });
  }

  // ===================================================================
  // Attempts
  // ===================================================================

  async recordAttempt(
    ctx: RepoCallerCtx,
    caseId: string,
    input: RecordRepoAttemptPayload,
  ): Promise<RepoLocationAttemptDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireCase(tx, caseId);
      if (!isAttemptable(existing.status)) {
        throw invalidState(`Cannot record an attempt on a '${existing.status}' case.`);
      }
      const id = uuidv7();
      const [row] = await tx
        .insert(repoLocationAttempts)
        .values({
          id,
          tenantId: ctx.tenantId,
          repoCaseId: caseId,
          attemptedAt: input.attemptedAt ? new Date(input.attemptedAt) : new Date(),
          attemptedByUserId: ctx.userId,
          address: input.address ?? null,
          outcome: input.outcome,
          notes: input.notes ?? null,
          gpsLat: input.gpsLat ?? null,
          gpsLng: input.gpsLng ?? null,
        })
        .returning();
      if (!row) throw new Error('recordAttempt: insert returning() yielded no row');
      // A confirmed sighting advances an open case to 'located' (idempotent).
      if (existing.status === 'open' && input.outcome === 'spotted_no_attempt') {
        await tx
          .update(repoCases)
          .set({ status: 'located', locatedAt: new Date(), updatedAt: new Date() })
          .where(eq(repoCases.id, caseId));
      }
      return toAttemptDto(row);
    });
  }

  // ===================================================================
  // Recovery
  // ===================================================================

  async recordRecovery(
    ctx: RepoCallerCtx,
    caseId: string,
    input: RecordRepoRecoveryPayload,
  ): Promise<{ case: RepoCaseDto; recovery: RepoRecoveryEventDto }> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireCase(tx, caseId);
      const targetStatus =
        input.recoveryType === 'voluntary_surrender' ? 'surrendered' : 'recovered';
      if (!canTransition(existing.status, targetStatus)) {
        throw invalidState(`Cannot record a recovery on a '${existing.status}' case.`);
      }
      const recoveredAt = input.recoveredAt ? new Date(input.recoveredAt) : new Date();
      const id = uuidv7();
      const [recoveryRow] = await tx
        .insert(repoRecoveryEvents)
        .values({
          id,
          tenantId: ctx.tenantId,
          repoCaseId: caseId,
          recoveredAt,
          recoveredByUserId: ctx.userId,
          recoveryType: input.recoveryType,
          odometer: input.odometer ?? null,
          conditionNotes: input.conditionNotes ?? null,
          gpsLat: input.gpsLat ?? null,
          gpsLng: input.gpsLng ?? null,
        })
        .returning();
      if (!recoveryRow) throw new Error('recordRecovery: insert returning() yielded no row');

      const redemptionEndsAt =
        existing.redemptionWindowDays != null
          ? computeRedemptionEnd(recoveredAt, existing.redemptionWindowDays)
          : null;

      const [caseRow] = await tx
        .update(repoCases)
        .set({
          status: targetStatus,
          recoveredAt,
          redemptionEndsAt,
          updatedAt: new Date(),
        })
        .where(eq(repoCases.id, caseId))
        .returning();
      if (!caseRow) throw notFound('Repo case not found');
      return { case: toCaseDto(caseRow), recovery: toRecoveryDto(recoveryRow) };
    });
  }

  // ===================================================================
  // Condition photos
  // ===================================================================

  async addConditionPhotos(
    ctx: RepoCallerCtx,
    caseId: string,
    input: AddRepoConditionPhotosPayload,
  ): Promise<RepoConditionPhotoDto[]> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireCase(tx, caseId);
      const rows = await tx
        .insert(repoConditionPhotos)
        .values(
          input.photos.map((p) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            repoCaseId: caseId,
            photoUrl: p.photoUrl,
            photoType: p.photoType,
            takenAt: p.takenAt ? new Date(p.takenAt) : new Date(),
            gpsLat: p.gpsLat ?? null,
            gpsLng: p.gpsLng ?? null,
          })),
        )
        .returning();
      return rows.map(toPhotoDto);
    });
  }

  // ===================================================================
  // Personal property
  // ===================================================================

  async addPersonalProperty(
    ctx: RepoCallerCtx,
    caseId: string,
    input: AddRepoPersonalPropertyPayload,
  ): Promise<RepoPersonalPropertyDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireCase(tx, caseId);
      const id = uuidv7();
      const [row] = await tx
        .insert(repoPersonalProperty)
        .values({
          id,
          tenantId: ctx.tenantId,
          repoCaseId: caseId,
          itemDescription: input.itemDescription,
          photoUrl: input.photoUrl ?? null,
        })
        .returning();
      if (!row) throw new Error('addPersonalProperty: insert returning() yielded no row');
      return toPropertyDto(row);
    });
  }

  async releasePersonalProperty(
    ctx: RepoCallerCtx,
    caseId: string,
    propertyId: string,
    input: ReleaseRepoPersonalPropertyPayload,
  ): Promise<RepoPersonalPropertyDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const item = await tx.query.repoPersonalProperty.findFirst({
        where: and(eq(repoPersonalProperty.id, propertyId), isNull(repoPersonalProperty.deletedAt)),
      });
      if (!item || item.repoCaseId !== caseId) throw notFound('Personal-property item not found');
      if (item.releasedAt !== null) return toPropertyDto(item); // idempotent
      const now = new Date();
      const [row] = await tx
        .update(repoPersonalProperty)
        .set({ releasedAt: now, releasedTo: input.releasedTo, updatedAt: now })
        .where(eq(repoPersonalProperty.id, propertyId))
        .returning();
      if (!row) throw notFound('Personal-property item not found');
      return toPropertyDto(row);
    });
  }

  // ===================================================================
  // Terminal transitions: release to lienholder / cancel
  // ===================================================================

  /** Close the case (disposition 'closed' = released to lienholder, or
   *  'cancelled' = lienholder pulled the assignment). */
  async closeCase(
    ctx: RepoCallerCtx,
    caseId: string,
    input: CloseRepoCasePayload,
  ): Promise<RepoCaseDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      const existing = await this.requireCase(tx, caseId);
      const target = input.disposition === 'cancelled' ? 'cancelled' : 'closed';
      if (!canTransition(existing.status, target)) {
        throw invalidState(
          `Cannot ${input.disposition === 'cancelled' ? 'cancel' : 'close'} a '${existing.status}' case.`,
        );
      }
      const now = new Date();
      const [row] = await tx
        .update(repoCases)
        .set({
          status: target,
          closedAt: now,
          notes: mergeNote(existing.notes, input.reason, input.disposition),
          updatedAt: now,
        })
        .where(eq(repoCases.id, caseId))
        .returning();
      if (!row) throw notFound('Repo case not found');
      return toCaseDto(row);
    });
  }

  /** Convenience alias: recovered/surrendered → closed (vehicle handed to the
   *  lienholder). Equivalent to closeCase with disposition 'closed'. */
  async releaseToLienholder(
    ctx: RepoCallerCtx,
    caseId: string,
    reason?: string,
  ): Promise<RepoCaseDto> {
    return this.closeCase(ctx, caseId, { disposition: 'closed', ...(reason ? { reason } : {}) });
  }

  /** Convenience alias: open/located → cancelled. */
  async cancelCase(ctx: RepoCallerCtx, caseId: string, reason?: string): Promise<RepoCaseDto> {
    return this.closeCase(ctx, caseId, { disposition: 'cancelled', ...(reason ? { reason } : {}) });
  }

  // ===================================================================
  // Billing preview (lines feed the existing invoices computeTotals path)
  // ===================================================================

  async previewInvoice(
    ctx: RepoCallerCtx,
    caseId: string,
    input: GenerateRepoInvoicePayload,
  ): Promise<RepoInvoicePreviewDto> {
    return this.db.runInTenantContext(ctx, async (tx) => {
      await this.requireCase(tx, caseId);
      const lines = computeRepoBillingLines(input);
      return {
        lines: lines.map((l) => ({
          lineType: l.lineType,
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          lineTotalCents: l.lineTotalCents,
        })),
        subtotalCents: sumRepoBillingCents(lines),
      };
    });
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  // biome-ignore lint/suspicious/noExplicitAny: tx is the drizzle tx handle
  private async requireCase(tx: any, caseId: string): Promise<RepoCase> {
    const row = await tx.query.repoCases.findFirst({
      where: and(eq(repoCases.id, caseId), isNull(repoCases.deletedAt)),
    });
    if (!row) throw notFound('Repo case not found');
    return row as RepoCase;
  }

  // biome-ignore lint/suspicious/noExplicitAny: tx is the drizzle tx handle
  private async requireOpenish(tx: any, caseId: string, verb: string): Promise<RepoCase> {
    const row = await this.requireCase(tx, caseId);
    if (row.status === 'closed' || row.status === 'cancelled') {
      throw invalidState(`Cannot ${verb} a '${row.status}' case.`);
    }
    return row;
  }
}

// ======================================================================
// Errors + DTO mappers
// ======================================================================

function notFound(message: string): NotFoundException {
  return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message });
}

function invalidState(message: string): ConflictException {
  return new ConflictException({ code: ERROR_CODES.REPO_CASE_INVALID_STATE, message });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

// Append a timestamped note prefix, preserving prior notes.
function mergeNote(
  existing: string | null,
  addition: string | undefined,
  tag: string,
): string | null {
  if (!addition) return existing;
  return `${existing ? `${existing}\n` : ''}[${tag}] ${addition}`;
}

function toCaseDto(row: RepoCase): RepoCaseDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    lienholderId: row.lienholderId,
    caseNumber: row.caseNumber,
    vin: row.vin,
    vehicleYear: row.vehicleYear,
    vehicleMake: row.vehicleMake,
    vehicleModel: row.vehicleModel,
    vehicleColor: row.vehicleColor,
    plate: row.plate,
    debtorName: row.debtorName,
    debtorAddress: row.debtorAddress,
    debtorPhone: row.debtorPhone,
    debtorSecondaryAddress: (row.debtorSecondaryAddress as Record<string, unknown> | null) ?? null,
    status: row.status,
    assignedAt: row.assignedAt.toISOString(),
    locatedAt: row.locatedAt ? row.locatedAt.toISOString() : null,
    recoveredAt: row.recoveredAt ? row.recoveredAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    redemptionWindowDays: row.redemptionWindowDays,
    redemptionEndsAt: row.redemptionEndsAt ? row.redemptionEndsAt.toISOString() : null,
    refAssignmentId: row.refAssignmentId,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toAttemptDto(row: RepoLocationAttempt): RepoLocationAttemptDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    repoCaseId: row.repoCaseId,
    attemptedAt: row.attemptedAt.toISOString(),
    attemptedByUserId: row.attemptedByUserId,
    address: row.address,
    outcome: row.outcome,
    notes: row.notes,
    gpsLat: row.gpsLat,
    gpsLng: row.gpsLng,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toRecoveryDto(row: RepoRecoveryEvent): RepoRecoveryEventDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    repoCaseId: row.repoCaseId,
    recoveredAt: row.recoveredAt.toISOString(),
    recoveredByUserId: row.recoveredByUserId,
    recoveryType: row.recoveryType,
    odometer: row.odometer,
    conditionNotes: row.conditionNotes,
    gpsLat: row.gpsLat,
    gpsLng: row.gpsLng,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toPropertyDto(row: RepoPersonalProperty): RepoPersonalPropertyDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    repoCaseId: row.repoCaseId,
    itemDescription: row.itemDescription,
    photoUrl: row.photoUrl,
    recordedAt: row.recordedAt.toISOString(),
    releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    releasedTo: row.releasedTo,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toPhotoDto(row: RepoConditionPhoto): RepoConditionPhotoDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    repoCaseId: row.repoCaseId,
    photoUrl: row.photoUrl,
    photoType: row.photoType,
    takenAt: row.takenAt.toISOString(),
    gpsLat: row.gpsLat,
    gpsLng: row.gpsLng,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
