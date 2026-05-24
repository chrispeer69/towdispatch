/**
 * DotModule — Full DOT Compliance (Session 37).
 *
 * Wires the operator-side controller, the orchestration service, the audit
 * packet PDF renderer, and the daily expiry-alert cron.
 * ScheduleModule.forRoot() is idempotent across modules (AR / Impound /
 * TierOffers already import it). The cron is exported so integration tests
 * can drive tick() directly.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { DotAuditPacketRenderer } from './dot-audit-packet.renderer.js';
import { DotExpiryCron } from './dot-expiry.cron.js';
import { DotController } from './dot.controller.js';
import { DotService } from './dot.service.js';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [DotController],
  providers: [DotService, DotAuditPacketRenderer, DotExpiryCron],
  exports: [DotService, DotExpiryCron],
})
export class DotModule {}
