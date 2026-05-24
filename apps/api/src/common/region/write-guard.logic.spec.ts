/**
 * Write-guard decision logic — unit coverage. Pins the rule that drives the
 * Fastify hook: secondary blocks tenant writes, allows reads + exempt paths;
 * primary never blocks. Also covers the Location builder.
 */
import { describe, expect, it } from 'vitest';
import {
  WRITE_GUARD_EXEMPT_PREFIXES,
  buildPrimaryLocation,
  evaluateWriteGuard,
} from './write-guard.logic.js';

describe('evaluateWriteGuard', () => {
  it('allows GET on a secondary (replicas serve reads)', () => {
    const d = evaluateWriteGuard({ method: 'GET', url: '/jobs', isPrimary: false });
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe('read-method');
  });

  it('allows HEAD and OPTIONS on a secondary', () => {
    for (const method of ['HEAD', 'OPTIONS']) {
      expect(evaluateWriteGuard({ method, url: '/jobs', isPrimary: false }).blocked).toBe(false);
    }
  });

  it('blocks POST on a secondary (tenant write)', () => {
    const d = evaluateWriteGuard({ method: 'POST', url: '/jobs', isPrimary: false });
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('secondary-write');
  });

  it('blocks PUT/PATCH/DELETE on a secondary', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(evaluateWriteGuard({ method, url: '/jobs/123', isPrimary: false }).blocked).toBe(true);
    }
  });

  it('is case-insensitive on the method', () => {
    expect(evaluateWriteGuard({ method: 'post', url: '/jobs', isPrimary: false }).blocked).toBe(
      true,
    );
  });

  it('NEVER blocks on the primary, even for writes', () => {
    const d = evaluateWriteGuard({ method: 'POST', url: '/jobs', isPrimary: true });
    expect(d.blocked).toBe(false);
    expect(d.reason).toBe('primary');
  });

  it('exempts operational paths from the block on a secondary', () => {
    for (const prefix of WRITE_GUARD_EXEMPT_PREFIXES) {
      const d = evaluateWriteGuard({ method: 'POST', url: prefix, isPrimary: false });
      expect(d.blocked, `${prefix} should be exempt`).toBe(false);
      expect(d.reason).toBe('exempt-path');
    }
  });

  it('exempts sub-paths of exempt prefixes but not lookalikes', () => {
    expect(
      evaluateWriteGuard({ method: 'POST', url: '/admin/region/x', isPrimary: false }).blocked,
    ).toBe(false);
    // '/admin/regions' is NOT '/admin/region' nor a sub-path of it → blocked.
    expect(
      evaluateWriteGuard({ method: 'POST', url: '/admin/regions', isPrimary: false }).blocked,
    ).toBe(true);
  });

  it('strips the query string before matching', () => {
    const d = evaluateWriteGuard({ method: 'POST', url: '/ready?verbose=1', isPrimary: false });
    expect(d.blocked).toBe(false);
  });
});

describe('buildPrimaryLocation', () => {
  it('joins peer origin and path', () => {
    expect(buildPrimaryLocation('https://api.example.com', '/jobs')).toBe(
      'https://api.example.com/jobs',
    );
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(buildPrimaryLocation('https://api.example.com/', '/jobs')).toBe(
      'https://api.example.com/jobs',
    );
  });

  it('returns null when the peer origin is unknown', () => {
    expect(buildPrimaryLocation('', '/jobs')).toBeNull();
  });
});
