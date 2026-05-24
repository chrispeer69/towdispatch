/**
 * OIDC id_token validation. Stands up a tiny in-process mock IdP (discovery
 * doc + JWKS + token endpoint) and drives OidcProvider.handleCallback through
 * openid-client. A valid id_token yields claims; a wrong nonce / expired token
 * is rejected — exactly the signature + nonce + exp checks we rely on.
 */
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type JWK, type KeyLike, SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OidcConnectionConfig, OidcProvider } from './oidc.provider.js';

const CLIENT_ID = 'test-client';
const REDIRECT = 'https://api.test/sso/acme/oidc/callback';

let server: Server;
let issuer: string;
let signKey: KeyLike;
let publicJwk: JWK;
const KID = 'test-kid';

/** Token-endpoint behavior is overridable per test via this closure. */
let nextIdTokenClaims: () => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  signKey = privateKey;
  publicJwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

  server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/.well-known/openid-configuration')) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        }),
      );
      return;
    }
    if (url.startsWith('/jwks')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    if (url.startsWith('/token') && req.method === 'POST') {
      void (async () => {
        const idToken = await nextIdTokenClaims();
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            access_token: 'opaque-access',
            id_token: idToken,
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        );
      })();
      return;
    }
    res.statusCode = 404;
    res.end('nope');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  issuer = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function signIdToken(opts: { nonce: string; exp?: number; sub?: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    nonce: opts.nonce,
    email: 'jane@acme.test',
    given_name: 'Jane',
    family_name: 'Doe',
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(issuer)
    .setSubject(opts.sub ?? 'oidc-subject-123')
    .setAudience(CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(opts.exp ?? now + 3600)
    .sign(signKey);
}

function cfg(): OidcConnectionConfig {
  return {
    issuer,
    clientId: CLIENT_ID,
    clientSecret: 'test-secret',
    scopes: 'openid email profile',
    redirectUri: REDIRECT,
  };
}

describe('OidcProvider.handleCallback (mock IdP)', () => {
  const provider = new OidcProvider();

  it('validates a correct id_token and returns claims', async () => {
    const nonce = 'nonce-abc';
    nextIdTokenClaims = () => signIdToken({ nonce });
    const claims = await provider.handleCallback(cfg(), {
      callbackParams: { code: 'auth-code-123', state: nonce },
      expectedState: nonce,
      nonce,
      codeVerifier: 'a'.repeat(64),
    });
    expect(claims.email).toBe('jane@acme.test');
    expect(claims.given_name).toBe('Jane');
    expect(claims.sub).toBe('oidc-subject-123');
  });

  it('rejects an id_token whose nonce does not match', async () => {
    nextIdTokenClaims = () => signIdToken({ nonce: 'attacker-nonce' });
    await expect(
      provider.handleCallback(cfg(), {
        callbackParams: { code: 'auth-code-123', state: 'nonce-xyz' },
        expectedState: 'nonce-xyz',
        nonce: 'nonce-xyz',
        codeVerifier: 'a'.repeat(64),
      }),
    ).rejects.toThrow();
  });

  it('rejects an expired id_token', async () => {
    const nonce = 'nonce-exp';
    const past = Math.floor(Date.now() / 1000) - 120;
    nextIdTokenClaims = () => signIdToken({ nonce, exp: past });
    await expect(
      provider.handleCallback(cfg(), {
        callbackParams: { code: 'auth-code-123', state: nonce },
        expectedState: nonce,
        nonce,
        codeVerifier: 'a'.repeat(64),
      }),
    ).rejects.toThrow();
  });

  it('generates a PKCE pair and a nonce', () => {
    const pkce = provider.generatePkce();
    expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.codeChallenge.length).toBeGreaterThan(0);
    expect(provider.generateNonce().length).toBeGreaterThan(0);
  });
});
