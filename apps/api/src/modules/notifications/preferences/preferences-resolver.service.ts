/**
 * PreferencesResolver — given (tenant, user, eventType, priority), decides
 * which channels actually fire and whether quiet hours apply.
 *
 * Resolution order, per channel:
 *   1. priority='emergency' or eventType ∈ DEFAULT_QUIET_HOURS_OVERRIDES
 *      → every enabled channel fires immediately, quiet hours ignored.
 *   2. User row in notification_preferences for (eventCategory, channel)
 *      → use that enabled flag.
 *   3. Tenant default row (user_id IS NULL) for (eventCategory, channel)
 *      → use that enabled flag.
 *   4. Hard-coded shipping defaults from DEFAULT_PREFERENCES — guarantees
 *      a fresh tenant with zero rows still routes correctly.
 *
 * Quiet hours:
 *   - Reads notification_quiet_hours.{enabled, startLocal, endLocal, timezone}.
 *   - If enabled and `now` (in timezone) falls inside the window, the channel
 *     is "in quiet hours" — non-override events get scheduled for `endLocal`.
 *   - Override events: priority >= high AND
 *     (eventType ∈ user.overrideEventTypes ∪ DEFAULT_QUIET_HOURS_OVERRIDES).
 */
import { Injectable } from '@nestjs/common';
import {
  notificationPreferences,
  notificationQuietHours,
  users,
} from '@ustowdispatch/db';
import {
  DEFAULT_QUIET_HOURS_OVERRIDES,
  EVENT_CATEGORY_BY_EVENT,
  NOTIFICATION_CHANNEL_VALUES,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPriority,
  type Role,
} from '@ustowdispatch/shared';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Tx } from '../../../database/tenant-aware-db.service.js';

export interface UserChannelDecision {
  userId: string;
  channel: NotificationChannel;
  fire: boolean;
  /** When non-null, the delivery row should be created with status='suppressed'. */
  suppressionReason: string | null;
  /** When non-null, scheduledFor is set so the worker waits until quiet-hours end. */
  scheduledFor: Date | null;
}

interface ResolvedQuietHours {
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezone: string;
  overrideEventTypes: string[];
}

/**
 * Day-one defaults — every category enabled on in_app, push/sms/email on for
 * categories where they make sense. Tenants and users can flip them off.
 */
const DEFAULT_PREFERENCES: Record<string, Partial<Record<NotificationChannel, boolean>>> = {
  dispatch: { push: true, sms: false, email: false, in_app: true },
  motor_club: { push: true, sms: false, email: true, in_app: true },
  customer: { push: false, sms: true, email: true, in_app: false },
  billing: { push: false, sms: false, email: true, in_app: true },
  compliance: { push: true, sms: false, email: true, in_app: true },
  system: { push: false, sms: false, email: true, in_app: true },
  operational: { push: false, sms: false, email: false, in_app: true },
  security: { push: true, sms: false, email: true, in_app: true },
};

@Injectable()
export class PreferencesResolverService {
  /**
   * Resolves channel set for ONE user. If `requestedChannels` is non-auto,
   * only those channels are considered (caller intent overrides), but the
   * resolver still respects suppression: a user who turned email off is
   * not force-emailed just because the caller asked for it.
   */
  async resolveForUser(args: {
    tx: Tx;
    tenantId: string;
    userId: string;
    eventType: NotificationEvent;
    priority: NotificationPriority;
    requestedChannels: NotificationChannel[] | 'auto';
    now?: Date;
  }): Promise<UserChannelDecision[]> {
    const category = EVENT_CATEGORY_BY_EVENT[args.eventType];
    if (!category) {
      // Unknown event — caller shouldn't get here, but fail safe by treating
      // as system so the in_app channel fires.
      return [
        {
          userId: args.userId,
          channel: 'in_app',
          fire: true,
          suppressionReason: null,
          scheduledFor: null,
        },
      ];
    }

    const userPrefs = await this.loadUserPrefs(args.tx, args.tenantId, args.userId);
    const quietHours = await this.loadQuietHours(args.tx, args.tenantId, args.userId);

    const considerChannels =
      args.requestedChannels === 'auto'
        ? [...NOTIFICATION_CHANNEL_VALUES]
        : args.requestedChannels;

    const isAlwaysOn =
      args.priority === 'emergency' ||
      DEFAULT_QUIET_HOURS_OVERRIDES.includes(args.eventType) ||
      (quietHours?.overrideEventTypes ?? []).includes(args.eventType);

    const now = args.now ?? new Date();
    const inQuietHours = !isAlwaysOn && this.isInQuietHours(quietHours, now);
    const quietHoursEnd = inQuietHours ? this.nextQuietHoursEnd(quietHours!, now) : null;

    const out: UserChannelDecision[] = [];
    for (const channel of considerChannels) {
      // Webhook is tenant-level, not user-level — resolver never returns it
      // here; the dispatcher handles it separately.
      if (channel === 'webhook') continue;

      const enabled = this.isChannelEnabled(userPrefs, category, channel);

      if (!enabled) {
        out.push({
          userId: args.userId,
          channel,
          fire: false,
          suppressionReason: 'preferences_disabled',
          scheduledFor: null,
        });
        continue;
      }

      if (inQuietHours) {
        // High priority gets queued for end-of-quiet-hours, normal/low gets
        // queued the same way; only emergency bypasses (handled above).
        out.push({
          userId: args.userId,
          channel,
          fire: true,
          suppressionReason: null,
          scheduledFor: quietHoursEnd,
        });
        continue;
      }

      out.push({
        userId: args.userId,
        channel,
        fire: true,
        suppressionReason: null,
        scheduledFor: null,
      });
    }
    return out;
  }

  /**
   * Resolve the recipient user list when the dispatch targets a role scope
   * (e.g. "role:dispatcher"). Returns the user uuids; resolver caller then
   * fans out per user.
   */
  async resolveRoleScope(
    tx: Tx,
    tenantId: string,
    roleScope: string,
  ): Promise<string[]> {
    const roles = roleScope
      .replace(/^role:/, '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    if (roles.length === 0) return [];
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          isNull(users.deletedAt),
          inArray(users.role, roles as Role[]),
        ),
      );
    return rows.map((r) => r.id);
  }

  private isChannelEnabled(
    rows: {
      userId: string | null;
      eventCategory: string;
      channel: NotificationChannel;
      enabled: boolean;
    }[],
    category: string,
    channel: NotificationChannel,
  ): boolean {
    const userRow = rows.find(
      (r) => r.userId !== null && r.eventCategory === category && r.channel === channel,
    );
    if (userRow) return userRow.enabled;
    const tenantRow = rows.find(
      (r) => r.userId === null && r.eventCategory === category && r.channel === channel,
    );
    if (tenantRow) return tenantRow.enabled;
    return DEFAULT_PREFERENCES[category]?.[channel] ?? false;
  }

  private async loadUserPrefs(
    tx: Tx,
    tenantId: string,
    userId: string,
  ): Promise<
    {
      userId: string | null;
      eventCategory: string;
      channel: NotificationChannel;
      enabled: boolean;
    }[]
  > {
    const rows = await tx
      .select({
        userId: notificationPreferences.userId,
        eventCategory: notificationPreferences.eventCategory,
        channel: notificationPreferences.channel,
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          or(
            eq(notificationPreferences.userId, userId),
            isNull(notificationPreferences.userId),
          ),
        ),
      );
    return rows as typeof rows;
  }

  private async loadQuietHours(
    tx: Tx,
    tenantId: string,
    userId: string,
  ): Promise<ResolvedQuietHours | null> {
    const rows = await tx
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
    const row = rows[0];
    if (!row) return null;
    return {
      enabled: row.enabled,
      startLocal: row.startLocal,
      endLocal: row.endLocal,
      timezone: row.timezone,
      overrideEventTypes: Array.isArray(row.overrideEventTypes)
        ? (row.overrideEventTypes as string[])
        : [],
    };
  }

  // ---- quiet-hours math ----
  // We compute the local hour:minute in the user's IANA timezone using
  // Intl.DateTimeFormat. No moment-tz dep needed.

  isInQuietHours(qh: ResolvedQuietHours | null, now: Date): boolean {
    if (!qh || !qh.enabled) return false;
    const local = this.localHourMinute(now, qh.timezone);
    const start = this.parseHm(qh.startLocal);
    const end = this.parseHm(qh.endLocal);
    if (start === end) return false;
    if (start < end) {
      // Same-day window (e.g. 09:00 → 17:00 — unusual but support).
      return local >= start && local < end;
    }
    // Wraps midnight (e.g. 22:00 → 07:00).
    return local >= start || local < end;
  }

  nextQuietHoursEnd(qh: ResolvedQuietHours, now: Date): Date {
    const local = this.localHourMinute(now, qh.timezone);
    const end = this.parseHm(qh.endLocal);
    // Build "now in tz" components then add minutes-to-end. Approximate by
    // computing the diff in minutes and adding to `now` as UTC — works because
    // end is local-clock, and we just need a future Date that the worker can
    // delay until.
    let minutesUntilEnd: number;
    if (local < end) minutesUntilEnd = end - local;
    else minutesUntilEnd = 24 * 60 - local + end;
    return new Date(now.getTime() + minutesUntilEnd * 60_000);
  }

  private localHourMinute(d: Date, tz: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hh * 60 + mm;
  }

  private parseHm(s: string): number {
    const [hh, mm] = s.split(':').map((x) => Number(x));
    return (hh ?? 0) * 60 + (mm ?? 0);
  }
}
