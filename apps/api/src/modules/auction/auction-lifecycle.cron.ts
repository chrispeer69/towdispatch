/**
 * AuctionLifecycleCron — Auction & Remarketing Marketplace (Session 33).
 *
 * Runs every 5 minutes. For every live listing whose window has closed
 * (list_ends_at <= now), it transitions the listing out of `live`: the
 * highest bid that clears reserve wins (status `sold`, winning_bid_id set,
 * is_winning flagged), otherwise the listing ends unsold (status `ended`)
 * for manual staff review. Winner / loser / staff notifications are sent
 * best-effort after each close commits.
 *
 * Gating: AUCTION_LIFECYCLE_CRON_ENABLED (default false). The @Cron
 * decorator still mounts so the schedule registers, but the body
 * short-circuits when disabled — same pattern as ImpoundFeeAccrualCron.
 *
 * Each listing is closed in its own admin transaction so one bad row can't
 * roll back the whole sweep. The close re-locks the row and re-checks
 * status, so a listing already closed by a racing manual action is skipped.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { auctionListings } from '@ustowdispatch/db';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import type { Tx } from '../../database/tenant-aware-db.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { AuctionService } from './auction.service.js';

export interface LifecycleTickResult {
  scanned: number;
  closed: number;
  sold: number;
}

@Injectable()
export class AuctionLifecycleCron {
  private readonly log = new Logger(AuctionLifecycleCron.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
    private readonly service: AuctionService,
  ) {}

  @Cron('*/5 * * * *')
  async cronTick(): Promise<LifecycleTickResult | null> {
    if (!this.config.auction.cronEnabled) {
      this.log.debug('AuctionLifecycleCron: cron disabled by env flag');
      return null;
    }
    return this.tick(new Date());
  }

  /** Public entry point so integration tests drive the lifecycle synchronously. */
  async tick(now: Date = new Date()): Promise<LifecycleTickResult> {
    const result: LifecycleTickResult = { scanned: 0, closed: 0, sold: 0 };

    const due = await this.admin.runAsAdmin({}, async (db) =>
      db.query.auctionListings.findMany({
        where: and(
          eq(auctionListings.status, 'live'),
          lte(auctionListings.listEndsAt, now),
          isNull(auctionListings.deletedAt),
        ),
        columns: { id: true },
      }),
    );
    result.scanned = due.length;

    for (const { id } of due) {
      try {
        const closed = await this.admin.runAsAdmin({}, async (db) =>
          this.service.closeLiveListing(db as unknown as Tx, id, now),
        );
        result.closed += 1;
        if (closed.notify.sold) result.sold += 1;
        await this.service.flushCloseNotifications(closed.notify);
      } catch (err) {
        // A listing closed by a racing manual action throws "not live" — skip.
        this.log.warn({
          msg: 'auction lifecycle close skipped',
          listingId: id,
          err: (err as Error).message,
        });
      }
    }

    this.log.log({ msg: 'auction lifecycle tick', ...result });
    return result;
  }
}
