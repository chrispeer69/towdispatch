import { describe, expect, it } from 'vitest';
import { ReportingCacheService } from './reporting-cache.service.js';

class FakeRedis {
  store = new Map<string, string>();
  ttls = new Map<string, number>();
  async get(k: string): Promise<string | null> {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  async set(k: string, v: string, _ex: string, ttl: number): Promise<'OK'> {
    this.store.set(k, v);
    this.ttls.set(k, ttl);
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n += 1;
      this.ttls.delete(k);
    }
    return n;
  }
  async scan(cursor: string, _match: string, pattern: string, _count: string, _n: number): Promise<[string, string[]]> {
    if (cursor === '0') {
      const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      return ['0', Array.from(this.store.keys()).filter((k) => re.test(k))];
    }
    return ['0', []];
  }
}

describe('ReportingCacheService', () => {
  it('round-trips a value and invalidates by tenant', async () => {
    const fake = new FakeRedis() as unknown as ConstructorParameters<typeof ReportingCacheService>[0];
    const cache = new ReportingCacheService(fake as any);
    const key = cache.buildKey('tenant-A', 'dispatch:summary', { foo: 1 });
    await cache.set(key, { hello: 'world' });
    expect(await cache.get(key)).toEqual({ hello: 'world' });
    await cache.invalidateTenant('tenant-A');
    expect(await cache.get(key)).toBeNull();
  });

  it('produces stable keys for identical filters', () => {
    const cache = new ReportingCacheService(new FakeRedis() as any);
    const k1 = cache.buildKey('t1', 'revenue:list', { from: '2026-01-01' });
    const k2 = cache.buildKey('t1', 'revenue:list', { from: '2026-01-01' });
    expect(k1).toBe(k2);
  });

  it('produces different keys for different filters', () => {
    const cache = new ReportingCacheService(new FakeRedis() as any);
    const k1 = cache.buildKey('t1', 'revenue:list', { from: '2026-01-01' });
    const k2 = cache.buildKey('t1', 'revenue:list', { from: '2026-02-01' });
    expect(k1).not.toBe(k2);
  });
});
