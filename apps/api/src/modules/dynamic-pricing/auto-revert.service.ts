/**
 * AutoRevertService — hourly cron. Two responsibilities:
 *
 *   1. Deactivate any tier whose `auto_revert_at` is in the past.
 *   2. (Stretch) Surface a T-4hr-to-expiration notification on the
 *      Control Panel. We model "notification" as an entry in a notice
 *      jsonb on tenants.settings.dynamicPricing.expirationNotices so the
 *      UI can render it without a new schema.
 *
 * Cron is gated by DYNAMIC_PRICING_CRON_ENABLED (env). When false, the
 * @Cron decorator still mounts but exits early on each tick.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dynamicPricingTierActivations, dynamicPricingTiers, tenants } from '@ustowdispatch/db';
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';

const SYSTEM_USER_UUID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class AutoRevertService {
  private readonly log = new Logger(AutoRevertService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly config: ConfigService,
    private readonly txRunner: TransactionRunner,
  ) {}

  /**
   * Runs every hour at :03 to dodge the top-of-hour conflict with the
   * weather poller and demand-surge cron.
   */
  @Cron('3 * * * *')
  async tick(): Promise<void> {
    if (!this.config.dynamicPricing.cronEnabled) {
      this.log.debug('AutoRevert: cron disabled by env flag');
      return;
    }
    await this.runForAllTenants();
  }

  /**
   * Public entry point so integration tests can drive the cron without
   * waiting for the @Cron schedule.
   */
  async runForAllTenants(): Promise<{ revertedCount: number }> {
    const allTenants = await this.txRunner.runAsAdmin({}, async (tx) => {
      return tx.query.tenants.findMany({ where: isNull(tenants.deletedAt) });
    });
    let total = 0;
    for (const t of allTenants) {
      total += await this.runForTenant(t.id);
    }
    return { revertedCount: total };
  }

  async runForTenant(tenantId: string): Promise<number> {
    return this.db.runInTenantContext(
      { tenantId, userId: SYSTEM_USER_UUID, requestId: `auto-revert-${tenantId}` },
      async (tx) => {
        const now = new Date();
        const expired = await tx.query.dynamicPricingTiers.findMany({
          where: and(
            eq(dynamicPricingTiers.isActive, true),
            isNotNull(dynamicPricingTiers.autoRevertAt),
            lte(dynamicPricingTiers.autoRevertAt, now),
            isNull(dynamicPricingTiers.deletedAt),
          ),
        });
        for (const tier of expired) {
          await tx
            .update(dynamicPricingTiers)
            .set({ isActive: false, updatedAt: now })
            .where(eq(dynamicPricingTiers.id, tier.id));
          await tx
            .update(dynamicPricingTierActivations)
            .set({
              deactivatedAt: now,
              deactivatedByUserId: SYSTEM_USER_UUID,
              deactivationReason: 'auto-revert (scheduled)',
            })
            .where(
              and(
                eq(dynamicPricingTierActivations.tierId, tier.id),
                isNull(dynamicPricingTierActivations.deactivatedAt),
              ),
            );
        }
        if (expired.length > 0) {
          this.log.log(`auto-revert: deactivated ${expired.length} tier(s) for tenant ${tenantId}`);
        }
        return expired.length;
      },
    );
  }
}
