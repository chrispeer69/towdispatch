/**
 * DatabaseModule provides:
 *   - APP_POOL: the runtime pg.Pool, connected as app_user (RLS-enforcing).
 *   - ADMIN_POOL: the ops pg.Pool, connected as the bootstrap superuser.
 *     Reserved for migrations and ops endpoints — never used in request paths.
 *   - TenantAwareDb: a request-scoped Drizzle client that opens a transaction,
 *     calls SET LOCAL with the request's tenant_id and user_id, and exposes
 *     the bound transaction handle for the duration of the request.
 */
import { Global, Module } from '@nestjs/common';
import pg from 'pg';
const { Pool } = pg;
import { ConfigService } from '../config/config.service.js';
import { ADMIN_POOL, APP_POOL } from './database.tokens.js';
import { TenantAwareDb } from './tenant-aware-db.service.js';
import { TransactionRunner } from './transaction-runner.service.js';

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
          application_name: 'towcommand-api',
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
          application_name: 'towcommand-admin',
        }),
      inject: [ConfigService],
    },
    TenantAwareDb,
    TransactionRunner,
  ],
  exports: [APP_POOL, ADMIN_POOL, TenantAwareDb, TransactionRunner],
})
export class DatabaseModule {}
