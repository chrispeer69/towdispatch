/**
 * TwilioNotificationProvider — the production SMS path.
 *
 * Direct HTTP against Twilio's REST API; no SDK to keep our dependency surface
 * tight. Credentials come from per-call config (account SID, auth token, from
 * number) so a tenant-scoped credential store can plug in without changing
 * the call site.
 *
 * Status is "queued" right after we POST — Twilio will follow up via the
 * delivery webhook, which we map back to sms_delivered_at / sms_failed_reason
 * on the tracking_link. We do NOT block the dispatcher on delivery confirmation.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  NotificationChannel,
  NotificationCredentials,
  NotificationProvider,
  NotificationResult,
  SendNotificationInput,
} from './notification-provider.interface.js';

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** E.164 sender. Required for SMS. */
  fromPhone: string;
  /** Override REST base; defaults to api.twilio.com. */
  baseUrl?: string;
}

interface TwilioMessageResponse {
  sid: string;
  status: string;
  error_code?: number | null;
  error_message?: string | null;
}

@Injectable()
export class TwilioNotificationProvider implements NotificationProvider {
  private readonly log = new Logger(TwilioNotificationProvider.name);

  readonly descriptor = {
    id: 'twilio',
    displayName: 'Twilio',
    vendor: 'twilio',
    capabilities: ['sms', 'voice'],
  } as const;

  readonly supportedChannels: readonly NotificationChannel[] = ['sms', 'voice'];

  async send(
    creds: NotificationCredentials,
    input: SendNotificationInput,
  ): Promise<NotificationResult> {
    if (input.channel !== 'sms') {
      throw new Error(`TwilioNotificationProvider does not support channel ${input.channel}`);
    }
    const cfg = readConfig(creds);
    const body = (input.body ?? '').trim();
    if (!body) throw new Error('Twilio send: body is required');

    const baseUrl = cfg.baseUrl ?? 'https://api.twilio.com';
    const url = `${baseUrl}/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
    const form = new URLSearchParams();
    form.set('To', input.to);
    form.set('From', cfg.fromPhone);
    form.set('Body', body);
    if (input.clientReference) {
      // Twilio doesn't have a true idempotency-key header but does dedupe on
      // (To, Body, From) within a short window. We mostly use the reference
      // for correlation in our own logs.
      form.set('ProvideFeedback', 'false');
    }

    const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.log.warn(`Twilio send failed: ${res.status} ${text.slice(0, 240)}`);
      return {
        externalId: '',
        channel: 'sms',
        status: 'failed',
        error: `twilio_http_${res.status}`,
      };
    }

    const data = (await res.json()) as TwilioMessageResponse;
    return {
      externalId: data.sid,
      channel: 'sms',
      status: mapTwilioStatus(data.status),
      ...(data.error_message ? { error: data.error_message } : {}),
    };
  }

  async getStatus(
    creds: NotificationCredentials,
    externalId: string,
  ): Promise<NotificationResult | null> {
    const cfg = readConfig(creds);
    const baseUrl = cfg.baseUrl ?? 'https://api.twilio.com';
    const url = `${baseUrl}/2010-04-01/Accounts/${encodeURIComponent(
      cfg.accountSid,
    )}/Messages/${encodeURIComponent(externalId)}.json`;
    const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as TwilioMessageResponse;
    return {
      externalId: data.sid,
      channel: 'sms',
      status: mapTwilioStatus(data.status),
      ...(data.error_message ? { error: data.error_message } : {}),
    };
  }
}

function mapTwilioStatus(s: string): NotificationResult['status'] {
  switch (s) {
    case 'queued':
    case 'accepted':
    case 'scheduled':
      return 'queued';
    case 'sending':
    case 'sent':
      return 'sent';
    case 'delivered':
    case 'read':
      return 'delivered';
    case 'failed':
    case 'undelivered':
    case 'canceled':
      return 'failed';
    default:
      return 'queued';
  }
}

function readConfig(creds: NotificationCredentials): TwilioConfig {
  const c = creds.config as Record<string, unknown>;
  const accountSid = typeof c.accountSid === 'string' ? c.accountSid : '';
  const authToken = typeof c.authToken === 'string' ? c.authToken : '';
  const fromPhone = typeof c.fromPhone === 'string' ? c.fromPhone : '';
  if (!accountSid || !authToken || !fromPhone) {
    throw new Error('Twilio config missing accountSid/authToken/fromPhone');
  }
  const baseUrl = typeof c.baseUrl === 'string' ? c.baseUrl : undefined;
  return baseUrl
    ? { accountSid, authToken, fromPhone, baseUrl }
    : { accountSid, authToken, fromPhone };
}
