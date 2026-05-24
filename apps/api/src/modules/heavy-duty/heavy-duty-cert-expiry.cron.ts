/**
 * HeavyDutyCertExpiryCron — Heavy-Duty Specialist (Session 36).
 *
 * Runs once a day (04:00 server time). Observation-only: it scans live HD
 * driver certifications, classifies each against a 30-day window, and logs
 * the expiring / expired set (driver + cert id + days remaining — NO PII
 * such as names). It NEVER mutates a cert, deactivates a driver, or sends a
 * notification. The durable surface operators read is the cert-expiry
 * roster report (GET /heavy-duty/reports/cert-expiry); wiring this to the
 * NotificationModule is a documented deferral. Same conservative posture as
 * the lien-advance cron.
 *
 * Gating: HD_CERT_EXPIRY_CRON_ENABLED (default false). The @Cron decorator
 * still mounts so the schedule is registered; the tick body short-circuits
 * when disabled. tick() is public so integration tests drive it directly.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { hdDriverCertifications } from '@ustowdispatch/db';
import { isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { certStatus } from './heavy-duty-eligibility.logic.js';

export interface CertExpiryTickResult {
  scanned: number;
  expiringSoon: number;
  expired: number;
}

/** Days-out window the cron flags on. */
export const CERT_EXPIRY_WINDOW_DAYS = 30;

@Injectable()
export class HeavyDutyCertExpiryCron {
  private readonly log = new Logger(HeavyDutyCertExpiryCron.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 4 * * *')
  async cronTick(): Promise<CertExpiryTickResult | null> {
    if (!this.config.config.HD_CERT_EXPIRY_CRON_ENABLED) {
      this.log.debug('HeavyDutyCertExpiryCron: cron disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  /** Public entry point so integration tests can drive a tick synchronously. */
  async tick(now: Date = new Date()): Promise<CertExpiryTickResult> {
    const today = now.toISOString().slice(0, 10);

    const certs = await this.admin.runAsAdmin({}, async (db) =>
      db.query.hdDriverCertifications.findMany({
        where: isNull(hdDriverCertifications.deletedAt),
        columns: { id: true, tenantId: true, driverId: true, certType: true, expiresAt: true },
      }),
    );

    const result: CertExpiryTickResult = { scanned: certs.length, expiringSoon: 0, expired: 0 };
    for (const c of certs) {
      const { status, daysUntilExpiry } = certStatus(c.expiresAt, today, CERT_EXPIRY_WINDOW_DAYS);
      if (status === 'expiring') {
        result.expiringSoon += 1;
        this.log.warn({
          msg: 'HD cert expiring soon',
          tenantId: c.tenantId,
          certId: c.id,
          driverId: c.driverId,
          certType: c.certType,
          daysUntilExpiry,
        });
      } else if (status === 'expired') {
        result.expired += 1;
        this.log.warn({
          msg: 'HD cert expired',
          tenantId: c.tenantId,
          certId: c.id,
          driverId: c.driverId,
          certType: c.certType,
          daysUntilExpiry,
        });
      }
    }

    this.log.log({ msg: 'HD cert expiry tick', ...result });
    return result;
  }
}
