/**
 * DamageAnalysisModule — Photo Damage Analysis (Session 42).
 *
 * Wires the operator controller, the orchestration service, the retry
 * worker, and the PDF report service. The vision provider is bound by a
 * factory (DAMAGE_PROVIDER) that selects the stub (default) or a live
 * provider from DAMAGE_ANALYSIS_PROVIDER — and, mirroring the payments
 * cutover guard, REFUSES TO BOOT in a live provider mode with no API key
 * rather than silently degrading to the stub (which would send no photos
 * anywhere and quietly never analyze).
 *
 * StorageModule is @Global, so STORAGE_PROVIDER is injectable here without
 * an explicit import. The worker is exported so integration tests drive
 * tick() directly.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AnthropicDamageProvider } from './anthropic.provider.js';
import { DamageAnalysisController } from './damage-analysis.controller.js';
import { DamageAnalysisService } from './damage-analysis.service.js';
import { DAMAGE_PROVIDER } from './damage-analysis.tokens.js';
import { DamageAnalysisWorker } from './damage-analysis.worker.js';
import { DamageReportPdfService } from './damage-report-pdf.service.js';
import { OpenAIDamageProvider } from './openai.provider.js';
import type { DamageProvider } from './provider.js';
import { StubDamageProvider } from './stub.provider.js';

/**
 * Resolve the DamageProvider from config. Exported so the boot-time guard
 * can be unit-tested without the Nest container.
 *
 * @throws Error when a live provider is selected but its API key is missing.
 */
export function selectDamageProvider(config: ConfigService): DamageProvider {
  const cfg = config.damageAnalysis;
  if (cfg.provider === 'anthropic') {
    if (!cfg.anthropic.configured) {
      throw new Error(
        'DAMAGE_ANALYSIS_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing. Set the key ' +
          'before selecting the live Anthropic provider. Refusing to boot rather than silently ' +
          'falling back to the stub (which never analyzes real photos).',
      );
    }
    config.logger.info(
      { provider: 'anthropic', model: cfg.anthropic.model },
      'DamageAnalysisModule: using AnthropicDamageProvider (LIVE)',
    );
    return new AnthropicDamageProvider(cfg.anthropic.apiKey, cfg.anthropic.model);
  }
  if (cfg.provider === 'openai') {
    if (!cfg.openai.configured) {
      throw new Error(
        'DAMAGE_ANALYSIS_PROVIDER=openai but OPENAI_API_KEY is missing. Set the key before ' +
          'selecting the live OpenAI provider. Refusing to boot rather than silently falling ' +
          'back to the stub (which never analyzes real photos).',
      );
    }
    config.logger.info(
      { provider: 'openai', model: cfg.openai.model },
      'DamageAnalysisModule: using OpenAIDamageProvider (LIVE)',
    );
    return new OpenAIDamageProvider(cfg.openai.apiKey, cfg.openai.model);
  }
  config.logger.info({ provider: 'stub' }, 'DamageAnalysisModule: using StubDamageProvider');
  return new StubDamageProvider();
}

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [DamageAnalysisController],
  providers: [
    {
      provide: DAMAGE_PROVIDER,
      useFactory: (config: ConfigService): DamageProvider => selectDamageProvider(config),
      inject: [ConfigService],
    },
    DamageAnalysisService,
    DamageAnalysisWorker,
    DamageReportPdfService,
  ],
  exports: [DamageAnalysisService, DamageAnalysisWorker],
})
export class DamageAnalysisModule {}
