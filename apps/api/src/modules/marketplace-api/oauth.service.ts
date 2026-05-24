/**
 * OauthService (Session 46) — the authorization-code-with-PKCE engine.
 *
 * Everything here runs through the admin pool: /oauth/token and /oauth/revoke
 * are PUBLIC endpoints with no operator session, so RLS can't scope the lookups
 * (the auth code and install are resolved by token hash across all tenants).
 * Tenant identity is carried explicitly on the auth code and copied onto the
 * install. A token is NEVER tenant-elevated — its scopes can't exceed what the
 * operator granted, which can't exceed what the app declared.
 */
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import {
  type AuthorizeRequest,
  type AuthorizeResult,
  ERROR_CODES,
  type RevokeRequest,
  type TokenRequest,
  type TokenResponse,
  formatScopeString,
  scopesContained,
} from '@ustowdispatch/shared';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import {
  TOKEN_PREFIXES,
  generateOpaqueToken,
  hashSecret,
  parseDurationSeconds,
  verifyPkceS256,
  verifySecretHash,
} from './marketplace-tokens.util.js';
import { WebhookDeliveryService } from './webhook-delivery.service.js';

interface AppAuthRow {
  id: string;
  slug: string;
  status: string;
  scopes: string[];
  oauth_redirect_urls: string[];
  webhook_url: string | null;
  webhook_secret: string | null;
  client_secret_hash: string;
}

interface CodeRow {
  app_id: string;
  tenant_id: string;
  user_id: string | null;
  scopes: string[];
  code_challenge: string;
  redirect_uri: string;
}

@Injectable()
export class OauthService {
  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
    private readonly webhooks: WebhookDeliveryService,
  ) {}

  /**
   * Operator-approved authorize step. The operator's tenant + user come from
   * their session (never the body). Issues a single-use PKCE auth code.
   */
  async authorize(
    operator: { tenantId: string; userId: string },
    body: AuthorizeRequest,
  ): Promise<AuthorizeResult> {
    const app = await this.loadApp(body.clientId);
    if (!app || app.status !== 'listed') {
      throw new BadRequestException({
        code: ERROR_CODES.MARKETPLACE_APP_NOT_LISTED,
        message: 'App is not available for install',
      });
    }
    if (!app.oauth_redirect_urls.includes(body.redirectUri)) {
      throw new BadRequestException({
        code: ERROR_CODES.OAUTH_INVALID_REQUEST,
        message: 'redirect_uri is not registered for this app',
      });
    }
    if (!scopesContained(body.scopes, app.scopes)) {
      throw new BadRequestException({
        code: ERROR_CODES.OAUTH_INVALID_SCOPE,
        message: 'Requested scopes exceed what the app declares',
      });
    }

    const code = generateOpaqueToken(TOKEN_PREFIXES.authCode);
    const ttl = parseDurationSeconds(this.config.marketplaceOauthCodeTtl);
    await this.admin.runAsAdmin({ actorUserId: operator.userId }, async (_db, client) => {
      await client.query(
        `INSERT INTO marketplace_oauth_codes
             (id, code_hash, app_id, tenant_id, user_id, scopes, code_challenge,
              code_challenge_method, redirect_uri, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9, now() + ($10 || ' seconds')::interval)`,
        [
          uuidv7(),
          hashSecret(code),
          app.id,
          operator.tenantId,
          operator.userId,
          JSON.stringify(body.scopes),
          body.codeChallenge,
          body.codeChallengeMethod,
          body.redirectUri,
          String(ttl),
        ],
      );
    });

    const url = new URL(body.redirectUri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', body.state);
    return { code, state: body.state, redirectTo: url.toString() };
  }

  async token(body: TokenRequest): Promise<TokenResponse> {
    const app = await this.loadApp(body.clientId);
    if (!app || !verifySecretHash(body.clientSecret, app.client_secret_hash)) {
      throw new UnauthorizedException({
        code: ERROR_CODES.OAUTH_INVALID_CLIENT,
        message: 'Invalid client credentials',
      });
    }
    if (app.status === 'suspended') {
      throw new UnauthorizedException({
        code: ERROR_CODES.OAUTH_INVALID_CLIENT,
        message: 'App is suspended',
      });
    }

    if (body.grantType === 'authorization_code') {
      return this.exchangeCode(app, body);
    }
    return this.refresh(app, body);
  }

  private async exchangeCode(
    app: AppAuthRow,
    body: Extract<TokenRequest, { grantType: 'authorization_code' }>,
  ): Promise<TokenResponse> {
    // Atomically consume the code: only one caller can flip consumed_at.
    const code = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<CodeRow>(
        `UPDATE marketplace_oauth_codes
            SET consumed_at = now()
          WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        RETURNING app_id, tenant_id, user_id, scopes, code_challenge, redirect_uri`,
        [hashSecret(body.code)],
      );
      return r.rows[0] ?? null;
    });
    if (!code || code.app_id !== app.id) {
      throw this.invalidGrant('Authorization code is invalid, expired, or already used');
    }
    if (code.redirect_uri !== body.redirectUri) {
      throw this.invalidGrant('redirect_uri does not match the authorization request');
    }
    if (!verifyPkceS256(body.codeVerifier, code.code_challenge)) {
      throw this.invalidGrant('PKCE verification failed');
    }

    const scopes = code.scopes;
    const issued = this.mintTokenPair();
    const result = await this.upsertInstall({
      appId: app.id,
      tenantId: code.tenant_id,
      userId: code.user_id,
      scopes,
      issued,
    });

    await this.webhooks.emit({
      tenantId: code.tenant_id,
      appId: app.id,
      installId: result.installId,
      eventType: result.created ? 'install' : 'reauth',
      payload: { scopes, via: 'authorization_code' },
      webhookUrl: app.webhook_url,
      webhookSecret: app.webhook_secret,
      actorUserId: code.user_id,
    });

    return this.tokenResponse(issued, scopes);
  }

  private async refresh(
    app: AppAuthRow,
    body: Extract<TokenRequest, { grantType: 'refresh_token' }>,
  ): Promise<TokenResponse> {
    const issued = this.mintTokenPair();
    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<{ id: string; tenant_id: string; scopes_granted: string[] }>(
        `UPDATE marketplace_app_installs
            SET oauth_access_token_hash = $1,
                oauth_refresh_token_hash = $2,
                access_token_expires_at = now() + ($3 || ' seconds')::interval
          WHERE oauth_refresh_token_hash = $4
            AND app_id = $5
            AND status = 'active'
            AND deleted_at IS NULL
        RETURNING id, tenant_id, scopes_granted`,
        [
          issued.accessHash,
          issued.refreshHash,
          String(issued.expiresIn),
          hashSecret(body.refreshToken),
          app.id,
        ],
      );
      return r.rows[0] ?? null;
    });
    if (!row) {
      throw this.invalidGrant('Refresh token is invalid or revoked');
    }

    await this.webhooks.emit({
      tenantId: row.tenant_id,
      appId: app.id,
      installId: row.id,
      eventType: 'reauth',
      payload: { via: 'refresh_token' },
      webhookUrl: app.webhook_url,
      webhookSecret: app.webhook_secret,
      actorUserId: null,
    });

    return this.tokenResponse(issued, Array.isArray(row.scopes_granted) ? row.scopes_granted : []);
  }

  /**
   * Revoke (RFC 7009): nulls both token hashes for the install owning the
   * presented token. Idempotent — returns success even if the token is already
   * gone, provided the client credentials are valid.
   */
  async revoke(body: RevokeRequest): Promise<void> {
    const app = await this.loadApp(body.clientId);
    if (!app || !verifySecretHash(body.clientSecret, app.client_secret_hash)) {
      throw new UnauthorizedException({
        code: ERROR_CODES.OAUTH_INVALID_CLIENT,
        message: 'Invalid client credentials',
      });
    }
    const tokenHash = hashSecret(body.token);
    await this.admin.runAsAdmin({}, async (_db, client) => {
      await client.query(
        `UPDATE marketplace_app_installs
            SET oauth_access_token_hash = NULL,
                oauth_refresh_token_hash = NULL,
                access_token_expires_at = NULL
          WHERE app_id = $1
            AND (oauth_access_token_hash = $2 OR oauth_refresh_token_hash = $2)`,
        [app.id, tokenHash],
      );
    });
  }

  // ---- internals ---------------------------------------------------------

  private async upsertInstall(args: {
    appId: string;
    tenantId: string;
    userId: string | null;
    scopes: string[];
    issued: MintedTokens;
  }): Promise<{ installId: string; created: boolean }> {
    return this.admin.runAsAdmin(
      args.userId ? { actorUserId: args.userId } : {},
      async (_db, client) => {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM marketplace_app_installs
            WHERE tenant_id = $1 AND app_id = $2 AND status = 'active' AND deleted_at IS NULL
            LIMIT 1`,
          [args.tenantId, args.appId],
        );
        const found = existing.rows[0];
        if (found) {
          await client.query(
            `UPDATE marketplace_app_installs
                SET scopes_granted = $1::jsonb,
                    oauth_access_token_hash = $2,
                    oauth_refresh_token_hash = $3,
                    access_token_expires_at = now() + ($4 || ' seconds')::interval,
                    installed_by_user_id = COALESCE($5, installed_by_user_id)
              WHERE id = $6`,
            [
              JSON.stringify(args.scopes),
              args.issued.accessHash,
              args.issued.refreshHash,
              String(args.issued.expiresIn),
              args.userId,
              found.id,
            ],
          );
          return { installId: found.id, created: false };
        }
        const id = uuidv7();
        await client.query(
          `INSERT INTO marketplace_app_installs
             (id, tenant_id, app_id, installed_by_user_id, scopes_granted,
              oauth_access_token_hash, oauth_refresh_token_hash, access_token_expires_at, status)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7, now() + ($8 || ' seconds')::interval, 'active')`,
          [
            id,
            args.tenantId,
            args.appId,
            args.userId,
            JSON.stringify(args.scopes),
            args.issued.accessHash,
            args.issued.refreshHash,
            String(args.issued.expiresIn),
          ],
        );
        return { installId: id, created: true };
      },
    );
  }

  private mintTokenPair(): MintedTokens {
    const accessToken = generateOpaqueToken(TOKEN_PREFIXES.accessToken);
    const refreshToken = generateOpaqueToken(TOKEN_PREFIXES.refreshToken);
    return {
      accessToken,
      refreshToken,
      accessHash: hashSecret(accessToken),
      refreshHash: hashSecret(refreshToken),
      expiresIn: parseDurationSeconds(this.config.marketplaceAccessTokenTtl),
    };
  }

  private tokenResponse(issued: MintedTokens, scopes: string[]): TokenResponse {
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      tokenType: 'Bearer',
      expiresIn: issued.expiresIn,
      scope: formatScopeString(scopes),
    };
  }

  private async loadApp(clientId: string): Promise<AppAuthRow | null> {
    return this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<AppAuthRow>(
        `SELECT id, slug, status, scopes, oauth_redirect_urls, webhook_url,
                webhook_secret, client_secret_hash
           FROM marketplace_apps WHERE id = $1 AND deleted_at IS NULL`,
        [clientId],
      );
      return r.rows[0] ?? null;
    });
  }

  private invalidGrant(message: string): BadRequestException {
    return new BadRequestException({ code: ERROR_CODES.OAUTH_INVALID_GRANT, message });
  }
}

interface MintedTokens {
  accessToken: string;
  refreshToken: string;
  accessHash: string;
  refreshHash: string;
  expiresIn: number;
}
