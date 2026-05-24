/**
 * V1Service (Session 46) — backs the demo public resource surface (/v1/*).
 *
 * This exists so the OAuth flow is exercised end-to-end against a REAL,
 * tenant-isolated read — not just token issuance. When the Session 29 public
 * REST API merges, its resource controllers adopt MarketplaceTokenGuard +
 * @RequireScopes and this demo service is retired (🟡, SESSION_46_DECISIONS).
 */
import { Injectable } from '@nestjs/common';
import type { TokenIdentity } from '@ustowdispatch/shared';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

export interface JobsSummary {
  tenantId: string;
  appSlug: string;
  jobCount: number;
}

@Injectable()
export class V1Service {
  constructor(private readonly db: TenantAwareDb) {}

  /**
   * Tenant-scoped job count, read under the install's tenant context. RLS
   * guarantees the app sees ONLY its install's tenant — proof the token is
   * never tenant-elevated.
   */
  async jobsSummary(identity: TokenIdentity): Promise<JobsSummary> {
    const ctx = { tenantId: identity.tenantId, userId: identity.installId };
    const jobCount = await this.db.runReadOnly(ctx, async (_db, client) => {
      const r = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM jobs');
      return r.rows[0]?.n ?? 0;
    });
    return { tenantId: identity.tenantId, appSlug: identity.appSlug, jobCount };
  }
}
