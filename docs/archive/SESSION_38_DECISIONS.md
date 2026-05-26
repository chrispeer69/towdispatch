# Session 38 — Enterprise SSO — Decision Log

Every call made without asking, with rationale. Conservative + reversible bias.

## D1 — Self-hosted, not Auth0/WorkOS
The brief offered auth0 | workos | self-hosted and stated a preference for
self-hosted to avoid vendor lock-in. **Self-hosted.** No third-party identity
broker; we terminate SAML/OIDC ourselves and mint our own session.

## D2 — SAML library: `@node-saml/node-saml` (not passport-saml, not samlify)
The brief said "@node-saml/passport-saml OR samlify (pick one)". I picked
`@node-saml/node-saml` — the maintained SAML engine that passport-saml is built
on top of — and dropped the passport wrapper:
- passport-saml drags in Passport, which is Express-middleware-shaped and fights
  our Fastify + Nest custom-guard architecture.
- samlify hard-requires a separate XSD schema validator
  (`@authenio/samlify-node-xmllint` = native node-gyp build, or the xsd-schema
  validator = a **Java** dependency). Either jeopardizes CI. node-saml is pure
  JS (xml-crypto + @xmldom/xmldom), no native build, no Java.
- Real cryptographic validation (XML-DSig signature, AudienceRestriction,
  NotOnOrAfter/clock-skew) — the library is NOT mocked; tests mock the IdP.

## D3 — OIDC library: `openid-client@^5`
Used as the brief specified. Pinned to v5 (Issuer/Client API) rather than v6
(ESM-only functional API) — v5 is the most battle-tested and the easiest to
drive against a local mock IdP in tests. Authorization-code + PKCE; id_token
validated against the issuer JWKS (cached on the discovered Issuer with a 1h
TTL; openid-client refreshes on kid-miss).

## D4 — Migration number 0048
Master's highest raw-SQL migration is 0046; 0047 (Canada) is in-flight on
another branch. 0048 avoids collision. Per the repo's migration convention,
gaps are harmless (migrate.ts re-applies all idempotent `sql/*.sql` every run).

## D5 — `ENTERPRISE_SSO_TENANTS` empty = NO tenant (opt-in)
SSO is a security control, so the conservative default is empty-allowlist =
nobody. A tenant must be explicitly added to the CSV **and**
`ENTERPRISE_SSO_ENABLED=true` for any /sso or /scim route to function. This is
the opposite of the CORS_ORIGINS "empty = permissive" convention — deliberately.

## D6 — No new auth realm: reuse AuthService token issuance
SSO mints the SAME access+refresh session as password login by calling a new
thin `AuthService.issueSsoTokens()` that delegates to the existing private
`issueTokens()` path. The JWT issuance core is untouched; we only added a public
entrypoint. Result: SSO tokens are byte-for-byte the password shape and the
existing `/auth/refresh` accepts them.

## D7 — SCIM users ARE local users (additive columns on `users`)
Rather than a parallel identity table, SCIM provisions rows in `users` with two
new nullable columns (`external_id`, `sso_connection_id`). Every existing
password user is unaffected (both NULL; the auth path never reads them). A
partial unique index `(tenant_id, sso_connection_id, external_id)` backs re-POST
idempotency. No trigger added to the core `users` table — SCIM writes run inside
the resolved tenant's RLS context, so cross-tenant consistency is guaranteed by
construction.

## D8 — Added `scim_groups` + `scim_group_members` (beyond the 3-table spec)
Deliverable #4 (SCIM Groups CRUD) needs storage the 3-table schema spec didn't
name. Added two tenant-scoped FORCE-RLS tables for the Group mirror.

## D9 — CSRF: signed state cookie bound to the IdP round-trip
A short-lived (10m) HS256 state token (domain-separated `::sso-state` key) in an
httpOnly cookie binds the callback to the login request: SAML RelayState === the
cookie nonce; OIDC state+nonce === the cookie nonce, and the id_token nonce is
checked. SAML's cookie is `SameSite=None` (the ACS is a cross-site POST — Lax
would drop it); OIDC's is `SameSite=Lax` (top-level GET). `Secure` in production.

## D10 — SCIM token → tenant via the admin pool
The SCIM request carries no JWT/tenant. The bearer token's sha256 hash is
globally unique (partial unique index) and resolved to its tenant via the
admin pool (RLS-bypassing, the same path AuthService uses for email→tenant).
Token format `scim_<32B base64url>`, sha256 at rest (high-entropy → no argon2,
mirrors the email/reset token util).

## D11 — OIDC client secret encrypted at rest (AES-256-GCM)
Mirrors the accounting QBO TokenEncryptionService, keyed by
`SSO_TOKEN_ENCRYPTION_KEY`. The SAML x509 cert is the IdP's PUBLIC cert (safe to
store/return); the OIDC client secret is the only secret and is never returned
in a DTO (only `oidcClientSecretSet: boolean`).

## D12 — Web admin path: `/settings/sso` (not `/admin/sso`)
The brief named `apps/web/app/admin/sso/`, which doesn't exist in this repo.
Mirrored the real settings surface: `apps/web/src/app/(app)/settings/sso/` +
a settings-tab registry entry, matching the other 10 settings pages.

## D13 — SP-initiated only in v1
No IdP-initiated SAML (per the brief). The state cookie is generated at our
`/login`, so an unsolicited IdP POST has no matching cookie and fails closed.

## D14 — Settings tab strings are English-only (TODO i18n)
The whole `/settings` surface is English-only today (no next-intl wiring on
these pages). Mirrored that (Rule 9 > Rule 4 here) with a `TODO(i18n)` marker
to add es/fr parity when settings migrates to next-intl.

## D15 — SSO login success hands tokens to the web via URL fragment
The ACS/callback 302-redirects to `${WEB_PUBLIC_URL}/login/sso/complete#access_token=…&refresh_token=…`.
Fragment (not query) keeps tokens out of server logs / Referer. The web
completion page (consuming the fragment like a normal login) is a 🟡 follow-up.
