/**
 * DevelopersService (Session 46) — developer-account auth + app management.
 *
 * Developer accounts and marketplace apps are GLOBAL (tenant-less) tables, so
 * every query here runs through the admin pool (TransactionRunner). RLS does
 * not apply; isolation is enforced in code by always scoping app queries to the
 * authenticated developer_id.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import {
  type CreateMarketplaceAppPayload,
  type DeveloperSession,
  type DeveloperSignupPayload,
  type DeveloperSignupResult,
  ERROR_CODES,
  type MarketplaceAppCredentials,
  type MarketplaceAppDto,
  type MarketplaceAppMetrics,
  type UpdateMarketplaceAppPayload,
} from '@ustowdispatch/shared';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { JwtService } from '../auth/jwt.service.js';
import { PasswordService } from '../auth/password.service.js';
import { TOKEN_PREFIXES, generateOpaqueToken, hashSecret } from './marketplace-tokens.util.js';
import { type AppRow, type DeveloperRow, toAppDto, toDeveloperDto } from './marketplace.mappers.js';

const APP_COLUMNS = `id, developer_id, slug, name, description, category, logo_url,
  scopes, oauth_redirect_urls, webhook_url, status, review_notes, created_at, updated_at`;

const EDITABLE_STATUSES = new Set(['draft', 'listed']);

@Injectable()
export class DevelopersService {
  constructor(
    private readonly admin: TransactionRunner,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---- account lifecycle -------------------------------------------------

  async signup(body: DeveloperSignupPayload): Promise<DeveloperSignupResult> {
    const email = body.ownerUserEmail.trim().toLowerCase();
    const passwordHash = await this.passwords.hash(body.password);
    const verificationToken = generateOpaqueToken('dvtok_');
    const id = uuidv7();

    await this.admin.runAsAdmin({}, async (_db, client) => {
      const existing = await client.query(
        'SELECT 1 FROM developer_accounts WHERE lower(owner_user_email) = $1 AND deleted_at IS NULL',
        [email],
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'A developer account already exists for this email',
        });
      }
      await client.query(
        `INSERT INTO developer_accounts
           (id, owner_user_email, company_name, password_hash, verified,
            email_verification_token_hash, status)
         VALUES ($1, $2, $3, $4, false, $5, 'active')`,
        [id, email, body.companyName.trim(), passwordHash, hashSecret(verificationToken)],
      );
    });

    // v1: no templated developer-verification email yet (the feature ships
    // dark). Return the token outside production so the portal can complete
    // verification; in production it is withheld pending a real email (🟡).
    return {
      status: 'verification_required',
      devVerificationToken: this.config.nodeEnv === 'production' ? null : verificationToken,
    };
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    const updated = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query(
        `UPDATE developer_accounts
            SET verified = true,
                email_verified_at = now(),
                email_verification_token_hash = NULL
          WHERE email_verification_token_hash = $1
            AND verified = false
            AND deleted_at IS NULL
        RETURNING id`,
        [hashSecret(token)],
      );
      return r.rowCount ?? 0;
    });
    if (updated === 0) {
      throw new NotFoundException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Verification token is invalid or already used',
      });
    }
    return { verified: true };
  }

  async login(email: string, password: string): Promise<DeveloperSession> {
    const normalized = email.trim().toLowerCase();
    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<DeveloperRow & { password_hash: string }>(
        `SELECT id, owner_user_email, company_name, password_hash, verified, status,
                created_at, updated_at
           FROM developer_accounts
          WHERE lower(owner_user_email) = $1 AND deleted_at IS NULL`,
        [normalized],
      );
      return r.rows[0] ?? null;
    });

    const invalid = new UnauthorizedException({
      code: ERROR_CODES.INVALID_CREDENTIALS,
      message: 'Invalid developer credentials',
    });
    if (!row) {
      // Still spend a hash to keep timing uniform against account enumeration.
      await this.passwords
        .verify('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA', password)
        .catch(() => false);
      throw invalid;
    }
    const ok = await this.passwords.verify(row.password_hash, password);
    if (!ok) throw invalid;
    if (row.status !== 'active') {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Developer account is suspended',
      });
    }
    if (!row.verified) {
      throw new ForbiddenException({
        code: ERROR_CODES.EMAIL_NOT_VERIFIED,
        message: 'Verify your email before signing in',
      });
    }

    const accessToken = await this.jwt.signDeveloper({ sub: row.id });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.jwt.developerTtlSeconds(),
      developer: toDeveloperDto(row),
    };
  }

  async getAccount(developerId: string): Promise<DeveloperSession['developer']> {
    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<DeveloperRow>(
        `SELECT id, owner_user_email, company_name, verified, status, created_at, updated_at
           FROM developer_accounts WHERE id = $1 AND deleted_at IS NULL`,
        [developerId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) throw this.developerGone();
    return toDeveloperDto(row);
  }

  // ---- app management ----------------------------------------------------

  async createApp(
    developerId: string,
    body: CreateMarketplaceAppPayload,
  ): Promise<MarketplaceAppCredentials> {
    await this.assertVerified(developerId);
    const id = uuidv7();
    const clientSecret = generateOpaqueToken(TOKEN_PREFIXES.clientSecret);
    const webhookSecret = generateOpaqueToken(TOKEN_PREFIXES.webhookSecret);

    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const slugTaken = await client.query(
        'SELECT 1 FROM marketplace_apps WHERE lower(slug) = lower($1) AND deleted_at IS NULL',
        [body.slug],
      );
      if ((slugTaken.rowCount ?? 0) > 0) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: `Slug "${body.slug}" is already taken`,
        });
      }
      const r = await client.query<AppRow>(
        `INSERT INTO marketplace_apps
           (id, developer_id, slug, name, description, category, logo_url, scopes,
            oauth_redirect_urls, webhook_url, webhook_secret, client_secret_hash, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,'draft')
         RETURNING ${APP_COLUMNS}`,
        [
          id,
          developerId,
          body.slug,
          body.name,
          body.description,
          body.category,
          body.logoUrl,
          JSON.stringify(body.scopes),
          JSON.stringify(body.oauthRedirectUrls),
          body.webhookUrl,
          body.webhookUrl ? webhookSecret : null,
          hashSecret(clientSecret),
        ],
      );
      return r.rows[0] as AppRow;
    });

    return { app: toAppDto(row), clientId: row.id, clientSecret };
  }

  async listApps(developerId: string): Promise<MarketplaceAppDto[]> {
    const rows = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<AppRow>(
        `SELECT ${APP_COLUMNS} FROM marketplace_apps
          WHERE developer_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC`,
        [developerId],
      );
      return r.rows;
    });
    return rows.map(toAppDto);
  }

  async getApp(developerId: string, appId: string): Promise<MarketplaceAppDto> {
    return toAppDto(await this.ownedApp(developerId, appId));
  }

  async updateApp(
    developerId: string,
    appId: string,
    body: UpdateMarketplaceAppPayload,
  ): Promise<MarketplaceAppDto> {
    const current = await this.ownedApp(developerId, appId);
    if (!EDITABLE_STATUSES.has(current.status)) {
      throw new ConflictException({
        code: ERROR_CODES.MARKETPLACE_INVALID_APP_STATE,
        message: `An app in "${current.status}" cannot be edited`,
      });
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const set = (col: string, val: unknown, cast = ''): void => {
      sets.push(`${col} = $${i}${cast}`);
      vals.push(val);
      i += 1;
    };
    if (body.name !== undefined) set('name', body.name);
    if (body.description !== undefined) set('description', body.description);
    if (body.category !== undefined) set('category', body.category);
    if (body.logoUrl !== undefined) set('logo_url', body.logoUrl);
    if (body.scopes !== undefined) set('scopes', JSON.stringify(body.scopes), '::jsonb');
    if (body.oauthRedirectUrls !== undefined)
      set('oauth_redirect_urls', JSON.stringify(body.oauthRedirectUrls), '::jsonb');
    if (body.webhookUrl !== undefined) {
      set('webhook_url', body.webhookUrl);
      // Backfill a signing secret the first time a webhook URL is added — the
      // deliverer no-ops without one. COALESCE keeps an existing secret stable.
      if (body.webhookUrl !== null) {
        set('webhook_secret', generateOpaqueToken(TOKEN_PREFIXES.webhookSecret));
        // Rewrite the just-pushed assignment to COALESCE over the existing value.
        sets[sets.length - 1] = `webhook_secret = COALESCE(webhook_secret, $${i - 1})`;
      }
    }
    if (sets.length === 0) return toAppDto(current);

    vals.push(appId, developerId);
    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<AppRow>(
        `UPDATE marketplace_apps SET ${sets.join(', ')}
          WHERE id = $${i} AND developer_id = $${i + 1} AND deleted_at IS NULL
        RETURNING ${APP_COLUMNS}`,
        vals,
      );
      return r.rows[0] ?? null;
    });
    if (!row) throw this.appGone();
    return toAppDto(row);
  }

  async deleteApp(developerId: string, appId: string): Promise<void> {
    await this.ownedApp(developerId, appId);
    await this.admin.runAsAdmin({}, async (_db, client) => {
      await client.query(
        `UPDATE marketplace_apps SET deleted_at = now()
          WHERE id = $1 AND developer_id = $2 AND deleted_at IS NULL`,
        [appId, developerId],
      );
    });
  }

  async submitForReview(developerId: string, appId: string): Promise<MarketplaceAppDto> {
    const current = await this.ownedApp(developerId, appId);
    if (current.status !== 'draft') {
      throw new ConflictException({
        code: ERROR_CODES.MARKETPLACE_INVALID_APP_STATE,
        message: `Only a draft app can be submitted (current: ${current.status})`,
      });
    }
    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<AppRow>(
        `UPDATE marketplace_apps SET status = 'review', review_notes = NULL
          WHERE id = $1 AND developer_id = $2 AND status = 'draft' AND deleted_at IS NULL
        RETURNING ${APP_COLUMNS}`,
        [appId, developerId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) throw this.appGone();
    return toAppDto(row);
  }

  async metrics(developerId: string, appId: string): Promise<MarketplaceAppMetrics> {
    await this.ownedApp(developerId, appId);
    return this.admin.runAsAdmin({}, async (_db, client) => {
      const installs = await client.query<{ active: string; total: string; last: Date | null }>(
        `SELECT
            count(*) FILTER (WHERE status = 'active' AND deleted_at IS NULL) AS active,
            count(*) AS total,
            max(installed_at) AS last
           FROM marketplace_app_installs WHERE app_id = $1`,
        [appId],
      );
      const uninstalls = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM marketplace_app_events
          WHERE app_id = $1 AND event_type = 'uninstall' AND deleted_at IS NULL`,
        [appId],
      );
      const r = installs.rows[0];
      return {
        appId,
        activeInstalls: Number(r?.active ?? 0),
        totalInstalls: Number(r?.total ?? 0),
        totalUninstalls: Number(uninstalls.rows[0]?.n ?? 0),
        lastInstalledAt: r?.last ? r.last.toISOString() : null,
      };
    });
  }

  // ---- helpers -----------------------------------------------------------

  private async ownedApp(developerId: string, appId: string): Promise<AppRow> {
    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<AppRow>(
        `SELECT ${APP_COLUMNS} FROM marketplace_apps
          WHERE id = $1 AND developer_id = $2 AND deleted_at IS NULL`,
        [appId, developerId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) throw this.appGone();
    return row;
  }

  private async assertVerified(developerId: string): Promise<void> {
    const acct = await this.getAccount(developerId); // throws if gone
    if (!acct.verified) {
      throw new ForbiddenException({
        code: ERROR_CODES.EMAIL_NOT_VERIFIED,
        message: 'Verify your email before publishing apps',
      });
    }
  }

  private appGone(): NotFoundException {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'App not found' });
  }

  private developerGone(): UnauthorizedException {
    return new UnauthorizedException({
      code: ERROR_CODES.UNAUTHORIZED,
      message: 'Developer account not found',
    });
  }
}
