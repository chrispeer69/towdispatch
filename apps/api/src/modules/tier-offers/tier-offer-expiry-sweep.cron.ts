/**
 * TierOfferExpirySweepCron — nightly sweep that flips in-flight recipients
 * whose magic-link TTL has elapsed into the terminal `expired` state.
 *
 * Gated by TIER_OFFER_CRON_ENABLED (env, default false): the @Cron handler
 * still mounts but exits early on every tick when disabled, so dev/CI never
 * fire it. Production flips the flag in Railway.
 *
 * Idempotent: only recipients currently in sent/delivered/opened with
 * magic_link_expires_at <= now are touched (matches the partial index
 * tier_offer_recipients_tenant_expiry_active_idx). Re-running the sweep is
 * a no-op because expired rows have left that status set.
 *
 * Runs once nightly at 02:30 — off-peak and clear of the dynamic-pricing
 * crons that fire hourly at :00 / :03 / :05.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { tenants } from '@ustowdispatch/db';
import { isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { TierOfferRepository } from './tier-offer.repository.js';

const SYSTEM_USER_UUID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class TierOfferExpirySweepCron {
  private readonly log = new Logger(TierOfferExpirySweepCron.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
    private readonly repo: TierOfferRepository,
  ) {}

  @Cron('30 2 * * *')
  async tick(): Promise<void> {
    if (!this.config.tierOffers.cronEnabled) {
      this.log.debug('TierOfferExpirySweep: cron disabled by env flag');
      return;
    }
    await this.runForAllTenants();
  }

  /**
   * Public entry point so integration tests can drive the sweep without
   * waiting on the @Cron schedule.
   */
  async runForAllTenants(now: Date = new Date()): Promise<{ expiredCount: number }> {
    const allTenants = await this.admin.runAsAdmin({}, async (tx) =>
      tx.query.tenants.findMany({ where: isNull(tenants.deletedAt) }),
    );
    let total = 0;
    for (const t of allTenants) {
      total += await this.runForTenant(t.id, now);
    }
    if (total > 0) {
      this.log.log(`TierOfferExpirySweep: expired ${total} recipient link(s) across all tenants`);
    }
    return { expiredCount: total };
  }

  async runForTenant(tenantId: string, now: Date = new Date()): Promise<number> {
    return this.db.runInTenantContext(
      { tenantId, userId: SYSTEM_USER_UUID, requestId: `tier-offer-expiry-${tenantId}` },
      async (tx) => {
        const expirable = await this.repo.findExpirableRecipients(tx, now);
        for (const r of expirable) {
          await this.repo.updateRecipient(tx, r.id, { status: 'expired' });
        }
        if (expirable.length > 0) {
          this.log.log(
            `TierOfferExpirySweep: expired ${expirable.length} recipient(s) for tenant ${tenantId}`,
          );
        }
        return expirable.length;
      },
    );
  }
}
