/**
 * DatabaseModule provides:
 *   - APP_POOL: the runtime pg.Pool, connected as app_user (RLS-enforcing).
 *   - ADMIN_POOL: the ops pg.Pool, connected as the bootstrap superuser.
 *     Reserved for migrations and ops endpoints — never used in request paths.
 *   - TenantAwareDb: a request-scoped Drizzle client that opens a transaction,
 *     calls SET LOCAL with the request's tenant_id and user_id, and exposes
 *     the bound transaction handle for the duration of the request.
 *
 * Slow-query logging: when ObservabilityModule is loaded ahead of this
 * module, PoolBinder subscribes to APP_POOL.connect and wraps every fresh
 * PoolClient.query so calls past the threshold log at WARN. ADMIN_POOL is
 * left untouched — it's an ops escape hatch, not a request path.
 */
import { Global, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
const { Pool } = pg;
import { SlowQueryService } from '../common/observability/slow-query.service.js';
import { ConfigService } from '../config/config.service.js';
import { ADMIN_POOL, APP_POOL, REPLICA_POOL } from './database.tokens.js';
import { TenantAwareDb } from './tenant-aware-db.service.js';
import { TransactionRunner } from './transaction-runner.service.js';

@Injectable()
class PoolBinder implements OnModuleInit {
  constructor(
    @Inject(APP_POOL) private readonly appPool: pg.Pool,
    @Inject(REPLICA_POOL) private readonly replicaPool: pg.Pool,
    private readonly slowQuery: SlowQueryService,
  ) {}
  onModuleInit(): void {
    this.appPool.on('connect', (client) => this.slowQuery.wrapClient(client));
    // Only wrap the replica when it's a DISTINCT pool — when no read replica
    // is configured REPLICA_POOL is the very same APP_POOL instance and is
    // already wrapped above (double-wrapping would log every query twice).
    if (this.replicaPool !== this.appPool) {
      this.replicaPool.on('connect', (client) => this.slowQuery.wrapClient(client));
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_POOL,
      useFactory: (config: ConfigService) =>
        new Pool({
          connectionString: config.databaseUrl,
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          application_name: 'ustowdispatch-api',
        }),
      inject: [ConfigService],
    },
    {
      provide: ADMIN_POOL,
      useFactory: (config: ConfigService) =>
        new Pool({
          connectionString: config.databaseAdminUrl,
          max: 4,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          application_name: 'ustowdispatch-admin',
        }),
      inject: [ConfigService],
    },
    {
      // Read-replica pool (Session 44). When no DISTINCT DATABASE_READ_URL is
      // set we return the SAME APP_POOL instance — every existing single-region
      // deploy keeps exactly one runtime pool, no doubled connection slots. A
      // separate, smaller pool is created only when a real replica is wired.
      provide: REPLICA_POOL,
      useFactory: (config: ConfigService, appPool: pg.Pool) =>
        config.readReplicaConfigured
          ? new Pool({
              connectionString: config.databaseReadUrl,
              max: 10,
              idleTimeoutMillis: 30_000,
              connectionTimeoutMillis: 5_000,
              application_name: 'ustowdispatch-api-replica',
            })
          : appPool,
      inject: [ConfigService, APP_POOL],
    },
    TenantAwareDb,
    TransactionRunner,
    PoolBinder,
  ],
  exports: [APP_POOL, ADMIN_POOL, REPLICA_POOL, TenantAwareDb, TransactionRunner],
})
export class DatabaseModule {}
