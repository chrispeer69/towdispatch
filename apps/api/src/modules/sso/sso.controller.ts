/**
 * SsoController — the IdP-facing, unauthenticated surface (SP-initiated only).
 *
 *   GET  /sso/:slug/saml/login    -> 302 to IdP (AuthnRequest)
 *   POST /sso/:slug/saml/acs      -> validate Response, mint session, 302 to web
 *   GET  /sso/:slug/oidc/login    -> 302 to IdP (auth code + PKCE)
 *   GET  /sso/:slug/oidc/callback -> exchange code, mint session, 302 to web
 *
 * @Public() so the global JwtAuthGuard skips — there is no JWT yet. CSRF is
 * handled by a signed, httpOnly state cookie bound to the IdP round-trip
 * (RelayState for SAML, state+nonce for OIDC). On success we hand the freshly
 * minted tokens to the web app via the URL fragment (kept out of logs /
 * Referer); on failure we redirect to the web login with an error code and
 * always write an audit row.
 */
import { randomUUID } from 'node:crypto';
import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ConfigService } from '../../config/config.service.js';
import { OidcProvider } from './oidc/oidc.provider.js';
import { buildSamlLoginUrl, parseSamlAssertion } from './saml/saml.provider.js';
import { SSO_STATE_COOKIE, SsoStateService } from './sso-state.service.js';
import { type SsoLoginMeta, SsoService, type SsoSessionResult } from './sso.service.js';

const slugParam = z.object({ slug: z.string().min(1).max(64) });
const acsBodySchema = z.object({
  SAMLResponse: z.string().min(1),
  RelayState: z.string().optional(),
});

@Public()
@Controller('sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly oidc: OidcProvider,
    private readonly state: SsoStateService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- SAML
  @Get(':slug/saml/login')
  async samlLogin(@Param() params: unknown, @Res() reply: FastifyReply): Promise<void> {
    const { slug } = slugParam.parse(params);
    const { connection } = await this.sso.resolveActiveConnection(slug, 'saml');
    const urls = this.sso.connectionUrls(slug);
    const nonce = randomUUID();
    const stateToken = await this.state.sign({ cid: connection.id, p: 'saml', n: nonce });

    const redirectUrl = await buildSamlLoginUrl(
      {
        ssoUrl: connection.ssoUrl ?? '',
        idpCert: connection.x509Cert ?? '',
        spEntityId: urls.spEntityId,
        acsUrl: urls.acs,
        audience: connection.audience ?? undefined,
        idpIssuer: connection.issuer ?? undefined,
      },
      nonce,
    );
    this.setStateCookie(reply, stateToken, 'saml');
    reply.redirect(redirectUrl);
  }

  @Post(':slug/saml/acs')
  async samlAcs(
    @Param() params: unknown,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { slug } = slugParam.parse(params);
    const meta = this.metaOf(req);
    const resolved = await this.sso.resolveActiveConnection(slug, 'saml');
    const urls = this.sso.connectionUrls(slug);

    try {
      const body = acsBodySchema.parse(req.body);
      const statePayload = await this.readState(req, resolved.connection.id, 'saml');
      if (!body.RelayState || body.RelayState !== statePayload.n) {
        throw new Error('RelayState does not match state cookie');
      }
      const verified = await parseSamlAssertion(body.SAMLResponse, {
        ssoUrl: resolved.connection.ssoUrl ?? '',
        idpCert: resolved.connection.x509Cert ?? '',
        spEntityId: urls.spEntityId,
        acsUrl: urls.acs,
        audience: resolved.connection.audience ?? undefined,
        idpIssuer: resolved.connection.issuer ?? undefined,
      });
      const session = await this.sso.completeLogin(
        resolved,
        { subject: verified.nameId, claims: verified.claims },
        'saml',
        meta,
      );
      this.clearStateCookie(reply, 'saml');
      reply.redirect(this.successUrl(session));
    } catch (err) {
      await this.sso.recordAudit({
        tenantId: resolved.tenant.id,
        connectionId: resolved.connection.id,
        userId: null,
        provider: 'saml',
        outcome: 'fail',
        failureReason: errMessage(err),
        meta,
      });
      this.clearStateCookie(reply, 'saml');
      reply.redirect(this.failureUrl('saml'));
    }
  }

  // ---------------------------------------------------------------- OIDC
  @Get(':slug/oidc/login')
  async oidcLogin(@Param() params: unknown, @Res() reply: FastifyReply): Promise<void> {
    const { slug } = slugParam.parse(params);
    const resolved = await this.sso.resolveActiveConnection(slug, 'oidc');
    const urls = this.sso.connectionUrls(slug);
    const nonce = this.oidc.generateNonce();
    const pkce = this.oidc.generatePkce();
    const stateToken = await this.state.sign({
      cid: resolved.connection.id,
      p: 'oidc',
      n: nonce,
      cv: pkce.codeVerifier,
    });
    const redirectUrl = await this.oidc.buildAuthUrl(
      {
        issuer: resolved.connection.issuer ?? '',
        clientId: resolved.connection.oidcClientId ?? '',
        clientSecret: this.sso.decryptOidcSecret(resolved.connection),
        scopes: resolved.connection.oidcScopes,
        redirectUri: urls.oidcRedirect,
      },
      { state: nonce, nonce, codeChallenge: pkce.codeChallenge },
    );
    this.setStateCookie(reply, stateToken, 'oidc');
    reply.redirect(redirectUrl);
  }

  @Get(':slug/oidc/callback')
  async oidcCallback(
    @Param() params: unknown,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { slug } = slugParam.parse(params);
    const meta = this.metaOf(req);
    const resolved = await this.sso.resolveActiveConnection(slug, 'oidc');
    const urls = this.sso.connectionUrls(slug);

    try {
      const statePayload = await this.readState(req, resolved.connection.id, 'oidc');
      if (!statePayload.cv) throw new Error('state cookie missing PKCE verifier');
      const query = (req.query ?? {}) as Record<string, string>;
      const claims = await this.oidc.handleCallback(
        {
          issuer: resolved.connection.issuer ?? '',
          clientId: resolved.connection.oidcClientId ?? '',
          clientSecret: this.sso.decryptOidcSecret(resolved.connection),
          scopes: resolved.connection.oidcScopes,
          redirectUri: urls.oidcRedirect,
        },
        {
          callbackParams: query,
          expectedState: statePayload.n,
          nonce: statePayload.n,
          codeVerifier: statePayload.cv,
        },
      );
      const subject = typeof claims.sub === 'string' ? claims.sub : '';
      const session = await this.sso.completeLogin(resolved, { subject, claims }, 'oidc', meta);
      this.clearStateCookie(reply, 'oidc');
      reply.redirect(this.successUrl(session));
    } catch (err) {
      await this.sso.recordAudit({
        tenantId: resolved.tenant.id,
        connectionId: resolved.connection.id,
        userId: null,
        provider: 'oidc',
        outcome: 'fail',
        failureReason: errMessage(err),
        meta,
      });
      this.clearStateCookie(reply, 'oidc');
      reply.redirect(this.failureUrl('oidc'));
    }
  }

  // ---------------------------------------------------------------- helpers
  private cookieOpts(provider: 'saml' | 'oidc'): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'none' | 'lax';
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      secure: this.config.nodeEnv === 'production',
      // SAML ACS is a cross-site POST -> the cookie must be SameSite=None to
      // be sent. OIDC callback is a top-level GET -> Lax is enough (and safer).
      sameSite: provider === 'saml' ? 'none' : 'lax',
      path: '/sso',
      maxAge: 600,
    };
  }

  private setStateCookie(reply: FastifyReply, token: string, provider: 'saml' | 'oidc'): void {
    reply.setCookie(SSO_STATE_COOKIE, token, this.cookieOpts(provider));
  }

  private clearStateCookie(reply: FastifyReply, provider: 'saml' | 'oidc'): void {
    reply.clearCookie(SSO_STATE_COOKIE, this.cookieOpts(provider));
  }

  private async readState(
    req: FastifyRequest,
    expectedConnectionId: string,
    provider: 'saml' | 'oidc',
  ): Promise<{ cid: string; p: 'saml' | 'oidc'; n: string; cv?: string }> {
    const raw = req.cookies?.[SSO_STATE_COOKIE];
    if (!raw) throw new Error('missing SSO state cookie');
    const payload = await this.state.verify(raw);
    if (payload.p !== provider || payload.cid !== expectedConnectionId) {
      throw new Error('SSO state cookie does not match this connection');
    }
    return payload;
  }

  private metaOf(req: FastifyRequest): SsoLoginMeta {
    const c = req.requestContext;
    return {
      ...(c?.requestId ? { requestId: c.requestId } : {}),
      ...(c?.ipAddress ? { ipAddress: c.ipAddress } : {}),
      ...(c?.userAgent ? { userAgent: c.userAgent } : {}),
    };
  }

  private successUrl(session: SsoSessionResult): string {
    const frag = new URLSearchParams({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_in: String(session.expiresIn),
      tenant: session.tenant.slug,
    });
    return `${this.config.webPublicUrl}/login/sso/complete#${frag.toString()}`;
  }

  private failureUrl(provider: 'saml' | 'oidc'): string {
    const q = new URLSearchParams({ error: 'sso_failed', provider });
    return `${this.config.webPublicUrl}/login?${q.toString()}`;
  }
}

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message.slice(0, 480) : 'unknown error';
