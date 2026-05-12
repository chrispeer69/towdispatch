/**
 * SlowQueryService unit coverage. We construct a fake pg client, wrap it,
 * and assert that the wrapper times queries and logs WARN above threshold.
 * Param scrubbing is the other thing worth pinning down — UUIDs pass
 * through, PII-suspect strings get redacted to a length tag.
 */
import { describe, expect, it, vi } from 'vitest';
import { MetricsService } from './metrics.service.js';
import { SlowQueryService } from './slow-query.service.js';

const makeConfig = (thresholdMs: number) => {
  const warn = vi.fn();
  const logger = {
    warn,
    info: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return {
    logger,
    slowQueryThresholdMs: thresholdMs,
    slowEndpointThresholdMs: 1000,
    // biome-ignore lint/suspicious/noExplicitAny: minimal config stub
  } as any;
};

describe('SlowQueryService', () => {
  // Tests treat the wrapped client as `any` because node-postgres's query()
  // is heavily overloaded and we want to exercise the slow path with real
  // arg shapes (text + params) without contorting the spec around the typing.
  type AnyClient = { query: (...args: unknown[]) => Promise<unknown> };

  it('does not log when the query is under threshold', async () => {
    const config = makeConfig(50);
    const svc = new SlowQueryService(config, new MetricsService());
    const client: AnyClient = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    svc.wrapClient(client);
    await client.query('SELECT 1');
    expect(config.logger.warn).not.toHaveBeenCalled();
  });

  it('logs WARN when the query exceeds the threshold', async () => {
    const config = makeConfig(5);
    const svc = new SlowQueryService(config, new MetricsService());
    const client: AnyClient = {
      query: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 25));
        return { rows: [], rowCount: 0 };
      }),
    };
    svc.wrapClient(client);
    await client.query('SELECT * FROM customers WHERE tenant_id = $1 AND id = $2', [
      '11111111-2222-3333-4444-555555555555',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ]);
    expect(config.logger.warn).toHaveBeenCalledTimes(1);
    const arg = config.logger.warn.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.slow).toBe(true);
    expect(arg.query).toContain('FROM customers');
    expect(arg.params).toEqual([
      '11111111-2222-3333-4444-555555555555',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ]);
  });

  it('redacts PII params when the query hints at PII columns', async () => {
    const config = makeConfig(1);
    const svc = new SlowQueryService(config, new MetricsService());
    const client: AnyClient = {
      query: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { rows: [], rowCount: 0 };
      }),
    };
    svc.wrapClient(client);
    await client.query('SELECT id FROM users WHERE lower(email) = $1 AND password_hash = $2', [
      'founder@example.com',
      '$argon2id$v=19$m=4096,t=3,p=1$abc...def',
    ]);
    const arg = config.logger.warn.mock.calls[0][0] as { params: string[] };
    expect(arg.params[0]).toMatch(/^<str:\d+>$/);
    expect(arg.params[1]).toMatch(/^<str:\d+>$/);
  });
});
