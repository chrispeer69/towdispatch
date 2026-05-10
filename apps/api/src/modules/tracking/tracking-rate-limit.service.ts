/**
 * Tracking rate limiter — Redis token-bucket-ish counters keyed by
 * (purpose, scope). Used by the public tracking surface where the
 * per-IP global throttler isn't enough (a single hotel network can sit
 * behind one NAT), so we layer per-token + per-IP limits.
 *
 * Limits:
 *   - publicView   : 60 hits / minute per IP per token
 *   - sendMessage  : 10 messages / 5 min per token, AND 30 / hour per token
 *   - submitRating : 5 attempts / 10 min per token (binds + retries on typos)
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

@Injectable()
export class TrackingRateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const fullKey = `track:rl:${key}`;
    const tx = this.redis.multi();
    tx.incr(fullKey);
    tx.ttl(fullKey);
    const result = await tx.exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    const ttl = Number(result?.[1]?.[1] ?? -1);
    if (ttl < 0) {
      // First hit in this window — set the window expiry.
      await this.redis.expire(fullKey, windowSeconds);
    }
    if (count > limit) {
      const retry = ttl > 0 ? ttl : windowSeconds;
      return { allowed: false, remaining: 0, retryAfterSeconds: retry };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: 0,
    };
  }
}
