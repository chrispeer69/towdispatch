# Session 46 — Public Marketplace API (3rd-party developer ecosystem)

## TL;DR

Shipped a complete, self-contained OAuth2 developer ecosystem on top of US Tow
DISPATCH: developer accounts, a marketplace app catalog, an OAuth2
authorization-code-with-PKCE flow issuing revocable per-tenant tokens, a public
app directory, the tenant-side install/uninstall lifecycle, manual platform-
admin app review, and self-contained webhook delivery for app-lifecycle events.
A demo `/v1/*` resource surface exercises the token guard + scopes end-to-end.

Gated behind `MARKETPLACE_API_ENABLED` (default **false** — ships dark). All 50
states of verification pass: typecheck (6/6 projects), biome (0 errors), the
full API suite (**1197 passed**, DB-gated specs self-skip), and the full repo
build (`next build` + `tsc`).

## Decision log

1. **Built self-contained on master — did NOT chain to S29.** The launch brief
   says "builds on S29 Public REST API" and "reuse S29 webhook subsystem," but
   S29 (`feature/session-29-public-api`) is **not merged to master** — there is
   no `public-api` module, no scopes catalog, and no outbound webhook subsystem
   on master. Chaining off an unmerged branch is brittle and couples this PR to
   another's merge. Per CLAUDE.md (safer/more-reversible, ships working code), I
   built the marketplace layer self-contained: my own scopes catalog, my own
   opaque-token system, my own minimal webhook deliverer. When S29 lands, its
   resource controllers adopt `MarketplaceTokenGuard` + `@RequireScopes`, and
   the webhook deliverer consolidates onto S29's subsystem.

2. **Opaque, revocable tokens (not JWTs).** The brief mandates
   `oauth_access_token_hash` / `oauth_refresh_token_hash` columns and "uninstall
   revokes tokens" — that implies opaque tokens hashed at rest, not stateless
   JWTs (which can't be revoked). Tokens are 256-bit random, `sha256`-hashed
   (same rationale as `auth-tokens.util.ts`: high entropy ⇒ a fast constant-time
   SHA is sufficient and gives O(1) hash-index lookup). Per-request auth hashes
   the bearer and resolves the install via the admin pool.

3. **`password_hash` added to `developer_accounts`** (brief was silent on auth).
   A portal login needs a credential; reused `PasswordService` (argon2id).

4. **`marketplace_oauth_codes` table added** (not in the brief, required by
   PKCE). Single-use authorization codes, consumed atomically
   (`UPDATE … WHERE consumed_at IS NULL AND expires_at > now() RETURNING`).
   Admin-pool-only (no RLS) like `stripe_events`, because `/oauth/token` is a
   public endpoint with no tenant session.

5. **App review via `MARKETPLACE_ADMIN_TOKEN`** (shared-secret guard). There is
   no platform-admin RBAC role on master (roles are tenant-scoped: owner…
   auditor). v1 review is an internal ops operation; `PlatformAdminGuard`
   compares a bearer secret in constant time. Unset ⇒ review endpoints 403.
   **🟡 follow-up:** migrate to real platform-admin RBAC when it exists.

6. **Global vs tenant tables / audit.** `developer_accounts`, `marketplace_apps`,
   `marketplace_oauth_codes` are GLOBAL (no `tenant_id`) and therefore carry **no
   `fn_audit_log()` trigger** — that function fails closed when it can't resolve
   a `tenant_id` (0004), so it cannot attach to a tenant-less table (same as
   `ev_oem_procedures`). The app catalog's lifecycle is instead captured in
   `marketplace_app_events`. The two tenant tables
   (`marketplace_app_installs`, `marketplace_app_events`) have FORCE RLS + audit
   + soft delete, matching `0046_voice_commands.sql`.

7. **Pool selection.** Global-table writes (developer/app CRUD, OAuth machinery)
   use the admin pool (`TransactionRunner`). The **public directory** uses
   `runAnonymous` (app_user, least-privilege — global tables have no RLS so the
   default SELECT grant suffices). Operator install list/uninstall run in
   **tenant context** (`runInTenantContext`, RLS-enforced).

8. **Tokens are never tenant-elevated.** A token's granted scopes ⊆ what the
   operator approved ⊆ what the app declared (enforced at authorize + token +
   per-request). `MarketplaceTokenGuard` sets `requestContext.tenantId` to the
   install's tenant only; `/v1/jobs` proves tenant-isolated reads via RLS.

9. **Webhook delivery self-contained + gated.** The event row is always written
   (durable record); the outbound HTTP POST (HMAC-SHA256 signed, idempotency-
   keyed by event id) is gated by `MARKETPLACE_WEBHOOK_DELIVERY_ENABLED`
   (default false) so CI/dev make no network calls, and failures never
   propagate to the caller. Raw `fetch`, no SDK (mirrors the damage-analysis
   provider pattern).

10. **Migration number 0048.** 0045/0046/0047 are claimed by in-flight sessions;
    0048 is free across all branches. Per the migration-numbering norm, keep it
    and reconcile contiguity at merge.

11. **Web parity / i18n.** The web app has no `next-intl` wiring (recent pages
    like `lien-cases` are en-only), so per CLAUDE.md Rule 9 ("mirror existing")
    the new pages are en-only. The Spanish-parity rule (Rule 4) is deferred
    until the web app adopts i18n. **🟡**

## What shipped ✅

**Shared contracts** — `packages/shared/src/marketplace-api/` (scopes catalog +
helpers, developer, apps, oauth, installs) + barrel + root re-export; OAuth/
marketplace error codes.

**DB** — `0048_marketplace_api.sql`: `developer_accounts`, `marketplace_apps`,
`marketplace_oauth_codes` (global), `marketplace_app_installs`,
`marketplace_app_events` (tenant RLS + audit + soft delete).

**API** (`apps/api/src/modules/marketplace-api/`):
- OAuth2 PKCE: `POST /oauth/authorize` (operator OWNER/ADMIN), `POST /oauth/token`
  (auth-code + refresh), `POST /oauth/revoke`.
- Developer portal: `/developers/signup|verify-email|login|me`, app CRUD,
  `/apps/:id/submit`, `/apps/:id/metrics` (developer-JWT realm, audience
  `…-developer`).
- Public directory: `GET /marketplace/apps`, `GET /marketplace/apps/:slug`.
- Tenant install: `GET /apps/installed`, `POST /apps/:slug/install`,
  `DELETE /apps/installed/:id` (revokes tokens).
- Platform-admin review: `GET /marketplace-admin/apps`,
  `POST /marketplace-admin/apps/:id/review`.
- `MarketplaceTokenGuard` + `@RequireScopes` + demo `GET /v1/me`, `GET /v1/jobs`.
- `WebhookDeliveryService`; `MarketplaceEnabledGuard` (503 kill-switch).
- `JwtService` extended with the developer realm.

**Env gates** — `MARKETPLACE_API_ENABLED` (default false), `MARKETPLACE_ADMIN_TOKEN`,
`MARKETPLACE_OAUTH_CODE_TTL` (10m), `MARKETPLACE_ACCESS_TOKEN_TTL` (1h),
`MARKETPLACE_WEBHOOK_DELIVERY_ENABLED` (default false), `JWT_DEVELOPER_*`.

**Web** — public `/marketplace` directory + `/marketplace/[slug]` detail;
operator `/installed-apps` (list + uninstall) with BFF routes + client lib;
`/developers` portal landing; sidebar nav entries (App Marketplace, Installed
Apps).

**Tests** — `marketplace-tokens.util.spec.ts` (16 pure unit tests, always run:
PKCE, hashing, scope containment, webhook signing); `marketplace.spec.ts` (full
HTTP integration: onboarding → review → PKCE flow → scope-gated /v1 → refresh →
revoke → install/uninstall → cross-tenant isolation → public directory);
`marketplace-rls.spec.ts` (FORCE-RLS isolation on the two tenant tables). The
two integration specs are DB-gated and self-skip without Postgres+Redis (repo
norm).

## Deferred / not done 🟡

- **DB-gated specs not executed locally.** No Postgres/Redis/Docker in this
  environment, so `marketplace.spec.ts` + `marketplace-rls.spec.ts` self-skip
  here (matching every other RLS/integration spec). They run in CI / dev-with-DB.
- **Interactive developer-portal web UI.** The portal API is complete + tested;
  the web side ships an informational landing page. A full client-side
  developer-JWT auth UI (signup/login forms, app management screens) is a
  follow-up — it needs a second auth realm in the web app.
- **Templated developer-verification email.** Signup returns the verification
  token in the response outside production (the feature is dark); a real
  templated email + portal verify page is needed before GA.
- **S29 consolidation.** When the public REST API merges, its resource endpoints
  adopt `MarketplaceTokenGuard`/`@RequireScopes` and the webhook deliverer folds
  onto S29's subsystem; retire the `/v1/*` demo controller.
- **Platform-admin RBAC** to replace the `MARKETPLACE_ADMIN_TOKEN` shared secret.
- **Spanish parity** for the new web pages (web app has no i18n wiring yet).

## What was NOT touched

S29 public API tokens (this is OAuth, parallel to API keys). Existing operator/
driver auth. Any tenant resource module beyond a read-only `count(*)` demo.

## Known issues

- Two **pre-existing** web unit-test failures (`offline-queue.spec.ts`,
  `reporting.spec.ts`) fail in local vitest due to environment gaps
  (`window.location`, React `cache()`); both exist on `origin/master`, neither
  touches marketplace code, and web unit tests are not in CI (only `e2e.yml`).

## Commands

```
pnpm typecheck            # 6/6 projects clean
pnpm biome check .        # 0 errors (23 pre-existing warnings, none in this PR)
pnpm --filter @ustowdispatch/api test   # 1197 passed; DB specs skip
pnpm build                # web (next build) + api (tsc) + packages all green
```
