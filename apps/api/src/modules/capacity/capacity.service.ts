/**
 * CapacityService — operator-facing settings, manual overrides, and the
 * broadcast receipt log. All request-scoped work runs under the caller's
 * tenant context (RLS); recompute + partner fan-out happen after commit
 * via CapacityEventsListener.run().
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  capacityBroadcasts,
  capacityOverrides,
  capacityPartners,
  capacitySettings,
  uuidv7,
} from '@ustowdispatch/db';
import type {
  CapacityBroadcastDto,
  CapacityBroadcastPage,
  CapacityOverrideDto,
  CapacitySettingsDto,
  CapacityStatusDto,
  CreateCapacityOverridePayload,
  ListCapacityBroadcastsQuery,
  UpdateCapacitySettingsPayload,
} from '@ustowdispatch/shared';
import { CAPACITY_DEFAULTS, ERROR_CODES, assertBandsOrdered } from '@ustowdispatch/shared';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { CapacityComputeService } from './capacity-compute.service.js';
import { CapacityEventsListener } from './capacity-events.listener.js';

interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class CapacityService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly compute: CapacityComputeService,
    private readonly listener: CapacityEventsListener,
  ) {}

  // ---------- live status ----------

  async getStatus(ctx: CallerCtx): Promise<CapacityStatusDto> {
    return this.compute.getStatus(ctx.tenantId);
  }

  // ---------- settings ----------

  async getSettings(ctx: CallerCtx): Promise<CapacitySettingsDto> {
    return this.compute.loadSettings(ctx.tenantId);
  }

  async updateSettings(
    ctx: CallerCtx,
    input: UpdateCapacitySettingsPayload,
  ): Promise<CapacitySettingsDto> {
    const current = await this.compute.loadSettings(ctx.tenantId);
    // exactOptionalPropertyTypes: spread would smuggle `undefined` in —
    // merge field-by-field instead.
    const next: CapacitySettingsDto = {
      availableMaxRatio: input.availableMaxRatio ?? current.availableMaxRatio,
      limitedMaxRatio: input.limitedMaxRatio ?? current.limitedMaxRatio,
      constrainedMaxRatio: input.constrainedMaxRatio ?? current.constrainedMaxRatio,
      jobWeights: input.jobWeights ?? current.jobWeights,
      hysteresisBuffer: input.hysteresisBuffer ?? current.hysteresisBuffer,
      hysteresisDwellSeconds: input.hysteresisDwellSeconds ?? current.hysteresisDwellSeconds,
      minBroadcastIntervalSeconds:
        input.minBroadcastIntervalSeconds ?? current.minBroadcastIntervalSeconds,
      guidelineMinutes: input.guidelineMinutes ?? current.guidelineMinutes,
      overrideDefaultExpiryMinutes:
        input.overrideDefaultExpiryMinutes ?? current.overrideDefaultExpiryMinutes,
      perYardEnabled: input.perYardEnabled ?? current.perYardEnabled,
    };
    if (!assertBandsOrdered(next)) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Band thresholds must be ordered: available < limited < constrained',
      });
    }

    await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.capacitySettings.findFirst({
        where: isNull(capacitySettings.deletedAt),
      });
      const values = {
        availableMaxRatio: String(next.availableMaxRatio),
        limitedMaxRatio: String(next.limitedMaxRatio),
        constrainedMaxRatio: String(next.constrainedMaxRatio),
        jobWeights: next.jobWeights,
        hysteresisBuffer: String(next.hysteresisBuffer),
        hysteresisDwellSeconds: next.hysteresisDwellSeconds,
        minBroadcastIntervalSeconds: next.minBroadcastIntervalSeconds,
        guidelineMinutes: next.guidelineMinutes,
        overrideDefaultExpiryMinutes: next.overrideDefaultExpiryMinutes,
        perYardEnabled: next.perYardEnabled,
        updatedAt: new Date(),
      };
      if (existing) {
        await tx.update(capacitySettings).set(values).where(eq(capacitySettings.id, existing.id));
      } else {
        await tx.insert(capacitySettings).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          createdBy: ctx.userId,
          ...values,
        });
      }
    });

    // Recompute with the new knobs after the write commits.
    setImmediate(() => void this.listener.run(ctx.tenantId, 'settings_changed'));
    return next;
  }

  // ---------- manual overrides ----------

  async listOverrides(ctx: CallerCtx, includeHistory: boolean): Promise<CapacityOverrideDto[]> {
    const now = new Date();
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.capacityOverrides.findMany({
        where: includeHistory
          ? isNull(capacityOverrides.deletedAt)
          : and(
              isNull(capacityOverrides.deletedAt),
              isNull(capacityOverrides.clearedAt),
              gt(capacityOverrides.expiresAt, now),
            ),
        orderBy: [desc(capacityOverrides.createdAt)],
        limit: 100,
      });
      // Resolve creator/clearer names in one pass.
      const userIds = new Set<string>();
      for (const r of rows) {
        userIds.add(r.createdBy);
        if (r.clearedBy) userIds.add(r.clearedBy);
      }
      const names = new Map<string, string>();
      if (userIds.size > 0) {
        const users = await tx.query.users.findMany({
          where: (u, { inArray: inArr }) => inArr(u.id, Array.from(userIds)),
          columns: { id: true, firstName: true, lastName: true },
        });
        for (const u of users) names.set(u.id, `${u.firstName} ${u.lastName ?? ''}`.trim());
      }
      return rows.map((r) => ({
        id: r.id,
        dutyClass: r.dutyClass,
        forcedBand: r.forcedBand,
        reason: r.reason,
        expiresAt: r.expiresAt.toISOString(),
        clearedAt: r.clearedAt ? r.clearedAt.toISOString() : null,
        clearedByName: r.clearedBy ? (names.get(r.clearedBy) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        createdByName: names.get(r.createdBy) ?? null,
      }));
    });
  }

  async createOverride(
    ctx: CallerCtx,
    input: CreateCapacityOverridePayload,
  ): Promise<CapacityOverrideDto> {
    const settings = await this.compute.loadSettings(ctx.tenantId);
    const minutes = Math.min(
      input.expiresInMinutes ?? settings.overrideDefaultExpiryMinutes,
      CAPACITY_DEFAULTS.overrideMaxExpiryMinutes,
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + minutes * 60 * 1000);

    const dto = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      // One active override per scope: replace, don't stack. The replaced
      // row is cleared (kept for history/audit), the new one becomes live.
      // No expires_at condition: an expired row the cron hasn't swept yet
      // still occupies the partial unique index (cleared_at IS NULL), so it
      // must be cleared here too or the insert below hits 23505.
      await tx
        .update(capacityOverrides)
        .set({ clearedAt: now, clearedBy: ctx.userId, updatedAt: now })
        .where(
          and(
            eq(capacityOverrides.dutyClass, input.dutyClass),
            isNull(capacityOverrides.clearedAt),
            isNull(capacityOverrides.deletedAt),
          ),
        );
      const [row] = await tx
        .insert(capacityOverrides)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          dutyClass: input.dutyClass,
          forcedBand: input.forcedBand,
          reason: input.reason,
          expiresAt,
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('createOverride: insert returned no row');
      return row;
    });

    setImmediate(() => void this.listener.run(ctx.tenantId, 'override_set'));
    return {
      id: dto.id,
      dutyClass: dto.dutyClass,
      forcedBand: dto.forcedBand,
      reason: dto.reason,
      expiresAt: dto.expiresAt.toISOString(),
      clearedAt: null,
      clearedByName: null,
      createdAt: dto.createdAt.toISOString(),
      createdByName: null,
    };
  }

  async clearOverride(ctx: CallerCtx, overrideId: string): Promise<void> {
    const now = new Date();
    const cleared = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const [row] = await tx
        .update(capacityOverrides)
        .set({ clearedAt: now, clearedBy: ctx.userId, updatedAt: now })
        .where(
          and(
            eq(capacityOverrides.id, overrideId),
            isNull(capacityOverrides.clearedAt),
            isNull(capacityOverrides.deletedAt),
          ),
        )
        .returning({ id: capacityOverrides.id });
      return row ?? null;
    });
    if (!cleared) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Override not found or already cleared',
      });
    }
    setImmediate(() => void this.listener.run(ctx.tenantId, 'override_cleared'));
  }

  // ---------- broadcast log ----------

  async listBroadcasts(
    ctx: CallerCtx,
    query: ListCapacityBroadcastsQuery,
  ): Promise<CapacityBroadcastPage> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conditions = [isNull(capacityBroadcasts.deletedAt)];
      if (query.partnerId) conditions.push(eq(capacityBroadcasts.partnerId, query.partnerId));
      if (query.status) conditions.push(eq(capacityBroadcasts.status, query.status));
      const where = and(...conditions);

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(capacityBroadcasts)
        .where(where);
      const rows = await tx
        .select({
          broadcast: capacityBroadcasts,
          partnerName: capacityPartners.name,
        })
        .from(capacityBroadcasts)
        .innerJoin(capacityPartners, eq(capacityBroadcasts.partnerId, capacityPartners.id))
        .where(where)
        .orderBy(desc(capacityBroadcasts.createdAt))
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage);

      const items: CapacityBroadcastDto[] = rows.map(({ broadcast: b, partnerName }) => ({
        id: b.id,
        partnerId: b.partnerId,
        partnerName,
        status: b.status,
        httpStatus: b.httpStatus,
        latencyMs: b.latencyMs,
        retryCount: b.retryCount,
        nextRetryAt: b.nextRetryAt ? b.nextRetryAt.toISOString() : null,
        deliveredAt: b.deliveredAt ? b.deliveredAt.toISOString() : null,
        lastError: b.lastError,
        payload: b.payload,
        createdAt: b.createdAt.toISOString(),
      }));
      return { items, page: query.page, perPage: query.perPage, total: countRow?.total ?? 0 };
    });
  }

  private toTenantCtx(ctx: CallerCtx): {
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
