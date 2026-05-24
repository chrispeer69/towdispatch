/**
 * Unit coverage for GET /admin/sentry-test. It must throw a plain Error
 * (NOT an HttpException) carrying the request id, so the GlobalExceptionFilter
 * routes it through its `instanceof Error` branch → log + Sentry capture + 500.
 * Route-level authorization (OWNER/ADMIN) is enforced by RolesGuard and is not
 * re-tested here.
 */
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { AdminController } from './admin.controller.js';
import type { AdminService } from './admin.service.js';

function reqWith(requestId?: string): FastifyRequest {
  return { requestContext: requestId ? { requestId } : undefined } as unknown as FastifyRequest;
}

describe('AdminController GET /admin/sentry-test', () => {
  it('throws a plain Error (not an HttpException) with the request id', () => {
    const controller = new AdminController({} as unknown as AdminService);
    // sentryTest does not touch AdminService; a stub satisfies the constructor.
    const controller = new AdminController({} as never);
    let thrown: unknown;
    try {
      controller.sentryTest(reqWith('req-abc123'));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('req-abc123');
    // Must be a plain Error so the global filter forwards it to Sentry; an
    // HttpException would short-circuit before the capture branch.
    expect((thrown as { getStatus?: unknown }).getStatus).toBeUndefined();
  });

  it('falls back to "unknown" when no request context is present', () => {
    const controller = new AdminController({} as unknown as AdminService);
    // sentryTest does not touch AdminService; a stub satisfies the constructor.
    const controller = new AdminController({} as never);
    expect(() => controller.sentryTest(reqWith())).toThrow(/unknown/);
  });
});
