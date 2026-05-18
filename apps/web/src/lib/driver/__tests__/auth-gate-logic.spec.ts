import { describe, expect, it } from 'vitest';
import { decideAuthGate } from '../auth-gate-logic';

describe('decideAuthGate', () => {
  it('renders public paths without a jwt', () => {
    expect(decideAuthGate({ pathname: '/driver/login', hasJwt: false })).toEqual({
      action: 'render',
    });
    expect(decideAuthGate({ pathname: '/driver/set-pin', hasJwt: false })).toEqual({
      action: 'render',
    });
    expect(decideAuthGate({ pathname: '/driver/locked', hasJwt: false })).toEqual({
      action: 'render',
    });
  });

  it('bounces signed-in users away from the login page', () => {
    expect(decideAuthGate({ pathname: '/driver/login', hasJwt: true })).toEqual({
      action: 'redirect-to-workspace',
    });
  });

  it('renders guarded paths when a jwt is present', () => {
    expect(decideAuthGate({ pathname: '/driver/workspace', hasJwt: true })).toEqual({
      action: 'render',
    });
  });

  it('redirects unauthenticated visitors to login, preserving the original pathname', () => {
    expect(decideAuthGate({ pathname: '/driver/workspace', hasJwt: false })).toEqual({
      action: 'redirect-to-login',
      next: '/driver/workspace',
    });
    expect(decideAuthGate({ pathname: '/driver/jobs/abc-123', hasJwt: false })).toEqual({
      action: 'redirect-to-login',
      next: '/driver/jobs/abc-123',
    });
  });

  it('treats set-pin and locked as public siblings of login', () => {
    expect(decideAuthGate({ pathname: '/driver/locked', hasJwt: true })).toEqual({
      action: 'render',
    });
  });
});
