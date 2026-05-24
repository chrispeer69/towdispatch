/**
 * SAML 2.0 provider — a thin, stateless wrapper over @node-saml/node-saml
 * (the maintained engine inside passport-saml; we drop the passport layer
 * because it is Express-middleware-coupled and fights our Fastify/Nest
 * custom guards). See SESSION_38_DECISIONS.md.
 *
 * SP-initiated only in v1: we build the AuthnRequest redirect, and we
 * validate the IdP's POSTed Response at the ACS. The IdP signing cert is
 * PINNED per connection (no metadata trust-on-first-use). node-saml does
 * the real XML-DSig signature check, AudienceRestriction check, and
 * NotOnOrAfter / clock-skew check.
 */
import { SAML, type SamlConfig, ValidateInResponseTo } from '@node-saml/node-saml';

/** Verified, flattened claims plus the NameID. */
export interface SamlVerifiedAssertion {
  nameId: string;
  nameIdFormat: string | undefined;
  issuer: string | undefined;
  sessionIndex: string | undefined;
  claims: Record<string, unknown>;
}

export interface SamlConnectionConfig {
  /** IdP SSO endpoint (entryPoint) the AuthnRequest redirects to. */
  ssoUrl: string;
  /** IdP signing certificate (PEM or bare base64), pinned. */
  idpCert: string;
  /** Our SP entityID (issuer of the AuthnRequest). */
  spEntityId: string;
  /** Absolute ACS URL the IdP posts the Response to. */
  acsUrl: string;
  /** Expected AudienceRestriction value (defaults to spEntityId). */
  audience?: string | undefined;
  /** Expected IdP issuer (Response Issuer); validated when set. */
  idpIssuer?: string | undefined;
}

const CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ASSERTION_AGE_MS = 60 * 60 * 1000; // 1 hour

function buildConfig(cfg: SamlConnectionConfig): SamlConfig {
  return {
    idpCert: cfg.idpCert,
    issuer: cfg.spEntityId,
    callbackUrl: cfg.acsUrl,
    entryPoint: cfg.ssoUrl,
    audience: cfg.audience ?? cfg.spEntityId,
    ...(cfg.idpIssuer ? { idpIssuer: cfg.idpIssuer } : {}),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: MAX_ASSERTION_AGE_MS,
    // Stateless SP: we protect the round-trip with our own signed RelayState
    // cookie rather than node-saml's in-memory InResponseTo cache (which does
    // not survive multi-instance deploys). See SsoStateService.
    validateInResponseTo: ValidateInResponseTo.never,
    // We never sign our AuthnRequest in v1 (no SP private key configured).
    identifierFormat: null,
  };
}

/**
 * Build the SP-initiated AuthnRequest redirect URL. `relayState` is echoed
 * back by the IdP and bound to our state cookie.
 */
export async function buildSamlLoginUrl(
  cfg: SamlConnectionConfig,
  relayState: string,
): Promise<string> {
  const saml = new SAML(buildConfig(cfg));
  return saml.getAuthorizeUrlAsync(relayState, undefined, {});
}

/**
 * Validate a base64 SAMLResponse against the pinned cert + expected
 * audience. Returns the verified NameID + flattened attribute claims, or
 * throws (bad signature, expired, wrong audience, malformed) — the caller
 * maps the throw to a `fail` audit row + 401.
 *
 * Effectively pure: it constructs a fresh SAML instance from the passed
 * config and holds no state between calls.
 */
export async function parseSamlAssertion(
  samlResponseB64: string,
  cfg: SamlConnectionConfig,
): Promise<SamlVerifiedAssertion> {
  const saml = new SAML(buildConfig(cfg));
  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponseB64 });
  if (!profile) {
    throw new Error('SAML response carried no profile (likely a LogoutResponse)');
  }

  // Flatten the profile into a plain claims record, dropping node-saml's
  // helper functions + the structural fields we surface explicitly.
  const claims: Record<string, unknown> = {};
  const STRUCTURAL = new Set([
    'nameID',
    'nameIDFormat',
    'issuer',
    'sessionIndex',
    'getAssertionXml',
    'getAssertion',
    'getSamlResponseXml',
  ]);
  for (const [k, v] of Object.entries(profile)) {
    if (STRUCTURAL.has(k) || typeof v === 'function') continue;
    claims[k] = v;
  }

  return {
    nameId: profile.nameID,
    nameIdFormat: profile.nameIDFormat ?? undefined,
    issuer: typeof profile.issuer === 'string' ? profile.issuer : undefined,
    sessionIndex: typeof profile.sessionIndex === 'string' ? profile.sessionIndex : undefined,
    claims,
  };
}
