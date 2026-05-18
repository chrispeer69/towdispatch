/**
 * DriverExperienceModule — every API surface the in-truck app uses.
 *
 * Composition decision (Session 2): one parent module rather than eight
 * sub-modules. The eight services share enough plumbing — a single
 * driver-JWT guard, shared evidence-storage / stripe-terminal provider
 * tokens, a common DriverContext shape — that splitting them into
 * sibling modules would just multiply the @Module headers without
 * actually decoupling anything. If/when one of these surfaces grows
 * (e.g. payments graduating off the stub) it can be split out cleanly
 * because every service already programs against an interface, not
 * a peer service.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { DriverAuthController } from './driver-auth.controller.js';
import { DriverAuthGuard } from './driver-auth.guard.js';
import { DriverAuthService } from './driver-auth.service.js';
import { DriverBriefingController } from './driver-briefing.controller.js';
import { DriverBriefingService } from './driver-briefing.service.js';
import {
  DriverEvidenceController,
  JobEvidenceListController,
} from './driver-evidence.controller.js';
import { DriverEvidenceService } from './driver-evidence.service.js';
import { DriverFieldPaymentController } from './driver-field-payment.controller.js';
import { DriverFieldPaymentService } from './driver-field-payment.service.js';
import { DriverOfflineSyncController } from './driver-offline-sync.controller.js';
import { DriverOfflineSyncService } from './driver-offline-sync.service.js';
import { DriverOrOperatorAuthGuard } from './driver-or-operator-auth.guard.js';
import { DriverPretripController } from './driver-pretrip.controller.js';
import { DriverPretripService } from './driver-pretrip.service.js';
import { DriverShiftController } from './driver-shift.controller.js';
import { DriverShiftService } from './driver-shift.service.js';
import { DriverTelemetryController } from './driver-telemetry.controller.js';
import { DriverTelemetryService } from './driver-telemetry.service.js';
import type { EvidenceStorageProvider } from './evidence-storage/evidence-storage.provider.js';
import { EVIDENCE_STORAGE_PROVIDER } from './evidence-storage/evidence-storage.tokens.js';
import { LocalStubEvidenceStorageProvider } from './evidence-storage/local-stub-evidence-storage.provider.js';
import { S3EvidenceStorageProvider } from './evidence-storage/s3-evidence-storage.provider.js';
import { STRIPE_TERMINAL_PROVIDER } from './stripe-terminal/stripe-terminal.tokens.js';
import { StubStripeTerminalProvider } from './stripe-terminal/stub-stripe-terminal.provider.js';

@Module({
  imports: [AuthModule, JobsModule, DispatchModule],
  controllers: [
    DriverAuthController,
    DriverBriefingController,
    DriverShiftController,
    DriverPretripController,
    DriverEvidenceController,
    JobEvidenceListController,
    DriverFieldPaymentController,
    DriverTelemetryController,
    DriverOfflineSyncController,
  ],
  providers: [
    DriverAuthService,
    DriverAuthGuard,
    DriverOrOperatorAuthGuard,
    DriverBriefingService,
    DriverShiftService,
    DriverPretripService,
    DriverEvidenceService,
    DriverFieldPaymentService,
    DriverTelemetryService,
    DriverOfflineSyncService,
    {
      provide: EVIDENCE_STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EvidenceStorageProvider => {
        const s3 = config.s3Evidence;
        if (s3.configured) {
          return new S3EvidenceStorageProvider({
            bucket: s3.bucket,
            region: s3.region,
            accessKeyId: s3.accessKeyId || null,
            secretAccessKey: s3.secretAccessKey || null,
            endpoint: s3.endpoint || null,
            forcePathStyle: s3.forcePathStyle,
          });
        }
        return new LocalStubEvidenceStorageProvider(config.apiPublicUrl);
      },
    },
    {
      provide: STRIPE_TERMINAL_PROVIDER,
      // Stub only in Session 2. The real Stripe Terminal SDK lands in a
      // follow-up: "field-payments: replace stub with real Stripe
      // Terminal SDK". Until then every environment uses the stub.
      useClass: StubStripeTerminalProvider,
    },
  ],
})
export class DriverExperienceModule {}
