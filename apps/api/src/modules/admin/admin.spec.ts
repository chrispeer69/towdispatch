/**
 * Unit tests for the admin audit-log surface (Session 31 — SOC 2).
 *
 * No database: TenantAwareDb is mocked so these always run in CI. They prove
 *   - the caller's tenant context reaches runInTenantContext (tenant scoping
 *     is wired correctly — RLS does the actual enforcement, tested in
 *     test/audit-trigger.spec.ts against a real DB);
 *   - secret fields are redacted on the way out of the service;
 *   - the controller maps req.requestContext to the service call.
 */
import type { AuditLogQuery } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { REDACTED } from './audit-redaction.js';

// Minimal thenable Drizzle stub: chain methods return self; awaiting resolves
// to the preset result. The service calls select() twice — count then rows.
function thenable<T>(result: T) {
  const b = {
    from: () => b,
    innerJoin: () => b,
    where: () => b,
    orderBy: () => b,
    limit: () => b,
    offset: () => b,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable to mimic a Drizzle query builder
    then: (res: (v: T) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
  };
  return b;
}

const DEFAULT_FILTERS: AuditLogQuery = { page: 1, perPage: 50 };

describe('AdminService.queryAuditLog', () => {
  it('passes the caller tenant context into runInTenantContext and redacts secrets', async () => {
    const auditRow = {
      id: 'a1',
      tenantId: 'tenant-1',
      actorId: 'user-1',
      action: 'UPDATE' as const,
      resourceType: 'users',
      resourceId: 'user-9',
      beforeState: { name: 'Old', password_hash: 'OLD-SECRET' },
      afterState: { name: 'New', password_hash: 'NEW-SECRET', mfa_secret_encrypted: 'AES:x' },
      requestId: 'req-1',
      ipAddress: '10.0.0.1',
      userAgent: 'jest',
      createdAt: new Date('2026-05-24T12:00:00.000Z'),
    };

    const holder: { ctx: { tenantId: string; userId: string } | null } = { ctx: null };
    const select = vi
      .fn()
      .mockImplementationOnce(() => thenable([{ count: 1 }]))
      .mockImplementationOnce(() => thenable([auditRow]));
    const db = {
      runInTenantContext: vi.fn(
        async (ctx: { tenantId: string; userId: string }, work: (tx: unknown) => unknown) => {
          holder.ctx = ctx;
          return work({ select });
        },
      ),
    } as unknown as TenantAwareDb;

    const service = new AdminService(db);
    const result = await service.queryAuditLog(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        requestId: 'req-1',
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
      },
      DEFAULT_FILTERS,
    );

    // Tenant scoping wiring.
    expect(holder.ctx?.tenantId).toBe('tenant-1');
    expect(holder.ctx?.userId).toBe('user-1');

    // Pagination + shape.
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(50);
    expect(result.data[0]?.createdAt).toBe('2026-05-24T12:00:00.000Z');

    // Redaction applied through the service.
    expect(result.data[0]?.afterState?.password_hash).toBe(REDACTED);
    expect(result.data[0]?.afterState?.mfa_secret_encrypted).toBe(REDACTED);
    expect(result.data[0]?.beforeState?.password_hash).toBe(REDACTED);
    expect(result.data[0]?.afterState?.name).toBe('New');
    // No secret value leaks anywhere in the payload.
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

describe('AdminService.queryAnomalies', () => {
  it('tenant-scopes, classifies audit signals, and maps failed-login spikes', async () => {
    // Admin DELETE at 23:00 UTC → both an admin-delete and off-hours activity.
    const auditRows = [
      {
        id: 'ev1',
        actorId: 'admin-1',
        action: 'DELETE' as const,
        resourceType: 'jobs',
        resourceId: 'job-1',
        createdAt: new Date('2026-05-24T23:00:00.000Z'),
        actorEmail: 'admin@acme.test',
        actorRole: 'admin',
      },
    ];
    const spikeRows = [
      {
        userId: 'user-9',
        email: 'locked@acme.test',
        role: 'dispatcher',
        failedLoginCount: 7,
        lockedUntil: new Date('2026-05-24T23:30:00.000Z'),
      },
    ];

    const holder: { ctx: { tenantId: string } | null } = { ctx: null };
    const select = vi
      .fn()
      .mockImplementationOnce(() => thenable(auditRows))
      .mockImplementationOnce(() => thenable(spikeRows));
    const db = {
      runInTenantContext: vi.fn(
        async (ctx: { tenantId: string }, work: (tx: unknown) => unknown) => {
          holder.ctx = ctx;
          return work({ select });
        },
      ),
    } as unknown as TenantAwareDb;

    const result = await new AdminService(db).queryAnomalies(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        requestId: 'req-1',
        ipAddress: null,
        userAgent: null,
      },
      {
        windowDays: 7,
        offHoursStartUtc: 22,
        offHoursEndUtc: 6,
        failedLoginThreshold: 5,
        limit: 200,
      },
    );

    expect(holder.ctx?.tenantId).toBe('tenant-1');
    expect(result.adminDeletes).toHaveLength(1);
    expect(result.adminDeletes[0]?.actorEmail).toBe('admin@acme.test');
    expect(result.offHoursAdminActivity).toHaveLength(1);
    expect(result.offHoursAdminActivity[0]?.hourUtc).toBe(23);
    expect(result.failedLoginSpikes[0]).toMatchObject({
      email: 'locked@acme.test',
      failedLoginCount: 7,
    });
    expect(result.summary).toEqual({
      adminDeletes: 1,
      offHoursAdminActivity: 1,
      failedLoginSpikes: 1,
      truncated: false,
    });
  });
});

describe('AdminController.auditLog', () => {
  it('maps req.requestContext into the service caller context', async () => {
    const queryAuditLog = vi.fn().mockResolvedValue({ data: [], page: 1, perPage: 50, total: 0 });
    const controller = new AdminController({ queryAuditLog } as unknown as AdminService);

    const req = {
      requestContext: {
        tenantId: 'tenant-7',
        userId: 'user-7',
        role: 'auditor',
        requestId: 'req-7',
        ipAddress: '1.2.3.4',
        userAgent: 'ua',
      },
    } as unknown as FastifyRequest;

    await controller.auditLog(DEFAULT_FILTERS, req);

    expect(queryAuditLog).toHaveBeenCalledTimes(1);
    const [ctx, filters] = queryAuditLog.mock.calls[0] ?? [];
    expect(ctx).toMatchObject({ tenantId: 'tenant-7', userId: 'user-7', role: 'auditor' });
    expect(filters).toBe(DEFAULT_FILTERS);
  });
});
