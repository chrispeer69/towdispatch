/**
 * DynamicPricingService — top-level CRUD + activation orchestration for
 * tiers, curves, NOAA mappings, holidays, overrides, demand-surge
 * suggestions, and tenant-level settings (cap, demand-surge thresholds,
 * storm-surge enable flag).
 *
 * Pure-math live in `dynamic-pricing-helpers.ts`. Read-only stack
 * resolution lives in `TierResolutionService`. Cron orchestration lives
 * in the *-task.ts files. Reports + exports live in `reports.service.ts`.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  dynamicPricingDemandSurgeSuggestions,
  dynamicPricingHolidayCalendar,
  dynamicPricingNoaaMappings,
  dynamicPricingOverrides,
  dynamicPricingTierActivations,
  dynamicPricingTiers,
  jobs,
  tenants,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type CreateDynamicPricingHolidayPayload,
  type CreateDynamicPricingNoaaMappingPayload,
  type CreateDynamicPricingOverridePayload,
  type CreateDynamicPricingTierPayload,
  DEFAULT_NOAA_MAPPINGS,
  DEFAULT_US_HOLIDAYS,
  type DynamicPricingDemandSurgeSuggestionDto,
  type DynamicPricingHolidayDto,
  type DynamicPricingNoaaMappingDto,
  type DynamicPricingOverrideDto,
  type DynamicPricingTenantSettings,
  type DynamicPricingTierDto,
  type UpdateDynamicPricingHolidayPayload,
  type UpdateDynamicPricingNoaaMappingPayload,
  type UpdateDynamicPricingTierPayload,
  dynamicPricingTenantSettingsSchema,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TierResolutionService } from './tier-resolution.service.js';

interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

const SYSTEM_USER_UUID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class DynamicPricingService {
  private readonly log = new Logger(DynamicPricingService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly resolver: TierResolutionService,
  ) {}

  // ---------- Tier CRUD ----------

  async listTiers(ctx: CallerCtx): Promise<DynamicPricingTierDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.dynamicPricingTiers.findMany({
        where: isNull(dynamicPricingTiers.deletedAt),
        orderBy: (t, { asc }) => [asc(t.category), asc(t.name)],
      });
      return rows.map(toTierDto);
    });
  }

  async createTier(
    ctx: CallerCtx,
    input: CreateDynamicPricingTierPayload,
  ): Promise<DynamicPricingTierDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx
        .insert(dynamicPricingTiers)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          name: input.name,
          category: input.category,
          multiplier: input.multiplier.toString(),
          scopeYardIds: input.scopeYardIds ?? null,
          isActive: false,
          schedule: input.schedule ?? null,
          createdByUserId: ctx.userId,
        })
        .returning();
      const r = row[0];
      if (!r) throw new Error('createTier: insert returning() yielded no row');
      return toTierDto(r);
    });
  }

  async updateTier(
    ctx: CallerCtx,
    tierId: string,
    input: UpdateDynamicPricingTierPayload,
  ): Promise<DynamicPricingTierDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const patch: Partial<typeof dynamicPricingTiers.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.category !== undefined) patch.category = input.category;
      if (input.multiplier !== undefined) patch.multiplier = input.multiplier.toString();
      if (input.scopeYardIds !== undefined) patch.scopeYardIds = input.scopeYardIds ?? null;
      if (input.schedule !== undefined) patch.schedule = input.schedule ?? null;
      if (input.autoRevertAt !== undefined) {
        patch.autoRevertAt = input.autoRevertAt ? new Date(input.autoRevertAt) : null;
      }
      const [row] = await tx
        .update(dynamicPricingTiers)
        .set(patch)
        .where(and(eq(dynamicPricingTiers.id, tierId), isNull(dynamicPricingTiers.deletedAt)))
        .returning();
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tier not found' });
      return toTierDto(row);
    });
  }

  async softDeleteTier(ctx: CallerCtx, tierId: string): Promise<void> {
    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      await tx
        .update(dynamicPricingTiers)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(dynamicPricingTiers.id, tierId));
    });
  }

  async activateTier(
    ctx: CallerCtx,
    tierId: string,
    reason?: string,
  ): Promise<DynamicPricingTierDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const tier = await tx.query.dynamicPricingTiers.findFirst({
        where: and(eq(dynamicPricingTiers.id, tierId), isNull(dynamicPricingTiers.deletedAt)),
      });
      if (!tier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tier not found' });
      if (tier.isActive) {
        throw new ConflictException({ code: 'CONFLICT', message: 'Tier already active' });
      }
      const [updated] = await tx
        .update(dynamicPricingTiers)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(dynamicPricingTiers.id, tierId))
        .returning();
      await tx.insert(dynamicPricingTierActivations).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        tierId,
        activatedAt: new Date(),
        activatedByUserId: ctx.userId,
        activationReason: reason ?? null,
      });
      if (!updated) throw new Error('activateTier: update yielded no row');
      return toTierDto(updated);
    });
  }

  async deactivateTier(
    ctx: CallerCtx,
    tierId: string,
    reason?: string,
  ): Promise<DynamicPricingTierDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const tier = await tx.query.dynamicPricingTiers.findFirst({
        where: and(eq(dynamicPricingTiers.id, tierId), isNull(dynamicPricingTiers.deletedAt)),
      });
      if (!tier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tier not found' });
      if (!tier.isActive) {
        // Idempotent: already inactive returns the row; no error.
        return toTierDto(tier);
      }
      const [updated] = await tx
        .update(dynamicPricingTiers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(dynamicPricingTiers.id, tierId))
        .returning();
      // Close any open activation rows for this tier.
      await tx
        .update(dynamicPricingTierActivations)
        .set({
          deactivatedAt: new Date(),
          deactivatedByUserId: ctx.userId,
          deactivationReason: reason ?? null,
        })
        .where(
          and(
            eq(dynamicPricingTierActivations.tierId, tierId),
            isNull(dynamicPricingTierActivations.deactivatedAt),
          ),
        );
      if (!updated) throw new Error('deactivateTier: update yielded no row');
      return toTierDto(updated);
    });
  }

  // ---------- NOAA mappings ----------

  async listNoaaMappings(ctx: CallerCtx): Promise<DynamicPricingNoaaMappingDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.dynamicPricingNoaaMappings.findMany({
        orderBy: (t, { asc }) => [asc(t.noaaAlertType)],
      });
      if (rows.length > 0) return rows.map(toNoaaDto);
      // Lazy-seed defaults on first read so a new tenant sees the 12 starter
      // mappings without an explicit setup step.
      const seeded = await tx
        .insert(dynamicPricingNoaaMappings)
        .values(
          DEFAULT_NOAA_MAPPINGS.map((m) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            noaaAlertType: m.alertType,
            multiplier: m.multiplier.toString(),
            isEnabled: true,
          })),
        )
        .returning();
      return seeded.map(toNoaaDto);
    });
  }

  async createNoaaMapping(
    ctx: CallerCtx,
    input: CreateDynamicPricingNoaaMappingPayload,
  ): Promise<DynamicPricingNoaaMappingDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .insert(dynamicPricingNoaaMappings)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          noaaAlertType: input.noaaAlertType,
          multiplier: input.multiplier.toString(),
          isEnabled: input.isEnabled ?? true,
        })
        .returning();
      if (!row) throw new Error('createNoaaMapping: insert yielded no row');
      return toNoaaDto(row);
    });
  }

  async updateNoaaMapping(
    ctx: CallerCtx,
    id: string,
    input: UpdateDynamicPricingNoaaMappingPayload,
  ): Promise<DynamicPricingNoaaMappingDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const patch: Partial<typeof dynamicPricingNoaaMappings.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.noaaAlertType !== undefined) patch.noaaAlertType = input.noaaAlertType;
      if (input.multiplier !== undefined) patch.multiplier = input.multiplier.toString();
      if (input.isEnabled !== undefined) patch.isEnabled = input.isEnabled;
      const [row] = await tx
        .update(dynamicPricingNoaaMappings)
        .set(patch)
        .where(eq(dynamicPricingNoaaMappings.id, id))
        .returning();
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Mapping not found' });
      return toNoaaDto(row);
    });
  }

  // ---------- Holiday calendar ----------

  async listHolidays(ctx: CallerCtx): Promise<DynamicPricingHolidayDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.dynamicPricingHolidayCalendar.findMany({
        orderBy: (t, { asc }) => [asc(t.name)],
      });
      if (rows.length > 0) return rows.map(toHolidayDto);
      // Lazy-seed 14 US federal defaults on first read.
      const seeded = await tx
        .insert(dynamicPricingHolidayCalendar)
        .values(
          DEFAULT_US_HOLIDAYS.map((h) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            name: h.name,
            occurrence: h.occurrence,
            dateSpec: h.dateSpec,
            multiplier: h.multiplier.toString(),
            isEnabled: true,
          })),
        )
        .returning();
      return seeded.map(toHolidayDto);
    });
  }

  async createHoliday(
    ctx: CallerCtx,
    input: CreateDynamicPricingHolidayPayload,
  ): Promise<DynamicPricingHolidayDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .insert(dynamicPricingHolidayCalendar)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          name: input.name,
          occurrence: input.occurrence,
          dateSpec: input.dateSpec,
          multiplier: input.multiplier.toString(),
          isEnabled: input.isEnabled ?? true,
        })
        .returning();
      if (!row) throw new Error('createHoliday: insert yielded no row');
      return toHolidayDto(row);
    });
  }

  async updateHoliday(
    ctx: CallerCtx,
    id: string,
    input: UpdateDynamicPricingHolidayPayload,
  ): Promise<DynamicPricingHolidayDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const patch: Partial<typeof dynamicPricingHolidayCalendar.$inferInsert> & {
        updatedAt: Date;
      } = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.occurrence !== undefined) patch.occurrence = input.occurrence;
      if (input.dateSpec !== undefined) patch.dateSpec = input.dateSpec;
      if (input.multiplier !== undefined) patch.multiplier = input.multiplier.toString();
      if (input.isEnabled !== undefined) patch.isEnabled = input.isEnabled;
      const [row] = await tx
        .update(dynamicPricingHolidayCalendar)
        .set(patch)
        .where(eq(dynamicPricingHolidayCalendar.id, id))
        .returning();
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Holiday not found' });
      return toHolidayDto(row);
    });
  }

  // ---------- Override on a quote ----------

  async createOverride(
    ctx: CallerCtx,
    jobId: string,
    input: CreateDynamicPricingOverridePayload,
  ): Promise<DynamicPricingOverrideDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      });
      if (!job) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Job not found' });
      // Snapshot the current applied tier stack at override time so the
      // Override Report can answer "what would have been charged".
      const stack = await this.resolver.resolveStack({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        baseCents: Number(job.rateQuotedCents),
      });
      const original = stack.finalCents;
      const [row] = await tx
        .insert(dynamicPricingOverrides)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          jobId,
          userId: ctx.userId,
          originalPriceCents: original,
          overridePriceCents: input.overridePriceCents,
          tierStackSnapshot: stack.tiers.map((t) => ({
            tierId: t.tierId,
            name: t.name,
            category: t.category,
            multiplier: t.multiplier,
          })),
          reasonCode: input.reasonCode,
          note: input.note ?? null,
        })
        .returning();
      if (!row) throw new Error('createOverride: insert yielded no row');
      // Record the override price on the job so subsequent quote reads
      // pick it up. We do not move the lifecycle status here.
      await tx
        .update(jobs)
        .set({ rateQuotedCents: input.overridePriceCents, updatedAt: new Date() })
        .where(eq(jobs.id, jobId));
      return {
        id: row.id,
        tenantId: row.tenantId,
        jobId: row.jobId,
        userId: row.userId,
        originalPriceCents: Number(row.originalPriceCents),
        overridePriceCents: Number(row.overridePriceCents),
        tierStackSnapshot: row.tierStackSnapshot as DynamicPricingOverrideDto['tierStackSnapshot'],
        reasonCode: row.reasonCode,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  // ---------- Demand-surge suggestions ----------

  async listPendingDemandSurgeSuggestions(
    ctx: CallerCtx,
  ): Promise<DynamicPricingDemandSurgeSuggestionDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.dynamicPricingDemandSurgeSuggestions.findMany({
        where: eq(dynamicPricingDemandSurgeSuggestions.status, 'pending'),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
      return rows.map(toDemandSurgeDto);
    });
  }

  async approveDemandSurgeSuggestion(
    ctx: CallerCtx,
    id: string,
    tierName?: string,
    autoRevertHours?: number,
  ): Promise<DynamicPricingTierDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const sug = await tx.query.dynamicPricingDemandSurgeSuggestions.findFirst({
        where: eq(dynamicPricingDemandSurgeSuggestions.id, id),
      });
      if (!sug) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Suggestion not found' });
      }
      if (sug.status !== 'pending') {
        throw new ConflictException({
          code: 'CONFLICT',
          message: `Suggestion already ${sug.status}`,
        });
      }
      const autoRevertAt = autoRevertHours
        ? new Date(Date.now() + autoRevertHours * 60 * 60 * 1000)
        : new Date(Date.now() + 4 * 60 * 60 * 1000); // default 4 hours
      const [tier] = await tx
        .insert(dynamicPricingTiers)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          name: tierName ?? `Demand Surge (${sug.thresholdPct}%)`,
          category: 'traffic',
          multiplier: sug.suggestedMultiplier,
          scopeYardIds: sug.yardId ? [sug.yardId] : null,
          isActive: true,
          autoRevertAt,
          createdByUserId: ctx.userId,
        })
        .returning();
      if (!tier) throw new Error('approveDemandSurgeSuggestion: insert yielded no row');
      await tx.insert(dynamicPricingTierActivations).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        tierId: tier.id,
        activatedAt: new Date(),
        activatedByUserId: ctx.userId,
        activationReason: `demand-surge approval (suggestion ${id})`,
      });
      await tx
        .update(dynamicPricingDemandSurgeSuggestions)
        .set({ status: 'approved', resolvedAt: new Date(), resolvedByUserId: ctx.userId })
        .where(eq(dynamicPricingDemandSurgeSuggestions.id, id));
      return toTierDto(tier);
    });
  }

  async dismissDemandSurgeSuggestion(ctx: CallerCtx, id: string): Promise<void> {
    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .update(dynamicPricingDemandSurgeSuggestions)
        .set({ status: 'dismissed', resolvedAt: new Date(), resolvedByUserId: ctx.userId })
        .where(
          and(
            eq(dynamicPricingDemandSurgeSuggestions.id, id),
            eq(dynamicPricingDemandSurgeSuggestions.status, 'pending'),
          ),
        )
        .returning();
      if (!row) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Pending suggestion not found',
        });
      }
    });
  }

  // ---------- Tenant settings (cap + thresholds + storm-surge flag) ----------

  async getTenantSettings(ctx: CallerCtx): Promise<DynamicPricingTenantSettings> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      const obj = (tenant?.settings as Record<string, unknown> | null) ?? null;
      const candidate = obj?.dynamicPricing ?? {};
      const parsed = dynamicPricingTenantSettingsSchema.safeParse(candidate);
      return parsed.success ? parsed.data : dynamicPricingTenantSettingsSchema.parse({});
    });
  }

  async updateTenantSettings(
    ctx: CallerCtx,
    patch: Partial<DynamicPricingTenantSettings>,
  ): Promise<DynamicPricingTenantSettings> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const tenant = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      const settings = (tenant?.settings as Record<string, unknown> | null) ?? {};
      const current = (settings.dynamicPricing as Record<string, unknown> | null) ?? {};
      const merged = dynamicPricingTenantSettingsSchema.parse({ ...current, ...patch });
      const next = { ...settings, dynamicPricing: merged };
      await tx
        .update(tenants)
        .set({ settings: next, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId));
      return merged;
    });
  }

  private toTenantCtx(ctx: CallerCtx): { tenantId: string; userId: string; requestId: string } {
    return { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId };
  }
}

// ---------- DTO mappers ----------

function toTierDto(row: typeof dynamicPricingTiers.$inferSelect): DynamicPricingTierDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    category: row.category,
    multiplier: Number(row.multiplier),
    scopeYardIds: row.scopeYardIds ?? null,
    isActive: row.isActive,
    schedule: (row.schedule as DynamicPricingTierDto['schedule']) ?? null,
    autoRevertAt: row.autoRevertAt ? row.autoRevertAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function toNoaaDto(
  row: typeof dynamicPricingNoaaMappings.$inferSelect,
): DynamicPricingNoaaMappingDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    noaaAlertType: row.noaaAlertType,
    multiplier: Number(row.multiplier),
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toHolidayDto(
  row: typeof dynamicPricingHolidayCalendar.$inferSelect,
): DynamicPricingHolidayDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    occurrence: row.occurrence,
    dateSpec: row.dateSpec as DynamicPricingHolidayDto['dateSpec'],
    multiplier: Number(row.multiplier),
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDemandSurgeDto(
  row: typeof dynamicPricingDemandSurgeSuggestions.$inferSelect,
): DynamicPricingDemandSurgeSuggestionDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    yardId: row.yardId,
    thresholdPct: row.thresholdPct,
    suggestedMultiplier: Number(row.suggestedMultiplier),
    currentJobs: row.currentJobs,
    baselineJobs: Number(row.baselineJobs),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedByUserId: row.resolvedByUserId,
  };
}

export { SYSTEM_USER_UUID };
