/**
 * WebhookDeliveryCron — sweeps due webhook deliveries once a minute.
 *
 * Gating: WEBHOOK_DELIVERY_ENABLED (default false). The @Cron decorator still
 * mounts so the schedule is registered, but the body short-circuits when
 * disabled — same pattern as ImpoundFeeAccrualCron / TierOfferLifecycleCron.
 * Manual test-send / retry actions bypass this flag (they're explicit operator
 * intent and go straight through WebhookDeliveryWorker).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '../../../config/config.service.js';
import { type SweepResult, WebhookDeliveryWorker } from './webhook-delivery.worker.js';

@Injectable()
export class WebhookDeliveryCron {
  private readonly log = new Logger(WebhookDeliveryCron.name);
  private running = false;

  constructor(
    private readonly worker: WebhookDeliveryWorker,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cronTick(): Promise<SweepResult | null> {
    if (!this.config.publicApi.deliveryEnabled) {
      this.log.debug('WebhookDeliveryCron: disabled by env flag');
      return null;
    }
    // Guard against overlap if a sweep runs long (large backlog + slow sinks).
    if (this.running) {
      this.log.warn('WebhookDeliveryCron: previous sweep still running, skipping tick');
      return null;
    }
    this.running = true;
    try {
      return await this.worker.sweep(new Date());
    } finally {
      this.running = false;
    }
  }
}
