/**
 * Public payments controller — no auth, no session.
 *
 * The payment_token in the URL is the unit of authorization. PaymentsService
 * resolves the (tenant_id, invoice_id) pair via the admin pool, then hands
 * off into a tenant-scoped transaction so RLS still applies for every
 * subsequent read/write.
 *
 * Stripe Elements is loaded into the page from Stripe's CDN. We hand the
 * client_secret + connected stripe_account_id + publishable key over the
 * wire; card data never touches our servers. PCI scope: SAQ A.
 */
import { Controller, Get, Req } from '@nestjs/common';
import type { PublicPaymentView } from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodParam } from '../../common/decorators/zod.decorator.js';
import { PaymentsService } from './payments.service.js';

const tokenParam = z.object({
  token: z
    .string()
    .min(20)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
});

@Public()
@Controller('public/pay')
export class PaymentsPublicController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':token')
  async view(
    @ZodParam(tokenParam) params: { token: string },
    @Req() _req: FastifyRequest,
  ): Promise<PublicPaymentView> {
    return this.payments.publicView(params.token);
  }
}
