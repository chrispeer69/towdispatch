/**
 * ReportingCacheService — Redis-backed 60-second TTL cache for report
 * results. Keyed by `tenant_id : report_id : sha256(filter_hash)`.
 *
 * Cache invalidation: callers in jobs, invoices, payments, tracking, etc.
 * publish an "entity write" event; we invalidate the namespace prefix for
 * the affected tenant. The DispatchEventsService already broadcasts most of
 * what we care about — we subscribe in ReportingModule and call invalidate().
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

const TTL_SECONDS = 60;
const PREFIX = 'rpt';

@Injectable()
export class ReportingCacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  buildKey(tenantId: string, reportId: string, filters: unknown): string {
    const filterHash = createHash('sha256')
      .update(JSON.stringify(filters ?? {}))
      .digest('hex')
      .slice(0, 16);
    return `${PREFIX}:${tenantId}:${reportId}:${filterHash}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // corrupted cache — drop it silently and re-compute.
      await this.redis.del(key);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl: number = TTL_SECONDS): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
  }

  /**
   * Drop every cached report entry for the tenant. We use SCAN rather than
   * KEYS so we don't block Redis on large datasets — at our scale this is
   * called a few times per minute per tenant.
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    const match = `${PREFIX}:${tenantId}:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  /**
   * Targeted invalidation for a specific report on a specific tenant. Used
   * when we know exactly which report family a write affects (e.g. invoice
   * created -> revenue + tax + storage + commission).
   */
  async invalidateReport(tenantId: string, reportId: string): Promise<void> {
    const match = `${PREFIX}:${tenantId}:${reportId}:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }
}
