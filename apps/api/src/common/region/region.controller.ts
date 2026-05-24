/**
 * Region introspection endpoints (Session 44).
 *
 *   GET /admin/region         current region id + role (owner/admin).
 *   GET /admin/region-status  self health + peer-region /ready probe
 *                             (owner/admin). Peer only present when
 *                             PRIMARY_REGION_HEALTHCHECK_URL is set.
 *
 * Authenticated + role-gated (JwtAuthGuard is global; RolesGuard added here).
 * Region identity is ALSO exposed unauthenticated on GET /ready for the
 * failover scripts and load balancers.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ROLES, type RegionInfo, type RegionStatus } from '@ustowdispatch/shared';
import { Roles } from '../decorators/roles.decorator.js';
import { RolesGuard } from '../guards/roles.guard.js';
import { RegionContextService } from './region-context.service.js';

@Controller()
@UseGuards(RolesGuard)
@Roles(ROLES.OWNER, ROLES.ADMIN)
export class RegionController {
  constructor(private readonly region: RegionContextService) {}

  @Get('admin/region')
  info(): RegionInfo {
    const r = this.region.info;
    return { regionId: r.id, role: r.role, isPrimary: r.isPrimary };
  }

  @Get('admin/region-status')
  status(): Promise<RegionStatus> {
    return this.region.status();
  }
}
