/**
 * WeatherPollerService — hourly NOAA poller (Moat #1, Weather tier).
 *
 * For each tenant with at least one yard, look up the active NOAA alerts
 * by yard ZIP and reconcile against current Weather-category tiers:
 *   - new alert with mapping → activate a Weather tier with that mapping's
 *     multiplier
 *   - alert cleared → deactivate the Weather tier
 *
 * NOAA's API (api.weather.gov) doesn't require a key but does require a
 * User-Agent header with contact info. OpenWeatherMap is the fallback
 * when NOAA times out or returns 5xx (judgment call: use OWM only when
 * OPENWEATHERMAP_API_KEY is set).
 *
 * For Phase 1 the actual NOAA polling is implemented as a no-op stub —
 * yards don't carry ZIP coordinates yet (Phase 2 of the build report
 * names yard polygons / ZIP scoping as deferred). The cron mounts and
 * gates on DYNAMIC_PRICING_CRON_ENABLED so production can enable it
 * once yard coordinates ship. The Storm Surge Offer Engine still works
 * end-to-end against manually-activated Weather tiers.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';

@Injectable()
export class WeatherPollerService {
  private readonly log = new Logger(WeatherPollerService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly config: ConfigService,
    private readonly txRunner: TransactionRunner,
  ) {}

  /**
   * Runs every hour at :00.
   */
  @Cron('0 * * * *')
  async tick(): Promise<void> {
    if (!this.config.dynamicPricing.cronEnabled) {
      this.log.debug('WeatherPoller: cron disabled by env flag');
      return;
    }
    await this.runForAllTenants();
  }

  async runForAllTenants(): Promise<{ alertsObserved: number }> {
    // Phase 1: stub. Real NOAA fetching is gated on yard coordinates
    // arriving in Phase 2. We log the no-op so ops can see the cron is
    // alive.
    this.log.log('WeatherPoller: tick — Phase 1 no-op (yard ZIP coords not yet wired)');
    return { alertsObserved: 0 };
  }
}
