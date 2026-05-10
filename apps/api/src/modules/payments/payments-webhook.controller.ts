/**
 * Stripe webhook controller — POST /webhooks/stripe.
 *
 * Wire-protocol notes:
 *   - The route is @Public so the global JWT guard skips it.
 *   - Fastify's JSON content-type parser must NOT consume the body before we
 *     get to verify the signature (HMAC is computed over the raw bytes). The
 *     `addRawBodyParser()` helper in main.ts registers a parser that captures
 *     the raw payload onto req.rawBody for this exact URL.
 *   - Signature verification happens in PaymentsService.parseWebhookEvent
 *     using stripe.webhooks.constructEvent (real provider) or an HMAC check
 *     for the stub. A signature mismatch returns 400.
 *   - Idempotency: stripe_events.id is the Stripe event id; INSERT … ON
 *     CONFLICT DO NOTHING short-circuits any retry Stripe sends.
 */
import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { PaymentsService } from './payments.service.js';

@Public()
@Controller('webhooks/stripe')
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: FastifyRequest): Promise<{ received: true; duplicate: boolean }> {
    const sig = req.headers['stripe-signature'];
    const signature = Array.isArray(sig) ? sig[0] : sig;
    if (!signature) {
      throw new BadRequestException({
        code: 'invalid_signature',
        message: 'Missing Stripe-Signature header',
      });
    }
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody;
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new BadRequestException({
        code: 'invalid_signature',
        message: 'Empty webhook body',
      });
    }
    const event = this.payments.parseWebhookEvent(raw, signature);
    const result = await this.payments.handleWebhookEvent(event);
    return { received: true as const, duplicate: result.duplicate };
  }
}
