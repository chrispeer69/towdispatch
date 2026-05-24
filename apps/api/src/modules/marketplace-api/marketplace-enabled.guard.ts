/**
 * MarketplaceEnabledGuard (Session 46) — the single MARKETPLACE_API_ENABLED
 * kill-switch for the entire marketplace surface. Applied to every marketplace
 * controller; when the flag is false every route returns 503 rather than
 * silently accepting OAuth grants, installs, or directory reads. Runs after the
 * global JwtAuthGuard, so operator routes still 401 on a bad token first —
 * acceptable: an attacker without a token learns nothing about the flag.
 */
import { type CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ERROR_CODES } from '@ustowdispatch/shared';
import { ConfigService } from '../../config/config.service.js';

@Injectable()
export class MarketplaceEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (!this.config.marketplaceApiEnabled) {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Marketplace API is disabled',
      });
    }
    return true;
  }
}
