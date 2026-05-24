/**
 * YardEnabledGuard (Session 54) — the YARD_MANAGEMENT_ENABLED kill-switch
 * for the entire yard surface. Defaults true (the module is additive over
 * S22 impound), but an operator can flip it off per environment; when off
 * every yard route returns 503. Mirrors MarketplaceEnabledGuard.
 */
import { type CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ERROR_CODES } from '@ustowdispatch/shared';
import { ConfigService } from '../../config/config.service.js';

@Injectable()
export class YardEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (!this.config.yardManagement.enabled) {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Yard Management is disabled',
      });
    }
    return true;
  }
}
