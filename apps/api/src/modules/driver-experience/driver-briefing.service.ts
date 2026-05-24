/**
 * DriverBriefingService — admin-authored "briefing of the day" and the
 * driver-side acknowledgement ledger.
 *
 * The schema enforces one is_active=true row per tenant via partial
 * unique index. Creating a new active briefing must therefore archive
 * the prior live row in the same transaction — handled in `create`.
 *
 * "Today" boundary: we use the tenant's IANA timezone (settings.timezone,
 * falling back to America/New_York via readTenantTimezone) so a driver
 * starting a shift at 23:00 local doesn't end up acknowledging the
 * "next-day" briefing for a still-current shift. UTC was the obvious
 * alternative but flips at midnight in places drivers don't actually
 * live, which surfaced as "I already saw this" complaints in prior dev
 * environments.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  driverBriefingAcknowledgments,
  driverDailyBriefings,
  tenants,
  uuidv7,
} from '@ustowdispatch/db';
import {
  type CreateDriverDailyBriefingPayload,
  type DriverBriefingAcknowledgmentDto,
  type DriverDailyBriefingDto,
  ERROR_CODES,
  type UpdateDriverDailyBriefingPayload,
} from '@ustowdispatch/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { readTenantTimezone } from '../ar/tenant-settings.helper.js';
import type { DriverContext, OperatorContext } from './driver-auth.service.js';

@Injectable()
export class DriverBriefingService {
  constructor(private readonly db: TenantAwareDb) {}

  async getActive(ctx: DriverContext): Promise<DriverDailyBriefingDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        const row = await tx.query.driverDailyBriefings.findFirst({
          where: and(
            eq(driverDailyBriefings.isActive, true),
            isNull(driverDailyBriefings.deletedAt),
          ),
        });
        if (!row) {
          throw new NotFoundException({
            code: ERROR_CODES.NOT_FOUND,
            message: 'No active briefing',
          });
        }
        return briefingRowToDto(row);
      },
    );
  }

  /**
   * Admin create. If is_active=true, archive the prior active row in the
   * same transaction so the partial unique index doesn't reject the
   * insert (and so the driver app's "active briefing" query returns the
   * newest, not a stale one).
   */
  async create(
    ctx: OperatorContext,
    input: CreateDriverDailyBriefingPayload,
  ): Promise<DriverDailyBriefingDto> {
    return this.db.runInTenantContext(this.toOperatorTenantCtx(ctx), async (tx) => {
      if (input.isActive) {
        await tx
          .update(driverDailyBriefings)
          .set({ isActive: false, updatedAt: new Date(), updatedBy: ctx.userId })
          .where(
            and(eq(driverDailyBriefings.isActive, true), isNull(driverDailyBriefings.deletedAt)),
          );
      }
      const id = uuidv7();
      const [row] = await tx
        .insert(driverDailyBriefings)
        .values({
          id,
          tenantId: ctx.tenantId,
          title: input.title,
          message: input.message,
          videoUrl: input.videoUrl ?? null,
          videoMinDurationSeconds: input.videoMinDurationSeconds,
          isActive: input.isActive,
          publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('insert driver_daily_briefings .. returning() yielded no row');
      return briefingRowToDto(row);
    });
  }

  async patch(
    ctx: OperatorContext,
    id: string,
    patch: UpdateDriverDailyBriefingPayload,
  ): Promise<DriverDailyBriefingDto> {
    return this.db.runInTenantContext(this.toOperatorTenantCtx(ctx), async (tx) => {
      const existing = await tx.query.driverDailyBriefings.findFirst({
        where: and(eq(driverDailyBriefings.id, id), isNull(driverDailyBriefings.deletedAt)),
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Briefing not found',
        });
      }
      // If the patch flips isActive=true on a row that's not already
      // active, demote the existing active row to keep the unique index
      // satisfied. No-op if `existing` is already active.
      if (patch.isActive === true && !existing.isActive) {
        await tx
          .update(driverDailyBriefings)
          .set({ isActive: false, updatedAt: new Date(), updatedBy: ctx.userId })
          .where(
            and(eq(driverDailyBriefings.isActive, true), isNull(driverDailyBriefings.deletedAt)),
          );
      }
      const updates: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.userId };
      if (patch.title !== undefined) updates.title = patch.title;
      if (patch.message !== undefined) updates.message = patch.message;
      if (patch.videoUrl !== undefined) updates.videoUrl = patch.videoUrl ?? null;
      if (patch.videoMinDurationSeconds !== undefined)
        updates.videoMinDurationSeconds = patch.videoMinDurationSeconds;
      if (patch.isActive !== undefined) updates.isActive = patch.isActive;
      if (patch.publishedAt !== undefined)
        updates.publishedAt = patch.publishedAt ? new Date(patch.publishedAt) : null;
      if (patch.expiresAt !== undefined)
        updates.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;

      const [row] = await tx
        .update(driverDailyBriefings)
        .set(updates)
        .where(eq(driverDailyBriefings.id, id))
        .returning();
      if (!row) throw new Error('update driver_daily_briefings .. returning() yielded no row');
      return briefingRowToDto(row);
    });
  }

  /**
   * Driver acknowledges the briefing. Idempotent on (driverId, briefingId,
   * acknowledged_date) — the partial unique index does the dedup; we use
   * INSERT … ON CONFLICT DO NOTHING and then re-fetch the row so the
   * caller always receives the canonical record.
   */
  async acknowledge(
    ctx: DriverContext,
    briefingId: string,
    payload: { messageReadAt?: string | undefined; videoCompletedAt?: string | undefined },
  ): Promise<DriverBriefingAcknowledgmentDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        const briefing = await tx.query.driverDailyBriefings.findFirst({
          where: and(
            eq(driverDailyBriefings.id, briefingId),
            isNull(driverDailyBriefings.deletedAt),
          ),
        });
        if (!briefing) {
          throw new NotFoundException({
            code: ERROR_CODES.NOT_FOUND,
            message: 'Briefing not found',
          });
        }
        const ackDate = await this.tenantToday(tx, ctx.tenantId);
        const id = uuidv7();
        await tx.execute(sql`
          INSERT INTO driver_briefing_acknowledgments
            (id, tenant_id, driver_id, briefing_id, acknowledged_date,
             message_read_at, video_completed_at, acknowledged_at,
             ip_address, user_agent, created_at)
          VALUES (
            ${id}::uuid,
            ${ctx.tenantId}::uuid,
            ${ctx.driverId}::uuid,
            ${briefingId}::uuid,
            ${ackDate}::date,
            ${payload.messageReadAt ? new Date(payload.messageReadAt) : null},
            ${payload.videoCompletedAt ? new Date(payload.videoCompletedAt) : null},
            now(),
            ${ctx.ipAddress ?? null},
            ${ctx.userAgent ?? null},
            now()
          )
          ON CONFLICT (tenant_id, driver_id, briefing_id, acknowledged_date)
          DO NOTHING
        `);
        const row = await tx.query.driverBriefingAcknowledgments.findFirst({
          where: and(
            eq(driverBriefingAcknowledgments.driverId, ctx.driverId),
            eq(driverBriefingAcknowledgments.briefingId, briefingId),
            eq(driverBriefingAcknowledgments.acknowledgedDate, ackDate),
          ),
        });
        if (!row) {
          throw new Error('acknowledge: ON CONFLICT DO NOTHING yielded no row and re-fetch missed');
        }
        return ackRowToDto(row);
      },
    );
  }

  /**
   * Driver-side "is there a briefing I need to ack today?" check. Used
   * by the truck app on session-resume so we don't gate every reload on
   * a fresh ack press if the driver already acknowledged it this shift.
   */
  async needsAcknowledgment(
    ctx: DriverContext,
  ): Promise<{ needs: boolean; briefing: DriverDailyBriefingDto | null }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        const briefing = await tx.query.driverDailyBriefings.findFirst({
          where: and(
            eq(driverDailyBriefings.isActive, true),
            isNull(driverDailyBriefings.deletedAt),
          ),
        });
        if (!briefing) return { needs: false, briefing: null };
        const ackDate = await this.tenantToday(tx, ctx.tenantId);
        const existing = await tx.query.driverBriefingAcknowledgments.findFirst({
          where: and(
            eq(driverBriefingAcknowledgments.driverId, ctx.driverId),
            eq(driverBriefingAcknowledgments.briefingId, briefing.id),
            eq(driverBriefingAcknowledgments.acknowledgedDate, ackDate),
          ),
        });
        return { needs: !existing, briefing: briefingRowToDto(briefing) };
      },
    );
  }

  /**
   * Convenience used by other services (DriverShiftService.checkIn) to
   * decide whether to gate a shift start on briefing acknowledgement.
   */
  async hasAckedToday(
    tx: Tx,
    tenantId: string,
    driverId: string,
  ): Promise<{
    ok: boolean;
    briefing: DriverDailyBriefingDto | null;
  }> {
    const briefing = await tx.query.driverDailyBriefings.findFirst({
      where: and(eq(driverDailyBriefings.isActive, true), isNull(driverDailyBriefings.deletedAt)),
    });
    if (!briefing) return { ok: true, briefing: null };
    const ackDate = await this.tenantToday(tx, tenantId);
    const existing = await tx.query.driverBriefingAcknowledgments.findFirst({
      where: and(
        eq(driverBriefingAcknowledgments.driverId, driverId),
        eq(driverBriefingAcknowledgments.briefingId, briefing.id),
        eq(driverBriefingAcknowledgments.acknowledgedDate, ackDate),
      ),
    });
    return { ok: !!existing, briefing: briefingRowToDto(briefing) };
  }

  /**
   * Today's `YYYY-MM-DD` in the tenant's IANA timezone. Read inside the
   * same tx so it stays consistent with the briefing/ack lookups.
   */
  private async tenantToday(tx: Tx, tenantId: string): Promise<string> {
    const t = await tx.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { settings: true },
    });
    const tz = readTenantTimezone((t?.settings as Record<string, unknown> | null) ?? null);
    return ymdInTimezone(new Date(), tz);
  }

  private toOperatorTenantCtx(ctx: OperatorContext): {
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

  /**
   * Admin: list every briefing for the tenant (active + inactive,
   * excluding soft-deleted). Sorted newest-first so the Settings UI
   * shows the freshest authoring at the top.
   */
  async listAll(ctx: OperatorContext): Promise<DriverDailyBriefingDto[]> {
    return this.db.runInTenantContext(this.toOperatorTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.driverDailyBriefings.findMany({
        where: isNull(driverDailyBriefings.deletedAt),
        orderBy: (b, { desc }) => [desc(b.createdAt)],
      });
      return rows.map(briefingRowToDto);
    });
  }

  /**
   * Admin: training completion log. Joins acknowledgments with the
   * briefing title and the driver's first/last name so the UI can
   * render the formal record without N+1 fetches.
   *
   * Filters supported: briefingId (single), driverId (single), date
   * range. Limit is hard-capped to keep the CSV export bounded.
   */
  async listAcknowledgments(
    ctx: OperatorContext,
    filters: {
      briefingId?: string | undefined;
      driverId?: string | undefined;
      fromDate?: string | undefined;
      toDate?: string | undefined;
      limit?: number | undefined;
    } = {},
  ): Promise<
    Array<{
      id: string;
      driverId: string;
      driverName: string;
      briefingId: string;
      briefingTitle: string;
      acknowledgedDate: string;
      messageReadAt: string | null;
      videoCompletedAt: string | null;
      acknowledgedAt: string;
      ipAddress: string | null;
    }>
  > {
    const limit = Math.min(Math.max(filters.limit ?? 500, 1), 5000);
    return this.db.runInTenantContext(this.toOperatorTenantCtx(ctx), async (tx) => {
      // Drizzle doesn't have a clean .findMany with cross-table joins on
      // arbitrary columns, so we drop to raw SQL. Tenant scoping is the
      // first WHERE clause; RLS adds a second guard underneath.
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle .execute() return type varies by driver
      const result: any = await tx.execute(sql`
        SELECT
          a.id,
          a.driver_id        AS "driverId",
          d.first_name       AS "firstName",
          d.last_name        AS "lastName",
          a.briefing_id      AS "briefingId",
          b.title            AS "briefingTitle",
          to_char(a.acknowledged_date, 'YYYY-MM-DD') AS "acknowledgedDate",
          a.message_read_at  AS "messageReadAt",
          a.video_completed_at AS "videoCompletedAt",
          a.acknowledged_at  AS "acknowledgedAt",
          a.ip_address       AS "ipAddress"
        FROM driver_briefing_acknowledgments a
        JOIN driver_daily_briefings b ON b.id = a.briefing_id
        JOIN drivers d ON d.id = a.driver_id
        WHERE a.tenant_id = ${ctx.tenantId}
        ${filters.briefingId ? sql`AND a.briefing_id = ${filters.briefingId}` : sql``}
        ${filters.driverId ? sql`AND a.driver_id = ${filters.driverId}` : sql``}
        ${filters.fromDate ? sql`AND a.acknowledged_date >= ${filters.fromDate}::date` : sql``}
        ${filters.toDate ? sql`AND a.acknowledged_date <= ${filters.toDate}::date` : sql``}
        ORDER BY a.acknowledged_at DESC
        LIMIT ${limit}
      `);
      const rows: Array<Record<string, unknown>> = Array.isArray(result?.rows)
        ? result.rows
        : Array.isArray(result)
          ? result
          : [];
      return rows.map((r) => ({
        id: String(r.id),
        driverId: String(r.driverId),
        driverName: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'Driver',
        briefingId: String(r.briefingId),
        briefingTitle: String(r.briefingTitle),
        acknowledgedDate: String(r.acknowledgedDate),
        messageReadAt:
          r.messageReadAt instanceof Date
            ? r.messageReadAt.toISOString()
            : ((r.messageReadAt as string | null) ?? null),
        videoCompletedAt:
          r.videoCompletedAt instanceof Date
            ? r.videoCompletedAt.toISOString()
            : ((r.videoCompletedAt as string | null) ?? null),
        acknowledgedAt:
          r.acknowledgedAt instanceof Date
            ? r.acknowledgedAt.toISOString()
            : String(r.acknowledgedAt),
        ipAddress: (r.ipAddress as string | null) ?? null,
      }));
    });
  }
}

function briefingRowToDto(r: {
  id: string;
  tenantId: string;
  title: string;
  message: string;
  videoUrl: string | null;
  videoMinDurationSeconds: number;
  isActive: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): DriverDailyBriefingDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    title: r.title,
    message: r.message,
    videoUrl: r.videoUrl,
    videoMinDurationSeconds: r.videoMinDurationSeconds,
    isActive: r.isActive,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}

function ackRowToDto(r: {
  id: string;
  tenantId: string;
  driverId: string;
  briefingId: string;
  acknowledgedDate: string;
  messageReadAt: Date | null;
  videoCompletedAt: Date | null;
  acknowledgedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}): DriverBriefingAcknowledgmentDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    driverId: r.driverId,
    briefingId: r.briefingId,
    acknowledgedDate: r.acknowledgedDate,
    messageReadAt: r.messageReadAt ? r.messageReadAt.toISOString() : null,
    videoCompletedAt: r.videoCompletedAt ? r.videoCompletedAt.toISOString() : null,
    acknowledgedAt: r.acknowledgedAt.toISOString(),
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
  };
}

function ymdInTimezone(d: Date, timeZone: string): string {
  // Intl en-CA renders ISO-style YYYY-MM-DD directly. Safer than building
  // it from individual parts (which DST around midnight can split).
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return f.format(d);
}
