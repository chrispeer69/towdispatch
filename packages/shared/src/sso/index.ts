/**
 * Enterprise SSO (Session 38) — Zod contracts barrel.
 *
 * SAML 2.0 + OIDC login connections, SCIM 2.0 provisioning, and the login
 * audit trail. See SESSION_38_DECISIONS.md for the self-hosted library
 * choices (@node-saml/node-saml + openid-client) and the no-new-realm JWT
 * decision.
 */
export * from './connections';
export * from './tokens';
export * from './audit';
export * from './scim';
