/**
 * DotExpiryCron — Full DOT Compliance (Session 37).
 *
 * Daily (06:00 server time — after the impound 02:00 and lien 03:00 ticks).
 * Scans every tenant's drivers for DQ-file items expiring within 60 days
 * (medical certificate, license, MVR) and logs a structured alert summary.
 *
 * Gating: DOT_EXPIRY_CRON_ENABLED env flag (default false). The @Cron
 * decorator still mounts so the schedule registers, but the tick body
 * short-circuits when disabled — same pattern as ImpoundFeeAccrualCron /
 * TierOfferLifecycleCron.
 *
 * Observation-only: the cron NEVER mutates driver or DQ data. It emits a
 * log line per expiring item; wiring those alerts to a notification channel
 * (email / in-app) is deferred (see SESSION_37_DECISIONS.md). Each tenant's
 * scan is independent so one bad row can't abort the sweep.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dotDriverQualifications, drivers } from '@ustowdispatch/db';
import type { DqFileItem } from '@ustowdispatch/shared';
import { isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { dqFileStatus } from './dq-file.logic.js';

export interface ExpiryTickResult {
  driversScanned: number;
  alertsRaised: number;
  byItem: Record<string, number>;
}

@Injectable()
export class DotExpiryCron {
  private readonly log = new Logger(DotExpiryCron.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 6 * * *')
  async cronTick(): Promise<ExpiryTickResult | null> {
    if (!this.config.config.DOT_EXPIRY_CRON_ENABLED) {
      this.log.debug('DotExpiryCron: cron disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  /** Public entry point so integration tests drive the scan synchronously. */
  async tick(now: Date = new Date()): Promise<ExpiryTickResult> {
    const result: ExpiryTickResult = { driversScanned: 0, alertsRaised: 0, byItem: {} };

    // Cross-tenant read — admin bypasses RLS.
    const driverRows = await this.admin.runAsAdmin({}, async (db) =>
      db.query.drivers.findMany({ where: isNull(drivers.deletedAt) }),
    );
    const dqRows = await this.admin.runAsAdmin({}, async (db) =>
      db.query.dotDriverQualifications.findMany({
        where: isNull(dotDriverQualifications.deletedAt),
      }),
    );
    const dqByDriver = new Map(dqRows.map((r) => [r.driverId, r]));

    for (const d of driverRows) {
      result.driversScanned += 1;
      const dq = dqByDriver.get(d.id) ?? null;
      const ext = dq
        ? {
            employmentAppSignedAt: dq.employmentAppSignedAt
              ? dq.employmentAppSignedAt.toISOString()
              : null,
            mvrPulledAt: dq.mvrPulledAt ? dq.mvrPulledAt.toISOString() : null,
            mvrExpiresAt: dq.mvrExpiresAt ? dq.mvrExpiresAt.toISOString() : null,
          }
        : null;
      const status = dqFileStatus(
        {
          cdlClass: d.cdlClass,
          licenseNumber: d.licenseNumber,
          licenseExpiresAt: d.licenseExpiresAt,
          medicalCardExpiresAt: d.medicalCardExpiresAt,
          drugTestLastAt: d.drugTestLastAt,
          roadTestCompletedAt: d.roadTestCompletedAt,
        },
        ext,
        now,
      );
      // Only the dated, expiry-driven items are alert targets.
      const targets: DqFileItem[] = ['license_expiry', 'medical_certificate', 'mvr'];
      for (const e of status.expiring) {
        if (!targets.includes(e.item)) continue;
        result.alertsRaised += 1;
        result.byItem[e.item] = (result.byItem[e.item] ?? 0) + 1;
        this.log.warn({
          msg: 'dot DQ item expiring',
          tenantId: d.tenantId,
          driverId: d.id,
          item: e.item,
          expiresAt: e.expiresAt,
          daysLeft: e.daysLeft,
        });
      }
    }

    this.log.log({ msg: 'dot expiry scan tick', ...result });
    return result;
  }
}
