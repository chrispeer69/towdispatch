/**
 * QuickBooks webhook controller — POST /webhooks/quickbooks.
 *
 * Intuit signs each delivery with `intuit-signature: base64(hmac-sha256(body))`
 * keyed by the verifier token from the App Center. We compute the same HMAC
 * over the raw request body and reject any mismatch with 400.
 *
 * Tenant resolution: the body carries one or more eventNotifications each
 * keyed by realmId. AccountingService looks up the accounting_connections row
 * matching the realm to determine the tenant.
 *
 * Event handling: every change becomes a pull-sync job. The engine's per-row
 * idempotency lock (the partial unique index) makes back-to-back deliveries
 * for the same change collapse into a single in-flight job.
 */
import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { AccountingService } from './accounting.service.js';

@Public()
@Controller('webhooks/quickbooks')
export class AccountingWebhookController {
  constructor(private readonly accounting: AccountingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: FastifyRequest): Promise<{ received: true; enqueued: number }> {
    const sig = req.headers['intuit-signature'];
    const signature = Array.isArray(sig) ? sig[0] : sig;
    if (!signature) {
      throw new BadRequestException({
        code: 'invalid_signature',
        message: 'Missing intuit-signature header',
      });
    }
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody;
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new BadRequestException({
        code: 'invalid_signature',
        message: 'Empty webhook body',
      });
    }
    const parsed = this.accounting.parseAndVerifyWebhook(raw, signature);
    const result = await this.accounting.handleWebhookEvents(parsed.events);
    return { received: true as const, enqueued: result.enqueued };
  }
}
