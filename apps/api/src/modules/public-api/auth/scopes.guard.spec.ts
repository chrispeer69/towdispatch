import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ApiScope } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import { ScopeGuard } from './scopes.guard.js';

function makeGuard(required: ApiScope[] | undefined): ScopeGuard {
  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
  return new ScopeGuard(reflector);
}

function makeContext(granted: ApiScope[] | undefined): ExecutionContext {
  const req = granted ? { apiKey: { id: 'k', scopes: granted } } : {};
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ScopeGuard', () => {
  it('allows a route with no @Scopes requirement', () => {
    expect(makeGuard(undefined).canActivate(makeContext(['jobs:read']))).toBe(true);
    expect(makeGuard([]).canActivate(makeContext(['jobs:read']))).toBe(true);
  });

  it('allows when the key holds every required scope', () => {
    const guard = makeGuard(['jobs:read']);
    expect(guard.canActivate(makeContext(['jobs:read', 'jobs:write']))).toBe(true);
  });

  it('rejects when a required scope is missing', () => {
    const guard = makeGuard(['jobs:write']);
    expect(() => guard.canActivate(makeContext(['jobs:read']))).toThrow(ForbiddenException);
  });

  it('rejects when the request carries no key scopes at all', () => {
    const guard = makeGuard(['jobs:read']);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
