/**
 * Subscribes to dispatch events and auto-generates a draft invoice the first
 * time a job lands in COMPLETED. Mirrors the Session 9 TrackingService event
 * subscription pattern: a single onModuleInit hook, OnModuleDestroy for
 * teardown, and idempotency lives in InvoicesService.generateFromJob().
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DispatchEventsService } from '../dispatch/dispatch-events.service.js';
import { InvoicesService } from './invoices.service.js';

@Injectable()
export class JobCompletionListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(JobCompletionListener.name);
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly events: DispatchEventsService,
    private readonly invoices: InvoicesService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe(async (tenantId, event) => {
      if (event.name !== 'job.status_changed') return;
      const payload = event.payload as { jobId: string; toStatus: string; actorUserId: string | null };
      if (payload.toStatus !== 'completed') return;
      try {
        await this.invoices.generateFromJob(
          {
            tenantId,
            userId: payload.actorUserId ?? '00000000-0000-0000-0000-000000000000',
            requestId: `event:${payload.jobId}`,
            ipAddress: null,
            userAgent: null,
          },
          payload.jobId,
        );
      } catch (err) {
        this.log.warn(
          `auto-generate invoice failed for job=${payload.jobId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
