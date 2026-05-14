/**
 * JobCompletionSyncListener — Session 12.
 *
 * Subscribes to dispatch events. On job.status_changed → completed, the
 * Session 10 BillingModule auto-generates a draft invoice; we then enqueue a
 * customer-sync job for the underlying customer so QBO sees the entity before
 * any related invoice/payment lands. The invoice / payment sync hops occur via
 * the @Optional() AccountingService inject into InvoicesService and
 * PaymentsService — those services call enqueueInvoiceSync / enqueuePaymentSync
 * directly after their writes.
 *
 * The handler short-circuits when there is no active accounting connection,
 * so dev tenants that never connect QBO never accrue dead-letter rows.
 */
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { invoices } from '@ustowdispatch/db';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { DispatchEventsService } from '../dispatch/dispatch-events.service.js';
import { AccountingService } from './accounting.service.js';

@Injectable()
export class JobCompletionSyncListener implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | null = null;
  private readonly logger: Logger;

  constructor(
    private readonly events: DispatchEventsService,
    private readonly accounting: AccountingService,
    private readonly admin: TransactionRunner,
    config: ConfigService,
  ) {
    this.logger = config.logger.child({ component: 'accounting-listener' });
  }

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe(async (tenantId, event) => {
      if (event.name !== 'job.status_changed') return;
      const payload = event.payload as { jobId: string; toStatus: string };
      if (payload.toStatus !== 'completed') return;
      try {
        // Find the invoice that was just auto-generated for this job (if any),
        // and enqueue both the customer and invoice for sync.
        const inv = await this.admin.runAsAdmin({}, async (db) =>
          db.query.invoices.findFirst({ where: eq(invoices.jobId, payload.jobId) }),
        );
        if (!inv) return;
        if (inv.customerId) {
          await this.accounting.enqueueCustomerSync(tenantId, inv.customerId);
        }
        await this.accounting.enqueueInvoiceSync(tenantId, inv.id);
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err), jobId: payload.jobId },
          'enqueue-on-completion failed',
        );
      }
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
