import { createHmac, timingSafeEqual } from 'node:crypto';
/**
 * Twilio status webhook. Twilio POSTs delivery state changes here as
 * application/x-www-form-urlencoded. We map the SmsStatus to our
 * tracking_links.sms_status enum and update the row.
 *
 * No auth: Twilio identifies itself by signature header. We accept any
 * incoming POST in dev (the stub provider never calls this endpoint), and
 * verify the X-Twilio-Signature header in production. Verification is
 * implemented inline because the Twilio Node SDK isn't a dependency.
 */
import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ConfigService } from '../../config/config.service.js';
import { TrackingService } from './tracking.service.js';

@Public()
@Controller('public/track-webhook')
export class TrackingWebhookController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly config: ConfigService,
  ) {}

  @Post('twilio')
  @HttpCode(HttpStatus.NO_CONTENT)
  async twilio(
    @Headers('x-twilio-signature') signature: string | undefined,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const body = (req.body ?? {}) as Record<string, string>;
    const externalId = body.MessageSid ?? body.SmsSid;
    const twilioStatus = body.MessageStatus ?? body.SmsStatus;
    const errorCode = body.ErrorCode;
    const errorMsg = body.ErrorMessage;
    if (!externalId || !twilioStatus) return;

    if (this.config.notification.activeProviderId === 'twilio') {
      const valid = verifyTwilioSignature(
        signature ?? '',
        this.config.notification.twilio.authToken,
        publicUrl(req),
        body,
      );
      if (!valid) {
        // Return 204 silently rather than 401 so we don't leak validity to scanners.
        return;
      }
    }

    const status = mapStatus(twilioStatus);
    const reason = errorCode ? `${errorCode}${errorMsg ? `: ${errorMsg}` : ''}` : undefined;
    await this.tracking.handleProviderWebhookStatus(externalId, status, reason);
  }
}

function mapStatus(s: string): 'queued' | 'sent' | 'delivered' | 'failed' {
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
    default:
      return 'failed';
  }
}

function publicUrl(req: FastifyRequest): string {
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined) ?? (req.protocol || 'https');
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host) as string | undefined;
  return `${proto}://${host ?? 'localhost'}${req.url}`;
}

/**
 * Twilio request validation: HMAC-SHA1 of (URL + sorted form-fields) using
 * the auth token, base64-encoded. Match against X-Twilio-Signature.
 */
function verifyTwilioSignature(
  provided: string,
  authToken: string,
  url: string,
  body: Record<string, string>,
): boolean {
  if (!provided || !authToken) return false;
  const sorted = Object.keys(body)
    .sort()
    .map((k) => `${k}${body[k] ?? ''}`)
    .join('');
  const expected = createHmac('sha1', authToken).update(`${url}${sorted}`).digest('base64');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
