/**
 * StubNotificationProvider — the dev/test default.
 *
 * No external HTTP. Logs the would-be SMS body + URL to stdout, captures the
 * last N messages in memory so tests can assert "an SMS for this job was
 * sent". Returns a fake external id of the form `stub-<uuid>` and an
 * immediately-delivered status, since there's no real carrier to wait on.
 *
 * Why this exists: keeping Twilio out of dev means engineers don't need
 * vendor creds to spin up a working stack. Same pattern as our Maps stub.
 */
import { Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from '@towdispatch/db';
import type {
  NotificationCredentials,
  NotificationProvider,
  NotificationResult,
  SendNotificationInput,
} from './notification-provider.interface.js';

export interface StubSentMessage {
  externalId: string;
  channel: SendNotificationInput['channel'];
  to: string;
  body: string | undefined;
  subject: string | undefined;
  templateId: string | undefined;
  templateData: Record<string, unknown> | undefined;
  clientReference: string | undefined;
  sentAt: Date;
}

const STUB_RING_BUFFER = 200;

@Injectable()
export class StubNotificationProvider implements NotificationProvider {
  private readonly log = new Logger(StubNotificationProvider.name);
  private readonly sent: StubSentMessage[] = [];

  readonly descriptor = {
    id: 'stub',
    displayName: 'Stub (dev only)',
    vendor: 'towdispatch-internal',
    capabilities: ['sms', 'email', 'push', 'voice'],
  } as const;

  readonly supportedChannels = ['sms', 'email', 'push', 'voice'] as const;

  async send(
    _creds: NotificationCredentials,
    input: SendNotificationInput,
  ): Promise<NotificationResult> {
    const externalId = `stub-${uuidv7()}`;
    const record: StubSentMessage = {
      externalId,
      channel: input.channel,
      to: input.to,
      body: input.body,
      subject: input.subject,
      templateId: input.templateId,
      templateData: input.templateData,
      clientReference: input.clientReference,
      sentAt: new Date(),
    };
    this.sent.push(record);
    if (this.sent.length > STUB_RING_BUFFER) {
      this.sent.splice(0, this.sent.length - STUB_RING_BUFFER);
    }

    // Emit one structured log line per send so e2e tests can scrape it.
    // Phone number is masked (last 4 only) — same redaction we do for real.
    this.log.log(
      `[stub-notification] channel=${input.channel} to=${maskPhone(input.to)} ref=${
        input.clientReference ?? '-'
      } body=${truncate(input.body ?? '', 200)}`,
    );

    return { externalId, channel: input.channel, status: 'delivered' };
  }

  async getStatus(
    _creds: NotificationCredentials,
    externalId: string,
  ): Promise<NotificationResult | null> {
    const found = this.sent.find((m) => m.externalId === externalId);
    if (!found) return null;
    return { externalId, channel: found.channel, status: 'delivered' };
  }

  /** Test-only — read the captured ring buffer. */
  getSentMessages(): readonly StubSentMessage[] {
    return this.sent;
  }

  /** Test-only — drop captured messages. */
  reset(): void {
    this.sent.length = 0;
  }
}

function maskPhone(p: string): string {
  if (p.length <= 4) return '***';
  return `${'*'.repeat(Math.max(0, p.length - 4))}${p.slice(-4)}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
