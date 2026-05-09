import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
/**
 * Global rate-limit guard wired to a Redis-backed throttler. Two named
 * throttlers run in parallel:
 *   - "burst": short window, generous count — catches stampedes.
 *   - "sustained": long window, lower count — catches scrapers.
 *
 * Per-route overrides live as @Throttle({ short: { limit, ttl } }) on the
 * controller method. Auth endpoints layer additional per-email checks via
 * RateLimiterService inside AuthService — those run before the controller
 * is reached when applied as a guard, but for body-keyed limits we run them
 * inside the service so the email is already validated.
 */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { ConfigService } from '../../config/config.service.js';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const limits = config.rateLimits;
        return {
          throttlers: [
            { name: 'burst', ttl: seconds(limits.burstTtl), limit: limits.burstLimit },
            {
              name: 'sustained',
              ttl: seconds(limits.sustainedTtl),
              limit: limits.sustainedLimit,
            },
          ],
          storage: new ThrottlerStorageRedisService(config.redisUrl),
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ThrottleModule {}
