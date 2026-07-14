/**
 * CapacityEventsListener — the event-driven recompute wiring (no polling).
 *
 * Subscribes to DispatchEventsService and recomputes on anything that
 * moves the ratio: job created / assigned / unassigned / status change,
 * shift start / end / break (driver.status_changed carries breaks), and
 * truck in/out of service. Override + settings changes trigger recompute
 * directly from their services, not through here.
 *
 * A 250ms per-tenant debounce coalesces bursts (assigning a job emits
 * job.assigned AND job.status_changed in one request) into one recompute.
 * After each recompute, effective-band changes fan out to partners.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DISPATCH_EVENTS } from '@ustowdispatch/shared';
import { DispatchEventsService } from '../dispatch/dispatch-events.service.js';
import { CapacityBroadcastService } from './capacity-broadcast.service.js';
import { CapacityComputeService } from './capacity-compute.service.js';

const RECOMPUTE_TRIGGERS = new Set<string>([
  DISPATCH_EVENTS.JOB_CREATED,
  DISPATCH_EVENTS.JOB_ASSIGNED,
  DISPATCH_EVENTS.JOB_UNASSIGNED,
  DISPATCH_EVENTS.JOB_STATUS_CHANGED,
  DISPATCH_EVENTS.JOB_DUTY_CLASS_CHANGED,
  DISPATCH_EVENTS.DRIVER_SHIFT_STARTED,
  DISPATCH_EVENTS.DRIVER_SHIFT_ENDED,
  DISPATCH_EVENTS.DRIVER_STATUS_CHANGED,
  DISPATCH_EVENTS.TRUCK_SERVICE_CHANGED,
]);

const DEBOUNCE_MS = 250;

@Injectable()
export class CapacityEventsListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CapacityEventsListener.name);
  private unsubscribe: (() => void) | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pendingTriggers = new Map<string, string>();

  constructor(
    private readonly dispatchEvents: DispatchEventsService,
    private readonly compute: CapacityComputeService,
    private readonly broadcasts: CapacityBroadcastService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.dispatchEvents.subscribe((tenantId, event) => {
      if (!RECOMPUTE_TRIGGERS.has(event.name)) return;
      this.schedule(tenantId, event.name);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Debounced per tenant; the last trigger name wins the log breadcrumb. */
  schedule(tenantId: string, trigger: string): void {
    this.pendingTriggers.set(tenantId, trigger);
    const existing = this.timers.get(tenantId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      tenantId,
      setTimeout(() => {
        this.timers.delete(tenantId);
        const t = this.pendingTriggers.get(tenantId) ?? trigger;
        this.pendingTriggers.delete(tenantId);
        void this.run(tenantId, t);
      }, DEBOUNCE_MS),
    );
  }

  /** Recompute + fan out. Public so integration tests can drive it synchronously. */
  async run(tenantId: string, trigger: string): Promise<void> {
    const result = await this.compute.recomputeSafe(tenantId, trigger);
    if (!result || result.changedScopes.length === 0) return;
    try {
      await this.broadcasts.onCapacityChanged(tenantId, result.status);
    } catch (err) {
      this.log.error({ msg: 'capacity broadcast fan-out failed', tenantId, err: String(err) });
    }
  }
}
