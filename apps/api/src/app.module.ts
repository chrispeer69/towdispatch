import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import { ObservabilityModule } from './common/observability/observability.module.js';
import { ThrottleModule } from './common/throttle/throttle.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { MotorClubModule } from './integrations/motor-club/motor-club.module.js';
import { NotificationModule } from './integrations/notification/notification.module.js';
import { AccountingModule } from './modules/accounting/accounting.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { DispatchEventsModule } from './modules/dispatch/dispatch-events.module.js';
import { DispatchModule } from './modules/dispatch/dispatch.module.js';
import { EmailModule } from './modules/email/email.module.js';
import { FleetModule } from './modules/fleet/fleet.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ImportModule } from './modules/import/import.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { RatesModule } from './modules/rates/rates.module.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { ServiceCatalogModule } from './modules/service-catalog/service-catalog.module.js';
import { ServiceRatesModule } from './modules/service-rates/service-rates.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { TrackingModule } from './modules/tracking/tracking.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { VehiclesModule } from './modules/vehicles/vehicles.module.js';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    DatabaseModule,
    RedisModule,
    EmailModule,
    ThrottleModule,
    IntegrationsModule,
    MotorClubModule,
    NotificationModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    AccountsModule,
    CustomersModule,
    VehiclesModule,
    RatesModule,
    ServiceCatalogModule,
    ServiceRatesModule,
    DispatchEventsModule,
    JobsModule,
    DispatchModule,
    ChatModule,
    StorageModule,
    FleetModule,
    TrackingModule,
    BillingModule,
    PaymentsModule,
    AccountingModule,
    ImportModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
