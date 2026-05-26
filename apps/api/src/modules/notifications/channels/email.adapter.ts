/**
 * EmailAdapter — SendGrid (transactional) + Mailgun (announcement).
 *
 * The active provider is chosen per dispatch via the optional `mailProvider`
 * hint on the payload; defaults to SendGrid for transactional events
 * (dispatch, billing, compliance, customer) and Mailgun for marketing /
 * announcement (system.* with payload.marketing=true).
 *
 * When neither provider has creds, we fall through to the legacy nodemailer
 * SMTP path (the existing EmailService) so dev environments still see emails
 * land in Mailhog.
 *
 * Both vendors are called via direct fetch — no SDK bloat. The webhook event
 * payloads they post back land on /notifications/webhooks/sendgrid and
 * /notifications/webhooks/mailgun (see DeliveryTrackingController).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';
import { EmailService as SmtpEmailService } from '../../email/email.service.js';
import type {
  ChannelAdapter,
  ChannelSendInput,
  ChannelSendResult,
} from './channel-adapter.interface.js';

@Injectable()
export class EmailAdapter implements ChannelAdapter {
  readonly channel = 'email' as const;
  private readonly log = new Logger(EmailAdapter.name);

  constructor(
    private readonly config: ConfigService,
    private readonly smtp: SmtpEmailService,
  ) {}

  get providerName(): string {
    const n = this.config.notifications;
    if (n.sendgrid.configured) return 'sendgrid';
    if (n.mailgun.configured) return 'mailgun';
    return 'smtp';
  }

  get isLive(): boolean {
    const n = this.config.notifications;
    return n.sendgrid.configured || n.mailgun.configured;
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    if (!input.targetAddress) {
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: this.providerName,
        error: 'missing recipient email',
        permanent: true,
      };
    }
    const n = this.config.notifications;
    // Marketing / announcement → Mailgun. Default → SendGrid.
    const isMarketing = Boolean(input.payload.marketing);
    if (isMarketing && n.mailgun.configured) {
      return this.sendMailgun(input);
    }
    if (n.sendgrid.configured) {
      return this.sendSendgrid(input);
    }
    if (n.mailgun.configured) {
      return this.sendMailgun(input);
    }
    return this.sendSmtp(input);
  }

  private async sendSendgrid(input: ChannelSendInput): Promise<ChannelSendResult> {
    const n = this.config.notifications.sendgrid;
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${n.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email: input.targetAddress }],
              custom_args: {
                tenant_id: input.tenantId,
                notification_id: input.notificationId,
                delivery_id: input.deliveryId,
              },
            },
          ],
          from: { email: n.fromEmail, name: n.fromName },
          subject: input.renderedSubject ?? '(no subject)',
          content: [
            ...(input.renderedBodyPlain
              ? [{ type: 'text/plain', value: input.renderedBodyPlain }]
              : []),
            { type: 'text/html', value: input.renderedBody },
          ],
        }),
      });
      const sgMsgId = res.headers.get('x-message-id');
      if (res.status < 200 || res.status >= 300) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          providerMessageId: sgMsgId,
          providerName: 'sendgrid',
          error: `sendgrid_http_${res.status}: ${text.slice(0, 240)}`,
          permanent: res.status === 400 || res.status === 401 || res.status === 403,
        };
      }
      return {
        status: 'sent',
        providerMessageId: sgMsgId,
        providerName: 'sendgrid',
      };
    } catch (err) {
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: 'sendgrid',
        error: err instanceof Error ? err.message : 'sendgrid unknown',
      };
    }
  }

  private async sendMailgun(input: ChannelSendInput): Promise<ChannelSendResult> {
    const n = this.config.notifications.mailgun;
    const base = n.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
    try {
      const form = new URLSearchParams();
      form.set('from', n.fromEmail);
      form.set('to', input.targetAddress);
      form.set('subject', input.renderedSubject ?? '(no subject)');
      form.set('html', input.renderedBody);
      if (input.renderedBodyPlain) form.set('text', input.renderedBodyPlain);
      form.set('v:tenant_id', input.tenantId);
      form.set('v:notification_id', input.notificationId);
      form.set('v:delivery_id', input.deliveryId);
      const auth = Buffer.from(`api:${n.apiKey}`).toString('base64');
      const res = await fetch(`${base}/v3/${encodeURIComponent(n.domain)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      if (res.status < 200 || res.status >= 300) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          providerMessageId: null,
          providerName: 'mailgun',
          error: `mailgun_http_${res.status}: ${text.slice(0, 240)}`,
          permanent: res.status === 400 || res.status === 401,
        };
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return {
        status: 'sent',
        providerMessageId: data.id ?? null,
        providerName: 'mailgun',
      };
    } catch (err) {
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: 'mailgun',
        error: err instanceof Error ? err.message : 'mailgun unknown',
      };
    }
  }

  private async sendSmtp(input: ChannelSendInput): Promise<ChannelSendResult> {
    // Dev fallback — just write through the existing nodemailer transport.
    // We don't re-render here; the body/subject are already rendered.
    try {
      await this.smtp.sendRawEmail({
        to: input.targetAddress,
        subject: input.renderedSubject ?? '(no subject)',
        html: input.renderedBody,
        text: input.renderedBodyPlain ?? stripHtmlBasic(input.renderedBody),
      });
    } catch (err) {
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: 'smtp',
        error: err instanceof Error ? err.message : 'smtp send failed',
      };
    }
    return { status: 'sent', providerMessageId: null, providerName: 'smtp' };
  }
}

function stripHtmlBasic(html: string): string {
  // A non-regex tag stripper to satisfy CodeQL's "Incomplete multi-character sanitization" warning
  // for the SMTP dev fallback.
  return html.split('<').map(chunk => {
    const idx = chunk.indexOf('>');
    return idx >= 0 ? chunk.slice(idx + 1) : chunk;
  }).join('');
}
