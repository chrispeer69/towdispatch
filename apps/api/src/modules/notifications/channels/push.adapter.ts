/**
 * PushAdapter — Firebase Cloud Messaging (Android driver app, plus iOS via
 * Firebase once Session 6 ships).
 *
 * We call the FCM HTTP v1 API directly with a short-lived OAuth bearer token
 * minted from the service-account private key (jose RS256 sign). No firebase-admin
 * SDK — too heavy for the two endpoints we use, and the dev fallback path
 * stubs cleanly when creds are unset.
 *
 * The driver-app moat (see docs/notifications-driver-app-moat.md) requires
 * EVERY job-assigned push to include:
 *   * notification.title / body  — so the system tray fires even when the
 *     app is killed
 *   * data.* fields — so the foreground service can intercept and surface
 *     the loud channel
 *   * android.priority='HIGH' + channel_id=towcommand_jobs_emergency
 *
 * The adapter builds that payload from input.payload + the priority field.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { SignJWT, importPKCS8 } from 'jose';
import { ConfigService } from '../../../config/config.service.js';
import { REDIS_CLIENT } from '../../redis/redis.tokens.js';
import type {
  ChannelAdapter,
  ChannelSendInput,
  ChannelSendResult,
} from './channel-adapter.interface.js';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_CACHE_KEY = 'notify:fcm:access_token';

interface ResolveTokenContext {
  /** Optional override — used by tests. */
  forceRefresh?: boolean;
}

@Injectable()
export class PushAdapter implements ChannelAdapter {
  readonly channel = 'push' as const;
  readonly providerName = 'fcm';
  private readonly log = new Logger(PushAdapter.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  get isLive(): boolean {
    return this.config.notifications.fcm.configured;
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    if (!input.targetAddress) {
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: this.providerName,
        error: 'missing device token',
        permanent: true,
      };
    }
    if (!this.isLive) {
      // Dev / sandbox — log and pretend it landed. The notification_deliveries
      // row will still update so the in-app UI sees a green tick.
      this.log.debug(
        `FCM stub: notif=${input.notificationId} delivery=${input.deliveryId} to=${this.mask(input.targetAddress)}`,
      );
      return {
        status: 'sent',
        providerMessageId: `stub-${input.deliveryId}`,
        providerName: 'fcm-stub',
      };
    }
    try {
      const accessToken = await this.resolveAccessToken({});
      const fcm = this.config.notifications.fcm;
      const body = this.buildFcmBody(input);
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(fcm.projectId)}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: body }),
        },
      );
      if (res.status === 401 || res.status === 403) {
        // Stale cached token — kill it so the next send re-mints.
        await this.redis.del(TOKEN_CACHE_KEY);
      }
      if (res.status === 404 || res.status === 410) {
        // FCM "NotRegistered" / "UNREGISTERED" — the token is dead, never retry.
        return {
          status: 'failed',
          providerMessageId: null,
          providerName: this.providerName,
          error: 'fcm_token_not_registered',
          permanent: true,
        };
      }
      if (res.status < 200 || res.status >= 300) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          providerMessageId: null,
          providerName: this.providerName,
          error: `fcm_http_${res.status}: ${text.slice(0, 240)}`,
          permanent: res.status === 400,
        };
      }
      const data = (await res.json().catch(() => ({}))) as { name?: string };
      // FCM message id comes back as "projects/<id>/messages/<id>"; we keep
      // the long form so the delivery-tracking webhook can correlate.
      return {
        status: 'sent',
        providerMessageId: data.name ?? null,
        providerName: this.providerName,
      };
    } catch (err) {
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: this.providerName,
        error: err instanceof Error ? err.message : 'fcm unknown',
      };
    }
  }

  /**
   * Build the FCM `message` body. The driver-app moat requires both a
   * notification block AND a data block — see the doc for the reasoning.
   */
  private buildFcmBody(input: ChannelSendInput): Record<string, unknown> {
    const isEmergency = input.priority === 'emergency';
    const isJobAssign = input.eventType.startsWith('dispatch.');
    // Channel ids match the Android-side channel registrations.
    const androidChannel =
      isJobAssign && (isEmergency || input.priority === 'high')
        ? 'towcommand_jobs_emergency'
        : 'towcommand_jobs_normal';
    // Map priorities to FCM android priority. 'emergency' AND 'high' both go
    // HIGH so the device wakes the app; normal/low go NORMAL.
    const androidPriority =
      input.priority === 'emergency' || input.priority === 'high' ? 'HIGH' : 'NORMAL';

    const data: Record<string, string> = {
      event_type: input.eventType,
      notification_id: input.notificationId,
      delivery_id: input.deliveryId,
      tenant_id: input.tenantId,
      priority: input.priority,
      // Stringify the payload — FCM data values must be strings. The Android
      // side parses on receipt to drive deep linking.
      payload_json: JSON.stringify(input.payload),
    };

    return {
      token: input.targetAddress,
      notification: {
        title: input.renderedSubject ?? 'US Tow Dispatch',
        body: input.renderedBody,
      },
      data,
      android: {
        priority: androidPriority,
        notification: {
          channel_id: androidChannel,
          // The Android channel ships with the sound asset; this hint is
          // redundant but harmless.
          sound: isJobAssign ? 'new_job_alert' : 'default',
          // Lock the heads-up banner until the user dismisses/accepts.
          notification_priority: isEmergency
            ? 'PRIORITY_MAX'
            : androidPriority === 'HIGH'
              ? 'PRIORITY_HIGH'
              : 'PRIORITY_DEFAULT',
          default_vibrate_timings: false,
          // Tap → open the deep link the app handles.
          click_action: 'TOWCOMMAND_JOB_OPEN',
          tag: input.notificationId,
        },
        // Asks the device to wake the app right now (vs. throttled when
        // doze is active). Required for the moat.
        direct_boot_ok: true,
      },
      apns: {
        headers: {
          'apns-priority': isEmergency ? '10' : '5',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            alert: {
              title: input.renderedSubject ?? 'US Tow Dispatch',
              body: input.renderedBody,
            },
            sound: isEmergency ? 'new_job_alert.caf' : 'default',
            'interruption-level': isEmergency ? 'critical' : 'time-sensitive',
            'mutable-content': 1,
          },
          ...data,
        },
      },
    };
  }

  // ---- OAuth2 access token for the FCM HTTP v1 API ----

  private async resolveAccessToken(ctx: ResolveTokenContext): Promise<string> {
    if (!ctx.forceRefresh) {
      const cached = await this.redis.get(TOKEN_CACHE_KEY);
      if (cached) return cached;
    }
    const fcm = this.config.notifications.fcm;
    const now = Math.floor(Date.now() / 1000);
    // The key in env uses literal "\n" — convert before importing.
    const pem = fcm.privateKey.replace(/\\n/g, '\n');
    const key = await importPKCS8(pem, 'RS256');
    const assertion = await new SignJWT({
      scope: FCM_SCOPE,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(fcm.clientEmail)
      .setSubject(fcm.clientEmail)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`fcm token mint failed: ${res.status}`);
    }
    const j = (await res.json()) as { access_token: string; expires_in: number };
    // Cache slightly under the advertised TTL so we never serve a stale one.
    await this.redis.set(TOKEN_CACHE_KEY, j.access_token, 'EX', Math.max(60, j.expires_in - 60));
    return j.access_token;
  }

  private mask(token: string): string {
    if (token.length <= 8) return '****';
    return `${token.slice(0, 4)}…${token.slice(-4)}`;
  }
}
