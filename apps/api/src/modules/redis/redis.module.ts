/**
 * Redis is used for two things in Session 2.0:
 *   - the @nestjs/throttler storage backend (see ThrottlerStorageRedisService)
 *   - per-email rate-limit counters in AuthService (login attempts, forgot,
 *     resend-verification) that are scoped tighter than the global throttler.
 *
 * The client is global so any service can inject REDIS_CLIENT without further
 * module wiring.
 */
import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '../../config/config.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { REDIS_CLIENT } from './redis.tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) =>
        new Redis(config.redisUrl, {
          lazyConnect: false,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        }),
      inject: [ConfigService],
    },
    RateLimiterService,
  ],
  exports: [REDIS_CLIENT, RateLimiterService],
})
export class RedisModule {}
