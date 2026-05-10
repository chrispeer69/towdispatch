import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import { ThrottleModule } from './common/throttle/throttle.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { NotificationModule } from './integrations/notification/notification.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DispatchEventsModule } from './modules/dispatch/dispatch-events.module.js';
import { DispatchModule } from './modules/dispatch/dispatch.module.js';
import { EmailModule } from './modules/email/email.module.js';
import { FleetModule } from './modules/fleet/fleet.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { RatesModule } from './modules/rates/rates.module.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { TrackingModule } from './modules/tracking/tracking.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { VehiclesModule } from './modules/vehicles/vehicles.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    EmailModule,
    ThrottleModule,
    IntegrationsModule,
    NotificationModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    AccountsModule,
    CustomersModule,
    VehiclesModule,
    RatesModule,
    DispatchEventsModule,
    JobsModule,
    DispatchModule,
    StorageModule,
    FleetModule,
    TrackingModule,
    BillingModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
