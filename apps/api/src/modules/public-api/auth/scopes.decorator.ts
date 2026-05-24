import { SetMetadata } from '@nestjs/common';
import type { ApiScope } from '@ustowdispatch/shared';

export const SCOPES_KEY = 'publicApiScopes';

/**
 * Declares the scopes an API key must hold to call a /v1 route. Enforced by
 * ScopeGuard. Typed against ApiScope so the call site is checked.
 */
export const Scopes = (...scopes: ApiScope[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPES_KEY, scopes);
