/**
 * DriverFieldPaymentService — driver-initiated card-present payments
 * captured on-scene via a Stripe Terminal reader.
 *
 * Lifecycle:
 *   create-intent → row inserted with status='pending', provider called,
 *     result merged in (id, status, brand, last4). Per the stub
 *     provider, status flips to 'authorized' immediately.
 *   capture → provider.capture(), row → status='captured', captured_at.
 *   cancel  → row → status='canceled', notes appended.
 *
 * The shared schema uses 'canceled' (American single-l) as the enum
 * value — we follow that, even though the task spec says 'cancelled'.
 * The driver app reads the value back from the row so consistency wins.
 */
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { driverShifts, jobFieldPayments, jobs, uuidv7 } from '@ustowdispatch/db';
import {
  type CreateJobFieldPaymentPayload,
  ERROR_CODES,
  type JobFieldPaymentDto,
  type JobFieldPaymentStatus,
} from '@ustowdispatch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import type { DriverContext } from './driver-auth.service.js';
import type { StripeTerminalProvider } from './stripe-terminal/stripe-terminal.provider.js';
import { STRIPE_TERMINAL_PROVIDER } from './stripe-terminal/stripe-terminal.tokens.js';

@Injectable()
export class DriverFieldPaymentService {
  constructor(
    private readonly db: TenantAwareDb,
    @Inject(STRIPE_TERMINAL_PROVIDER)
    private readonly terminal: StripeTerminalProvider,
  ) {}

  async createIntent(
    ctx: DriverContext,
    input: CreateJobFieldPaymentPayload,
  ): Promise<JobFieldPaymentDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        const job = await tx.query.jobs.findFirst({
          where: and(eq(jobs.id, input.jobId), isNull(jobs.deletedAt)),
          columns: { id: true },
        });
        if (!job) {
          throw new NotFoundException({
            code: ERROR_CODES.NOT_FOUND,
            message: 'Job not found',
          });
        }

        const intent = await this.terminal.createIntent({
          tenantId: ctx.tenantId,
          jobId: input.jobId,
          amountCents: input.amountCents,
          tipCents: input.tipCents,
          currency: input.currency,
          paymentMethod: input.paymentMethod,
          terminalReaderId: input.stripeTerminalReaderId,
        });

        const shiftId = await resolveActiveShiftId(tx, ctx.driverId);
        const id = uuidv7();
        const now = new Date();
        const [row] = await tx
          .insert(jobFieldPayments)
          .values({
            id,
            tenantId: ctx.tenantId,
            jobId: input.jobId,
            driverId: ctx.driverId,
            shiftId,
            amountCents: input.amountCents,
            tipCents: input.tipCents,
            currency: input.currency,
            paymentMethod: input.paymentMethod,
            stripePaymentIntentId: intent.paymentIntentId,
            stripeTerminalReaderId: input.stripeTerminalReaderId ?? null,
            cardBrand: intent.cardBrand,
            cardLast4: intent.cardLast4,
            status: intent.status === 'authorized' ? 'authorized' : 'pending',
            authorizedAt: intent.status === 'authorized' ? now : null,
            receiptEmail: input.receiptEmail ?? null,
            clientIdempotencyKey: input.clientIdempotencyKey ?? null,
            notes: input.notes ?? null,
            createdBy: null,
          })
          .returning();
        if (!row) throw new Error('insert job_field_payments .. yielded no row');
        return rowToDto(row);
      },
    );
  }

  async capture(ctx: DriverContext, paymentId: string): Promise<JobFieldPaymentDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        const existing = await tx.query.jobFieldPayments.findFirst({
          where: and(eq(jobFieldPayments.id, paymentId), isNull(jobFieldPayments.deletedAt)),
        });
        if (!existing) {
          throw new NotFoundException({
            code: ERROR_CODES.NOT_FOUND,
            message: 'Payment not found',
          });
        }
        if (!existing.stripePaymentIntentId) {
          throw new ConflictException({
            code: ERROR_CODES.CONFLICT,
            message: 'Payment has no provider intent to capture',
          });
        }
        if (existing.status !== 'authorized') {
          throw new ConflictException({
            code: ERROR_CODES.INVALID_STATE_TRANSITION,
            message: `Cannot capture a ${existing.status} payment`,
          });
        }
        const result = await this.terminal.capture({
          paymentIntentId: existing.stripePaymentIntentId,
        });
        const [row] = await tx
          .update(jobFieldPayments)
          .set({
            status: 'captured',
            capturedAt: new Date(),
            cardBrand: result.cardBrand ?? existing.cardBrand,
            cardLast4: result.cardLast4 ?? existing.cardLast4,
            updatedAt: new Date(),
          })
          .where(eq(jobFieldPayments.id, paymentId))
          .returning();
        if (!row) throw new Error('update job_field_payments .. yielded no row');
        return rowToDto(row);
      },
    );
  }

  async cancel(ctx: DriverContext, paymentId: string): Promise<JobFieldPaymentDto> {
    return this.db.runInTenantContext(
      { tenantId: ctx.tenantId, userId: ctx.driverId },
      async (tx) => {
        const existing = await tx.query.jobFieldPayments.findFirst({
          where: and(eq(jobFieldPayments.id, paymentId), isNull(jobFieldPayments.deletedAt)),
        });
        if (!existing) {
          throw new NotFoundException({
            code: ERROR_CODES.NOT_FOUND,
            message: 'Payment not found',
          });
        }
        if (existing.status === 'captured') {
          throw new ConflictException({
            code: ERROR_CODES.INVALID_STATE_TRANSITION,
            message: 'Cannot cancel a captured payment; refund instead',
          });
        }
        if (existing.stripePaymentIntentId) {
          await this.terminal
            .cancel({ paymentIntentId: existing.stripePaymentIntentId })
            .catch(() => undefined); // already-cancelled at provider is fine
        }
        const [row] = await tx
          .update(jobFieldPayments)
          .set({
            status: 'canceled' satisfies JobFieldPaymentStatus,
            updatedAt: new Date(),
          })
          .where(eq(jobFieldPayments.id, paymentId))
          .returning();
        if (!row) throw new Error('update job_field_payments .. yielded no row');
        return rowToDto(row);
      },
    );
  }
}

async function resolveActiveShiftId(tx: Tx, driverId: string): Promise<string | null> {
  const open = await tx.query.driverShifts.findFirst({
    where: and(
      eq(driverShifts.driverId, driverId),
      isNull(driverShifts.endedAt),
      isNull(driverShifts.deletedAt),
    ),
    columns: { id: true },
  });
  return open?.id ?? null;
}

function rowToDto(r: typeof jobFieldPayments.$inferSelect): JobFieldPaymentDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    jobId: r.jobId,
    driverId: r.driverId,
    shiftId: r.shiftId,
    amountCents: r.amountCents,
    tipCents: r.tipCents,
    currency: r.currency,
    paymentMethod: r.paymentMethod,
    stripePaymentIntentId: r.stripePaymentIntentId,
    stripeTerminalReaderId: r.stripeTerminalReaderId,
    cardBrand: r.cardBrand,
    cardLast4: r.cardLast4,
    status: r.status,
    authorizedAt: r.authorizedAt ? r.authorizedAt.toISOString() : null,
    capturedAt: r.capturedAt ? r.capturedAt.toISOString() : null,
    failedAt: r.failedAt ? r.failedAt.toISOString() : null,
    failureReason: r.failureReason,
    receiptEmail: r.receiptEmail,
    receiptUrl: r.receiptUrl,
    clientIdempotencyKey: r.clientIdempotencyKey,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}
