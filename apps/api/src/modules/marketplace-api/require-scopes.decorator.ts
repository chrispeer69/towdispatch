import { SetMetadata } from '@nestjs/common';
import type { MarketplaceScope } from '@ustowdispatch/shared';

export const MARKETPLACE_SCOPES_KEY = 'marketplaceScopes';

/**
 * Declares the scopes a marketplace-token-guarded route requires. The
 * MarketplaceTokenGuard enforces that ALL listed scopes are present in the
 * install's granted set; otherwise 403 marketplace_scope_not_granted.
 */
export const RequireScopes = (...scopes: MarketplaceScope[]): MethodDecorator & ClassDecorator =>
  SetMetadata(MARKETPLACE_SCOPES_KEY, scopes);
