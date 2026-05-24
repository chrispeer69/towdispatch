# Session 38 — Enterprise SSO (SAML 2.0 + OIDC + SCIM 2.0)

## TL;DR
Shipped a self-hosted enterprise identity layer, additive to the existing
password auth: per-tenant **SAML 2.0** and **OIDC** SP-initiated login, **SCIM
2.0** user + group provisioning, a forensic login-audit trail, an env gate
(`ENTERPRISE_SSO_ENABLED` + per-tenant allowlist), and a `/settings/sso` admin
UI. An SSO login mints the **same** access+refresh session as a password login
(no second auth realm). Real libraries (`@node-saml/node-saml`, `openid-client`)
— the IdP is mocked in tests, never the library. 28 unit tests green; full
typecheck + biome + build clean.

## What shipped ✅

**Migration + schema** (`packages/db/sql/0048_enterprise_sso.sql` + 5 drizzle
schema files + 2 additive `users` columns)
- `sso_connections`, `scim_tokens`, `sso_login_audit`, `scim_groups`,
  `scim_group_members` — all FORCE RLS, audit triggers, cross-tenant
  consistency triggers, soft-delete, shared updated_at trigger.
- `scim_tokens.token_hash` partial-unique (idempotency); `users.external_id` +
  `users.sso_connection_id` (nullable) + partial-unique for SCIM re-POST.

**Shared Zod contracts** (`packages/shared/src/sso/`)
- Connection DTO/payloads (secrets never returned), SCIM User/Group resources
  (RFC 7643/7644), PatchOp, ListResponse, token mint, login-audit DTO.
- 9 new error codes in `error-codes.ts`.

**API module** (`apps/api/src/modules/sso/`)
- `saml/saml.provider.ts` — `parseSamlAssertion` (real XML-DSig validation,
  pinned cert, audience + NotOnOrAfter checks) + `buildSamlLoginUrl`.
- `oidc/oidc.provider.ts` — auth-code + PKCE, id_token validation against
  JWKS, discovery cached with 1h TTL.
- `scim/` — `ScimService` (Users + Groups CRUD, idempotent externalId,
  de-provision = soft-delete + session revoke), `ScimAuthGuard` (token→tenant),
  `scim.controller.ts` (application/scim+json), pure `scim-filter.ts`
  (RFC 7644 eq + and; others logged + degraded).
- `attribute-mapping.ts` (pure claim→user mapping), `sso-state.service.ts`
  (signed CSRF cookie), `sso-secret.service.ts` (AES-256-GCM for OIDC secret).
- `sso.service.ts` (connection CRUD, login orchestration, JIT provisioning,
  token mint, audit), `sso.controller.ts` (public IdP-facing SAML/OIDC),
  `sso-admin.controller.ts` (OWNER/ADMIN: connections, SCIM tokens, audit).
- `AuthService.issueSsoTokens()` — delegates to the untouched issuance core.
- `registerSsoBodyParsers` (SAML form-urlencoded + SCIM scim+json), wired into
  `main.ts` and the integration test bootstrap; `SsoModule` in `app.module.ts`.

**Config** — `ENTERPRISE_SSO_ENABLED` (default false), `ENTERPRISE_SSO_TENANTS`
(CSV, empty = none), `SSO_TOKEN_ENCRYPTION_KEY`; `config.enterpriseSso` getter
with the `isTenantAllowed` predicate.

**Web admin** (`apps/web/src/app/(app)/settings/sso/`) — connection list +
add (SAML/OIDC) modal, enable/disable, delete, **test-login** launcher; SCIM
token mint (plaintext shown once) + revoke; login-audit table. BFF proxy at
`/api/sso/[...path]` → `/admin/sso/*`. New settings tab + resource fetchers.

**Tests**
- Unit (28, all green locally): SAML assertion parse — **valid / expired /
  bad-signature / wrong-audience / malformed** (fixtures signed with node-saml's
  own signer + a throwaway cert); OIDC id_token validation against an in-process
  mock IdP (valid / wrong-nonce / expired) + PKCE; SCIM filter parse (11);
  attribute mapping (8).
- Integration (CI-gated, self-skip without DB): SCIM CRUD lifecycle (create +
  idempotent re-POST + get + filter + PATCH-deactivate→session-revoke + group
  CRUD + 401), SAML SP-flow (login redirect + full ACS round-trip → provisioned
  user + tokens + success audit + RelayState-mismatch CSRF reject).
- RLS isolation (`test/sso-rls.spec.ts`, CI-gated): per-table tenant isolation,
  WITH CHECK, fail-closed, consistency triggers, token_hash uniqueness.

## Deferred 🟡
- **Integration + RLS specs not run locally** — no Postgres/Redis in this
  environment; they self-skip (`describeIfDb`) and run in CI. Written +
  typecheck-clean.
- **Web `/login/sso/complete` page** — the ACS/callback redirect to the web
  with tokens in the fragment is implemented server-side; the small web page
  that consumes the fragment and stores the session is a follow-up.
- **SAML SLO / IdP-initiated** — SP-initiated only in v1 (per brief). `slo_url`
  is stored but no SLO endpoint yet.
- **SCIM `/ServiceProviderConfig` + `/ResourceTypes`** discovery endpoints — not
  required by the provisioning path; add if an IdP demands them.
- **Group→role mapping** — SCIM groups are mirrored but do not yet drive role
  assignment; SCIM users default to `dispatcher`.

## Not touched
- Existing password auth, JWT issuance core (only an additive public method),
  the global JwtAuthGuard, and every non-SSO module.

## Known issues / notes
- When a SCIM token has no `connection_id`, the `users` partial-unique index
  (which includes the nullable `sso_connection_id`) does not enforce
  cross-row uniqueness (Postgres NULLs distinct) — idempotency then rests on the
  service's email lookup, which is the primary mechanism anyway.
- `openid-client` pinned to v5 (CJS); loads fine under the ESM runtime via
  Node's named-export interop.

## Verification
```
pnpm -r run typecheck                       # ✅ all packages
biome check (SSO files)                      # ✅ 0 diagnostics (23 pre-existing repo warnings unrelated)
vitest run src/modules/sso                   # ✅ 28 passed
pnpm build (shared, db, api, web)            # ✅ /settings/sso compiled
```
Integration/RLS specs: run in CI (Postgres + Redis); self-skip locally.

## Commands
- Enable for a tenant: `ENTERPRISE_SSO_ENABLED=true ENTERPRISE_SSO_TENANTS=<tenant-uuid,...>`
- SAML login: `GET /sso/:slug/saml/login` · ACS: `POST /sso/:slug/saml/acs`
- OIDC login: `GET /sso/:slug/oidc/login` · callback: `GET /sso/:slug/oidc/callback`
- SCIM base: `/scim/v2` (Bearer `scim_…` token) — Users + Groups
- Admin: `/admin/sso/connections|tokens|audit` (OWNER/ADMIN) · UI: `/settings/sso`
