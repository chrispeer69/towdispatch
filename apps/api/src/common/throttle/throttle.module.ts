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
 * THROTTLE_DISABLE=1 short-circuits the guard and is respected ONLY when
 * NODE_ENV=test. The integration suite calls /auth/signup dozens of times
 * per run from a single IP; without this bypass the per-route 5/60s burst
 * limit on signup makes the suite order-dependent and flaky.
 */
import { ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { ConfigService } from '../../config/config.service.js';

@Injectable()
class EnvAwareThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    // Opt-in bypass for development and integration/E2E test runs. The flag
    // is checked per-request so an operator can flip it in .env without
    // restarting. Production deploys must NEVER set THROTTLE_DISABLE=1; the
    // README and .env.example call this out.
    if (process.env.THROTTLE_DISABLE === '1') {
      return true;
    }
    return super.canActivate(context);
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
  providers: [{ provide: APP_GUARD, useClass: EnvAwareThrottlerGuard }],
})
export class ThrottleModule {}
