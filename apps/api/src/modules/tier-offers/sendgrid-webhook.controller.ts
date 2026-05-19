/**
 * SendGrid Event Webhook controller — POST /webhooks/sendgrid/tier-offers.
 *
 * Unauthenticated by design: SendGrid does not pass a tenant header.
 * Authenticity is established by verifying the ECDSA P-256 signature
 * SendGrid attaches to each delivery (when the public key is
 * configured). When `SENDGRID_WEBHOOK_PUBLIC_KEY` is unset we log a
 * warning and accept the request — production deploys MUST set the
 * key; the warning + the README make this loud.
 *
 * Path: this is the tier-offer-specific endpoint. Other features that
 * later opt into SendGrid event webhooks should mount their own
 * controller under `/webhooks/sendgrid/<feature>` rather than sharing
 * one handler — separating dispatch logic by feature keeps the blast
 * radius of a misclassified event small.
 *
 * Body: a JSON array of event objects. We accept up to ~1000 events per
 * request (SendGrid's documented batch ceiling); each event is handled
 * inside a try/catch in TierOfferWebhookService so one bad row never
 * tanks the whole batch.
 */
import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ConfigService } from '../../config/config.service.js';
import {
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
  verifySendGridSignature,
} from './sendgrid-webhook-signature.js';
import {
  type SendGridEvent,
  TierOfferWebhookService,
  type WebhookProcessingResult,
} from './sendgrid-webhook.service.js';

@Public()
@Controller('webhooks/sendgrid/tier-offers')
export class TierOfferWebhookController {
  private readonly log = new Logger(TierOfferWebhookController.name);

  constructor(
    private readonly service: TierOfferWebhookService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: FastifyRequest): Promise<{ received: true } & WebhookProcessingResult> {
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody;
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new BadRequestException({
        code: 'invalid_body',
        message: 'Empty or missing webhook body',
      });
    }
    const verifyKey = this.config.tierOffer.webhookPublicKey;
    if (verifyKey) {
      const sig = (req.headers[SENDGRID_SIGNATURE_HEADER] ?? '') as string;
      const ts = (req.headers[SENDGRID_TIMESTAMP_HEADER] ?? '') as string;
      const verdict = verifySendGridSignature({
        signatureBase64: typeof sig === 'string' ? sig : '',
        timestamp: typeof ts === 'string' ? ts : '',
        rawBody: raw,
        publicKey: verifyKey,
      });
      if (!verdict.valid) {
        this.log.warn({
          msg: 'tier-offer webhook signature verification failed',
          reason: verdict.reason,
        });
        throw new BadRequestException({
          code: 'invalid_signature',
          message: 'SendGrid webhook signature could not be verified',
        });
      }
    } else {
      this.log.warn({
        msg: 'tier-offer webhook received without signature verification — set SENDGRID_WEBHOOK_PUBLIC_KEY in production',
      });
    }
    let events: SendGridEvent[];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new BadRequestException({
          code: 'invalid_body',
          message: 'Webhook body must be a JSON array of events',
        });
      }
      events = parsed as SendGridEvent[];
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException({
        code: 'invalid_body',
        message: `Webhook body could not be parsed as JSON: ${(err as Error).message}`,
      });
    }
    const result = await this.service.handleEvents(events);
    return { received: true as const, ...result };
  }
}
