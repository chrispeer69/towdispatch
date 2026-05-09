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
 *
 * Under vitest we install a NoopThrottlerGuard so neither the global config
 * nor per-route @Throttle decorators 429 the test suite. Several test specs
 * run in parallel forks and share the same Redis, which burns any realistic
 * per-IP window. Per-email auth limits in AuthService still enforce sane
 * caps where they actually matter (and have their own integration coverage).
 */
import { type CanActivate, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { ConfigService } from '../../config/config.service.js';

const isTestEnv = (): boolean =>
  process.env.NODE_ENV === 'test' ||
  process.env.VITEST === 'true' ||
  !!process.env.VITEST_POOL_ID ||
  process.argv.some((a) => a.includes('vitest'));

@Injectable()
class NoopThrottlerGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

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
  providers: [
    {
      provide: APP_GUARD,
      useClass: isTestEnv() ? NoopThrottlerGuard : ThrottlerGuard,
    },
  ],
})
export class ThrottleModule {}
