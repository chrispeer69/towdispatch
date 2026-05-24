/**
 * StorageAutoBillingCron — daily storage auto-billing sweep (Yard
 * Management, Session 54). Env-gated by STORAGE_AUTOBILLING_CRON_ENABLED
 * (default false): the @Cron mounts so the schedule registers, but the body
 * short-circuits when disabled — same pattern as ImpoundFeeAccrualCron.
 *
 * For each tenant with occupied stalls it calls StorageBillingService
 * .runForTenant with up to 3 attempts; each failure is audited (logged) and
 * does not abort the rest of the sweep. tick() is exported so integration
 * tests drive it synchronously.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '../../../config/config.service.js';
import { StorageBillingService } from './storage-billing.service.js';

const MAX_ATTEMPTS = 3;

export interface StorageBillingSweepResult {
  tenantsProcessed: number;
  tenantsFailed: number;
  chargesWritten: number;
  totalChargedCents: number;
}

@Injectable()
export class StorageAutoBillingCron {
  private readonly log = new Logger(StorageAutoBillingCron.name);

  constructor(
    private readonly billing: StorageBillingService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 2 * * *')
  async cronTick(): Promise<StorageBillingSweepResult | null> {
    if (!this.config.storageAutobilling.cronEnabled) {
      this.log.debug('StorageAutoBillingCron: disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  async tick(now: Date = new Date()): Promise<StorageBillingSweepResult> {
    const result: StorageBillingSweepResult = {
      tenantsProcessed: 0,
      tenantsFailed: 0,
      chargesWritten: 0,
      totalChargedCents: 0,
    };
    const tenantIds = await this.billing.tenantsWithOccupiedStalls();
    for (const tenantId of tenantIds) {
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const r = await this.billing.runForTenant(tenantId, now);
          result.tenantsProcessed += 1;
          result.chargesWritten += r.chargesWritten;
          result.totalChargedCents += r.totalChargedCents;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          this.log.warn({
            msg: 'storage billing attempt failed',
            tenantId,
            attempt,
            err: (err as Error).message,
          });
        }
      }
      if (lastErr) result.tenantsFailed += 1;
    }
    this.log.log({ msg: 'storage auto-billing sweep', ...result });
    return result;
  }
}
