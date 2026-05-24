/**
 * PreferencesService — read/write of notification_preferences +
 * notification_quiet_hours.
 *
 * Read shape returned to the UI: a flattened matrix of (eventCategory,
 * channel, enabled) cells. The UI renders it as a checkbox grid; PATCH
 * sends back the cells the user touched.
 *
 * Update semantics: a user-level row overrides the tenant default for
 * that (category, channel). Deleting a user row reverts to the tenant
 * default. We use upsert-on-(tenant_id, user_id, category, channel) via
 * the partial unique index landed in sql/0016.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  notificationPreferences,
  notificationQuietHours,
  users,
  uuidv7,
} from '@ustowdispatch/db';
import {
  NOTIFICATION_EVENT_CATEGORY_VALUES,
  NOTIFICATION_CHANNEL_VALUES,
  type NotificationChannel,
  type NotificationEventCategory,
  type TenantDefaultPreferencesPayload,
  type UpdateUserPreferencesPayload,
  type UserPreferencesDto,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../../database/tenant-aware-db.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
}

@Injectable()
export class PreferencesService {
  constructor(private readonly db: TenantAwareDb) {}

  async getForUser(ctx: CallerContext, userId: string): Promise<UserPreferencesDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        // Verify the target user belongs to this tenant.
        const userRows = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), eq(users.tenantId, ctx.tenantId)))
          .limit(1);
        if (!userRows[0]) throw new NotFoundException('user not found');

        const matrix = await this.loadMergedMatrix(tx, ctx.tenantId, userId);
        const qhRows = await tx
          .select({
            enabled: notificationQuietHours.enabled,
            startLocal: notificationQuietHours.startLocal,
            endLocal: notificationQuietHours.endLocal,
            timezone: notificationQuietHours.timezone,
            overrideEventTypes: notificationQuietHours.overrideEventTypes,
          })
          .from(notificationQuietHours)
          .where(
            and(
              eq(notificationQuietHours.tenantId, ctx.tenantId),
              eq(notificationQuietHours.userId, userId),
            ),
          )
          .limit(1);
        const qh = qhRows[0] ?? {
          enabled: false,
          startLocal: '22:00',
          endLocal: '07:00',
          timezone: 'UTC',
          overrideEventTypes: [] as string[],
        };

        return {
          userId,
          preferences: matrix,
          quietHours: {
            enabled: qh.enabled,
            startLocal: qh.startLocal,
            endLocal: qh.endLocal,
            timezone: qh.timezone,
            overrideEventTypes: (qh.overrideEventTypes ?? []) as string[],
          },
        };
      },
    );
  }

  async updateForUser(
    ctx: CallerContext,
    userId: string,
    body: UpdateUserPreferencesPayload,
  ): Promise<UserPreferencesDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        if (body.preferences) {
          for (const cell of body.preferences) {
            await this.upsertCell(tx, ctx.tenantId, userId, cell);
          }
        }
        if (body.quietHours) {
          await this.upsertQuietHours(tx, ctx.tenantId, userId, body.quietHours);
        }
        // Re-read so UI is consistent with what landed in DB.
        return this.getForUserInsideTx(tx, ctx.tenantId, userId);
      },
    );
  }

  async updateTenantDefaults(
    ctx: CallerContext,
    body: TenantDefaultPreferencesPayload,
  ): Promise<{ updated: number }> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
      async (tx) => {
        let updated = 0;
        for (const cell of body.preferences) {
          await this.upsertCell(tx, ctx.tenantId, null, cell);
          updated++;
        }
        return { updated };
      },
    );
  }

  // ---------- internals ----------

  private async getForUserInsideTx(
    tx: Tx,
    tenantId: string,
    userId: string,
  ): Promise<UserPreferencesDto> {
    const matrix = await this.loadMergedMatrix(tx, tenantId, userId);
    const qhRows = await tx
      .select({
        enabled: notificationQuietHours.enabled,
        startLocal: notificationQuietHours.startLocal,
        endLocal: notificationQuietHours.endLocal,
        timezone: notificationQuietHours.timezone,
        overrideEventTypes: notificationQuietHours.overrideEventTypes,
      })
      .from(notificationQuietHours)
      .where(
        and(
          eq(notificationQuietHours.tenantId, tenantId),
          eq(notificationQuietHours.userId, userId),
        ),
      )
      .limit(1);
    const qh = qhRows[0] ?? {
      enabled: false,
      startLocal: '22:00',
      endLocal: '07:00',
      timezone: 'UTC',
      overrideEventTypes: [] as string[],
    };
    return {
      userId,
      preferences: matrix,
      quietHours: {
        enabled: qh.enabled,
        startLocal: qh.startLocal,
        endLocal: qh.endLocal,
        timezone: qh.timezone,
        overrideEventTypes: (qh.overrideEventTypes ?? []) as string[],
      },
    };
  }

  /**
   * Returns a row for every (category, channel) pair with the effective
   * enabled value (user row > tenant default > built-in shipping default).
   */
  private async loadMergedMatrix(
    tx: Tx,
    tenantId: string,
    userId: string,
  ): Promise<UserPreferencesDto['preferences']> {
    const rows = await tx
      .select({
        userId: notificationPreferences.userId,
        eventCategory: notificationPreferences.eventCategory,
        channel: notificationPreferences.channel,
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.tenantId, tenantId));
    const out: UserPreferencesDto['preferences'] = [];
    for (const category of NOTIFICATION_EVENT_CATEGORY_VALUES) {
      for (const channel of NOTIFICATION_CHANNEL_VALUES) {
        if (channel === 'webhook') continue;
        const userRow = rows.find(
          (r) => r.userId === userId && r.eventCategory === category && r.channel === channel,
        );
        const tenantRow = rows.find(
          (r) => r.userId === null && r.eventCategory === category && r.channel === channel,
        );
        const enabled = userRow?.enabled ?? tenantRow?.enabled ?? defaultEnabled(category, channel);
        out.push({ eventCategory: category, channel, enabled });
      }
    }
    return out;
  }

  private async upsertCell(
    tx: Tx,
    tenantId: string,
    userId: string | null,
    cell: { eventCategory: string; channel: NotificationChannel; enabled: boolean },
  ): Promise<void> {
    // Try update first, insert if zero rows touched. Cheaper than upsert
    // because Drizzle doesn't fully express the partial-unique target here.
    const existing = await tx
      .select({ id: notificationPreferences.id })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          userId === null
            ? isNull(notificationPreferences.userId)
            : eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.eventCategory, cell.eventCategory),
          eq(notificationPreferences.channel, cell.channel),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await tx
        .update(notificationPreferences)
        .set({ enabled: cell.enabled, updatedAt: new Date() })
        .where(eq(notificationPreferences.id, existing[0].id));
      return;
    }
    await tx.insert(notificationPreferences).values({
      id: uuidv7(),
      tenantId,
      userId,
      eventCategory: cell.eventCategory,
      channel: cell.channel,
      enabled: cell.enabled,
    });
  }

  private async upsertQuietHours(
    tx: Tx,
    tenantId: string,
    userId: string,
    qh: NonNullable<UpdateUserPreferencesPayload['quietHours']>,
  ): Promise<void> {
    const existing = await tx
      .select({ id: notificationQuietHours.id })
      .from(notificationQuietHours)
      .where(
        and(
          eq(notificationQuietHours.tenantId, tenantId),
          eq(notificationQuietHours.userId, userId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await tx
        .update(notificationQuietHours)
        .set({
          enabled: qh.enabled,
          startLocal: qh.startLocal,
          endLocal: qh.endLocal,
          timezone: qh.timezone,
          overrideEventTypes: qh.overrideEventTypes,
          updatedAt: new Date(),
        })
        .where(eq(notificationQuietHours.id, existing[0].id));
      return;
    }
    await tx.insert(notificationQuietHours).values({
      id: uuidv7(),
      tenantId,
      userId,
      enabled: qh.enabled,
      startLocal: qh.startLocal,
      endLocal: qh.endLocal,
      timezone: qh.timezone,
      overrideEventTypes: qh.overrideEventTypes,
    });
  }
}

function defaultEnabled(
  category: NotificationEventCategory | string,
  channel: NotificationChannel,
): boolean {
  // Mirrors PreferencesResolverService.DEFAULT_PREFERENCES — duplicated here
  // intentionally so the API surface and the resolver can evolve
  // independently if a tenant ever needs an override default per role.
  const matrix: Record<string, Partial<Record<NotificationChannel, boolean>>> = {
    dispatch: { push: true, in_app: true },
    motor_club: { push: true, email: true, in_app: true },
    customer: { sms: true, email: true },
    billing: { email: true, in_app: true },
    compliance: { push: true, email: true, in_app: true },
    system: { email: true, in_app: true },
    operational: { in_app: true },
    security: { push: true, email: true, in_app: true },
  };
  return matrix[category]?.[channel] ?? false;
}
