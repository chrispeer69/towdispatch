/**
 * Sliding-window rate limiter, INCR + EXPIRE in a single MULTI. Used by
 * AuthService for per-email caps that the route-level @Throttle can't express
 * (the throttler keys by IP/route, not by request body).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.tokens.js';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiterService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async check(key: string, limit: number, ttlSeconds: number): Promise<RateLimitResult> {
    const fullKey = `rl:${key}`;
    const multi = this.redis.multi();
    multi.incr(fullKey);
    multi.ttl(fullKey);
    const res = await multi.exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const ttl = Number(res?.[1]?.[1] ?? -1);
    if (count === 1 || ttl === -1) {
      await this.redis.expire(fullKey, ttlSeconds);
    }
    const retryAfter = ttl > 0 ? ttl : ttlSeconds;
    return {
      allowed: count <= limit,
      count,
      retryAfterSeconds: retryAfter,
    };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}
