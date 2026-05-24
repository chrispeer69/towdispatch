/**
 * InstallsService (Session 46) — the tenant-operator side of the marketplace.
 *
 * Listing and uninstalling installed apps run in the operator's TENANT context
 * (RLS-enforced): an operator only ever sees/mutates their own tenant's
 * installs. The global marketplace_apps table has no RLS, so it can be joined
 * directly inside the tenant transaction. Uninstall revokes the OAuth tokens
 * (nulls the hashes) and records an `uninstall` event + webhook.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type BeginInstallPayload,
  type BeginInstallResult,
  ERROR_CODES,
  type InstalledAppDto,
  type MarketplaceScope,
  scopesContained,
} from '@ustowdispatch/shared';
import { TenantAwareDb, type TenantContextValues } from '../../database/tenant-aware-db.service.js';
import { type InstalledAppRow, toInstalledAppDto } from './marketplace.mappers.js';
import { WebhookDeliveryService } from './webhook-delivery.service.js';

export interface OperatorCtx {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Map the controller's operator context onto the DB tenant-context values
 * (which use `undefined`, not `null`, for the optional request metadata). */
const toTenantCtx = (ctx: OperatorCtx): TenantContextValues => ({
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  requestId: ctx.requestId,
  ipAddress: ctx.ipAddress ?? undefined,
  userAgent: ctx.userAgent ?? undefined,
});

@Injectable()
export class InstallsService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly webhooks: WebhookDeliveryService,
  ) {}

  /**
   * Resolve the OAuth params for installing an app. Read-only; the actual
   * token grant happens via /oauth/authorize → /oauth/token (PKCE client-side).
   */
  async begin(slug: string, body: BeginInstallPayload): Promise<BeginInstallResult> {
    const app = await this.db.runAnonymous(async (_db, client) => {
      const r = await client.query<{ id: string; slug: string; scopes: string[] }>(
        `SELECT id, slug, scopes FROM marketplace_apps
          WHERE lower(slug) = lower($1) AND status = 'listed' AND deleted_at IS NULL`,
        [slug],
      );
      return r.rows[0] ?? null;
    });
    if (!app) {
      throw new NotFoundException({
        code: ERROR_CODES.MARKETPLACE_APP_NOT_LISTED,
        message: 'App is not available for install',
      });
    }
    const appScopes = Array.isArray(app.scopes) ? app.scopes : [];
    if (!scopesContained(body.scopes, appScopes)) {
      throw new NotFoundException({
        code: ERROR_CODES.OAUTH_INVALID_SCOPE,
        message: 'Requested scopes exceed what the app declares',
      });
    }
    return {
      clientId: app.id,
      appSlug: app.slug,
      approvedScopes: body.scopes as MarketplaceScope[],
      authorizeEndpoint: '/oauth/authorize',
    };
  }

  async listInstalled(ctx: OperatorCtx): Promise<InstalledAppDto[]> {
    const rows = await this.db.runInTenantContext(toTenantCtx(ctx), async (_db, client) => {
      const r = await client.query<InstalledAppRow>(
        `SELECT i.id, i.app_id, a.slug AS app_slug, a.name AS app_name, i.status,
                i.scopes_granted, i.installed_by_user_id, i.installed_at, i.uninstalled_at
           FROM marketplace_app_installs i
           JOIN marketplace_apps a ON a.id = i.app_id
          WHERE i.deleted_at IS NULL
          ORDER BY i.installed_at DESC`,
      );
      return r.rows;
    });
    return rows.map(toInstalledAppDto);
  }

  async uninstall(ctx: OperatorCtx, installId: string): Promise<void> {
    const result = await this.db.runInTenantContext(toTenantCtx(ctx), async (_db, client) => {
      const r = await client.query<{
        app_id: string;
        webhook_url: string | null;
        webhook_secret: string | null;
      }>(
        `UPDATE marketplace_app_installs i
            SET status = 'uninstalled',
                uninstalled_at = now(),
                oauth_access_token_hash = NULL,
                oauth_refresh_token_hash = NULL,
                access_token_expires_at = NULL
           FROM marketplace_apps a
          WHERE i.id = $1
            AND i.app_id = a.id
            AND i.status = 'active'
            AND i.deleted_at IS NULL
        RETURNING i.app_id, a.webhook_url, a.webhook_secret`,
        [installId],
      );
      return r.rows[0] ?? null;
    });
    if (!result) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Active install not found',
      });
    }

    await this.webhooks.emit({
      tenantId: ctx.tenantId,
      appId: result.app_id,
      installId,
      eventType: 'uninstall',
      payload: { by: ctx.userId },
      webhookUrl: result.webhook_url,
      webhookSecret: result.webhook_secret,
      actorUserId: ctx.userId,
    });
  }
}
