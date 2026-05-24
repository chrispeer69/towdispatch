/**
 * OIDC provider — authorization-code + PKCE over `openid-client` v5.
 *
 * Discovery results (which carry the JWKS endpoint + cached keys) are held
 * per issuer with a TTL so we don't re-fetch `.well-known` on every login;
 * openid-client itself refreshes JWKS on a kid miss. `handleCallback` does
 * the real work: exchange the code, then validate the id_token signature
 * (against the issuer JWKS), `iss`, `aud`, `exp`, and the `nonce` we bound
 * at /login. A bad token throws.
 */
import { Injectable } from '@nestjs/common';
import { Issuer, type TokenSet, generators } from 'openid-client';

export interface OidcConnectionConfig {
  /** OIDC issuer (discovery base, e.g. https://accounts.example.com). */
  issuer: string;
  clientId: string;
  /** Decrypted client secret (may be empty for a public client). */
  clientSecret: string;
  /** Space-delimited scopes; must include openid. */
  scopes: string;
  /** Absolute redirect/callback URL registered with the IdP. */
  redirectUri: string;
}

export interface OidcPkce {
  codeVerifier: string;
  codeChallenge: string;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedIssuer {
  issuer: Issuer;
  expiresAt: number;
}

@Injectable()
export class OidcProvider {
  private readonly issuerCache = new Map<string, CachedIssuer>();

  /** PKCE pair — the verifier is stashed in the state cookie until callback. */
  generatePkce(): OidcPkce {
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    return { codeVerifier, codeChallenge };
  }

  /** Random value used for both the OIDC `state` and `nonce`. */
  generateNonce(): string {
    return generators.nonce();
  }

  private async discover(issuerUrl: string): Promise<Issuer> {
    const cached = this.issuerCache.get(issuerUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.issuer;
    const issuer = await Issuer.discover(issuerUrl);
    this.issuerCache.set(issuerUrl, { issuer, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    return issuer;
  }

  private async client(cfg: OidcConnectionConfig) {
    const issuer = await this.discover(cfg.issuer);
    return new issuer.Client({
      client_id: cfg.clientId,
      ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
      redirect_uris: [cfg.redirectUri],
      response_types: ['code'],
      token_endpoint_auth_method: cfg.clientSecret ? 'client_secret_basic' : 'none',
    });
  }

  /** Build the authorization-code + PKCE redirect URL. */
  async buildAuthUrl(
    cfg: OidcConnectionConfig,
    params: { state: string; nonce: string; codeChallenge: string },
  ): Promise<string> {
    const client = await this.client(cfg);
    return client.authorizationUrl({
      scope: cfg.scopes.includes('openid') ? cfg.scopes : `openid ${cfg.scopes}`,
      response_type: 'code',
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    });
  }

  /**
   * Exchange the code and validate the id_token. `expectedState` / `nonce`
   * come from the verified state cookie; `codeVerifier` is the PKCE verifier
   * we stashed there. Returns the validated id_token claims.
   */
  async handleCallback(
    cfg: OidcConnectionConfig,
    params: {
      callbackParams: Record<string, string>;
      expectedState: string;
      nonce: string;
      codeVerifier: string;
    },
  ): Promise<Record<string, unknown>> {
    const client = await this.client(cfg);
    const tokenSet: TokenSet = await client.callback(cfg.redirectUri, params.callbackParams, {
      state: params.expectedState,
      nonce: params.nonce,
      code_verifier: params.codeVerifier,
    });
    const claims = tokenSet.claims();
    return claims as unknown as Record<string, unknown>;
  }
}
