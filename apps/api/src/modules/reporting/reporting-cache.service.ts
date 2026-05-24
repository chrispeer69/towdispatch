/**
 * 60-second Redis cache in front of the report queries.
 *
 * Key shape: reporting:{reportId}:{tenantId}:{filterHash}:{variant}
 * Variants:  'summary' | 'detail'
 *
 * Cache is best-effort. If Redis is down or the SETEX fails we still answer
 * from Postgres — the same shape as how RateLimiterService treats Redis. The
 * caller is unaware of the cache; that lets us flip per-tenant cache off
 * later from config without touching call sites.
 *
 * Invalidation hooks (Session 14 wires the obvious ones — invoice mutations
 * clear revenue/tax; job completion clears dispatch/driver; payment recorded
 * clears revenue) live in the consumer modules calling `invalidate*`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

const TTL_SECONDS = 60;
const PREFIX = 'reporting:';

@Injectable()
export class ReportingCacheService {
  private readonly log = new Logger(ReportingCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.k(key));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.log.warn(`cache get failed: ${(err as Error).message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl = TTL_SECONDS): Promise<void> {
    try {
      await this.redis.setex(this.k(key), ttl, JSON.stringify(value));
    } catch (err) {
      this.log.warn(`cache set failed: ${(err as Error).message}`);
    }
  }

  /** Drop every cached entry for a given report category in a tenant. */
  async invalidateReport(tenantId: string, reportId: string): Promise<void> {
    const pattern = this.k(`${reportId}:${tenantId}:*`);
    await this.scanDel(pattern);
  }

  /** Drop every cached entry for a tenant — used on bulk imports/wipes. */
  async invalidateTenant(tenantId: string): Promise<void> {
    const pattern = this.k(`*:${tenantId}:*`);
    await this.scanDel(pattern);
  }

  private async scanDel(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.log.warn(`cache scan-del failed: ${(err as Error).message}`);
    }
  }

  private k(suffix: string): string {
    return `${PREFIX}${suffix}`;
  }
}
