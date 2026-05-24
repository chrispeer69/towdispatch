/**
 * AccountingModule — Session 12 QuickBooks Online integration.
 *
 * Wires:
 *   - ACCOUNTING_PROVIDER: live QboProvider when QBO_CLIENT_ID is set,
 *     QboStubProvider otherwise (mirrors PaymentsModule's stripe/stub pattern).
 *   - SyncEngineService: claim/process/retry/backoff orchestration.
 *   - AccountingService: connection lifecycle, mapping, sync entry points.
 *   - AccountingController + AccountingWebhookController.
 *   - JobCompletionSyncListener: bridges dispatch events to the sync engine.
 *
 * @Global so InvoicesService and PaymentsService can `@Optional() inject
 * AccountingService` without each of those modules importing AccountingModule
 * directly. The optional inject avoids a hard dependency in tests that
 * deliberately do not include AccountingModule.
 */
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import type { AccountingProvider } from '../../integrations/accounting/accounting-provider.interface.js';
import { DispatchEventsModule } from '../dispatch/dispatch-events.module.js';
import { AccountingWebhookController } from './accounting-webhook.controller.js';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
import { ACCOUNTING_PROVIDER } from './accounting.tokens.js';
import { JobCompletionSyncListener } from './job-completion-sync.listener.js';
import { QboStubProvider } from './qbo-stub.provider.js';
import { QboProvider } from './qbo.provider.js';
import { SyncEngineService } from './sync-engine.service.js';
import { TokenEncryptionService } from './token-encryption.service.js';

@Global()
@Module({
  imports: [DispatchEventsModule],
  controllers: [AccountingController, AccountingWebhookController],
  providers: [
    TokenEncryptionService,
    {
      provide: ACCOUNTING_PROVIDER,
      useFactory: (config: ConfigService): AccountingProvider => {
        const qbo = config.quickbooks;
        if (qbo.configured) {
          try {
            return new QboProvider({
              clientId: qbo.clientId,
              clientSecret: qbo.clientSecret,
              appcenterBase: qbo.appcenterBase,
              oauthBase: qbo.oauthBase,
              apiBase: qbo.apiBase,
            });
          } catch (err) {
            config.logger.warn(
              { err: String(err) },
              'QboProvider failed to initialize — falling back to stub',
            );
          }
        }
        config.logger.info(
          { qboConfigured: qbo.configured },
          'AccountingModule: using QboStubProvider',
        );
        return new QboStubProvider();
      },
      inject: [ConfigService],
    },
    SyncEngineService,
    AccountingService,
    JobCompletionSyncListener,
  ],
  exports: [AccountingService, SyncEngineService, ACCOUNTING_PROVIDER],
})
export class AccountingModule {}
