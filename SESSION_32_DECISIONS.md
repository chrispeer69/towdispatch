# Session 32 — White-Label Customer Portal

## TL;DR

Tenants can now put a branded, customer-facing portal on their own domain.
A towed customer signs in (auth fully separate from staff), sees their jobs
and invoices, and pays online — all under the tow company's logo, colors,
and support contact. Staff configure it in **Settings → White-Label Portal**.

- DB: `tenant_branding`, `customer_portal_users`, `customer_portal_auth_tokens`
  (FORCE RLS, audit + updated_at + cross-tenant-consistency triggers).
- API: `apps/api/src/modules/customer-portal/` — staff branding admin
  (operator JWT) + a separate portal auth realm (`-portal` JWT audience,
  `PortalAuthGuard`) with host resolution, signup/verify/login/reset, jobs,
  invoices, and a pay-link into the existing `/pay/[token]` flow.
- Web: `apps/web/src/app/(app)/settings/branding/` (admin) and
  `apps/web/src/app/portal/` (customer portal, en+es).
- Custom domains: resolve by Host; runbook in `CUSTOM_DOMAIN_RUNBOOK.md`.

---

## Decision log

### Portal as a route in the existing web app (not a new app)
`apps/web/src/app/portal/*`, a real path segment (NOT a route group — a
`(portal)` group would collide with the staff `/login`, `/dashboard`, etc.).
Reuses the API client base, Tailwind/Next pipeline, and deploy. A second
Next app would duplicate all of it with no precedent in the repo.

### Portal auth: separate JWT realm, mirroring driver-auth
Modeled on the existing driver-app auth (the repo's proven "second auth
realm" pattern): a dedicated `-portal` JWT audience + signing key
(`JWT_PORTAL_SECRET`, derived from `JWT_SECRET` via `::portal`), a separate
`PortalAuthGuard`, and a separate table (`customer_portal_users`). A portal
token can never authenticate against the operator or driver API (distinct
key + audience; unit-tested). Reuses `PasswordService` (argon2id) and the
sha256 token helpers. **Why not reuse staff JWT:** customers are not staff,
must never reach the operator surface, and live in a different table.

### Signup model C — email-gated, no enumeration
Signup only creates a portal login when the submitted email matches a
`customers` row in the resolved tenant; otherwise (and for an
already-registered email) it returns the same neutral `{ ok: true }`. This
is the only model that yields a working signup→verify→jobs flow (jobs need a
linked customer) without leaking which emails are customers. Customer lookup
runs on the admin pool (RLS-bypassing) since the tenant is pre-login.

### Host resolution
The portal is multi-tenant by `Host`. The browser's host is forwarded by the
web BFF to the API in `X-Portal-Host` (the API never sees it directly —
the web app is the client). Resolution order: verified custom domain →
`<slug>.<PORTAL_BASE_DOMAIN>` fallback. Runs on the admin pool (tenant not
yet known) — the same shape as `PaymentsPublicController`.

### Custom domain verification flow
`custom_domain` is globally unique (partial unique index). A domain only
routes once `custom_domain_verified_at` is stamped (squat-proof). Saving or
changing a domain resets the stamp. DNS + Railway attachment + the stamp are
manual operator steps (`CUSTOM_DOMAIN_RUNBOOK.md`); a self-serve
DNS/HTTP verification check is deferred.

### Invoice pay reuses the existing public pay page
The portal never talks to Stripe. `POST /portal/invoices/:id/pay-link`
ensures the (owned) invoice has a `payment_token` and returns
`<WEB_PUBLIC_URL>/pay/<token>`; the browser is sent to the existing
`/pay/[token]` page, which already renders Stripe Elements and honors
`PAYMENTS_PROVIDER`. No Stripe provider code was touched.

### Cross-customer isolation is app-layer, not RLS
RLS isolates by tenant only. Within a tenant, a portal user sees only their
own customer's data via an explicit `customer_id = ctx.customerId` filter in
`PortalAccountService`, where `customerId` comes from the verified JWT (never
the request body). Covered by a dedicated service-level test.

### Logo upload via base64 JSON (not multipart)
Logos ride as base64 in a normal JSON body to `POST /tenant-branding/logo`,
reusing the JSON API + `JwtAuthGuard` + the existing `StorageProvider`
rather than adding Fastify multipart. Logos are small; this keeps the
surface minimal.

### Portal i18n: self-contained en+es dictionary
The repo has no app-wide i18n framework and migrating the staff app to
next-intl is out of scope. The customer portal (where Spanish matters most —
tow customers) ships a self-contained `en`/`es` dictionary with
Accept-Language detection (`apps/web/src/lib/portal/i18n.ts`). The internal
staff branding admin stays English, matching every existing settings page.

### Stateless portal token (no refresh rotation in v1)
Like the driver app, the portal issues a single 24h access token (no
refresh-token table / rotation / server-side revoke). Logout just clears the
cookie. Refresh rotation + revocation is a documented follow-up.

---

## Shipped ✅

- ✅ `0037_white_label_portal.sql` + 3 Drizzle schemas + index exports.
- ✅ Shared Zod contracts (`tenant-branding`, `customer-portal`).
- ✅ Config: `PORTAL_BASE_DOMAIN`, `JWT_PORTAL_SECRET`, `JWT_PORTAL_TTL`
  (+ `ConfigService` getters). `JwtService.signPortal/verifyPortal`.
- ✅ API `customer-portal` module: `PortalAuthGuard`, `@CurrentPortalUser`,
  `PortalAuthService` (resolve/branding/signup/login/verify/forgot/reset/me),
  `PortalAccountService` (jobs/invoices/pay-link), `TenantBrandingService` +
  controller (staff), registered in `AppModule`.
- ✅ Web staff admin: `settings/branding` page + form (logo upload, color
  pickers, support fields, custom domain + status pill, live preview),
  BFF routes, new settings tab.
- ✅ Web customer portal: host-resolved branded layout, login/signup/
  forgot/reset/verify, dashboard (jobs + invoices), job detail, pay button;
  portal cookie + client + en/es i18n; BFF auth routes.
- ✅ Tests: unit (host parsing + portal JWT isolation, **7 passing**), RLS
  (cross-tenant + consistency triggers), service integration
  (signup→verify→login + cross-customer jobs/pay) — DB specs self-skip with
  no DB, run in the dockerized/CI DB.
- ✅ `CUSTOM_DOMAIN_RUNBOOK.md`.

## Deferred 🟡

- 🟡 **Evidence photos + driver photo** in portal job detail. The
  `drivers` table has no photo column and job evidence is S3-presigned via a
  separate provider; wiring presigned GET URLs into the portal is deferred.
  The DTO fields (`driver.photoUrl`, `evidencePhotoUrls`) exist (null / `[]`)
  so the contract is stable.
- 🟡 **Self-serve custom-domain verification** (DNS/HTTP check). Today the
  stamp is set manually (runbook). The data model + status pill are ready.
- 🟡 **Portal refresh-token rotation + server-side revoke.** v1 is a
  stateless 24h token (mirrors driver app).
- 🟡 **White-label email theming.** Portal verify/reset emails reuse the
  platform templates with the tenant name + a portal-host link; full
  tenant-logo/color email bodies are deferred.
- 🟡 **Playwright e2e for the portal.** Needs wildcard host / DNS in the
  e2e harness; covered for now by service-level + RLS + unit tests.
- 🟡 **SSO for portal users** — explicitly out of scope per the brief.

## Not touched

- Staff auth (`auth` module), the Stripe provider, the `payments` module,
  and the `/pay/[token]` page — all reused as-is.

---

## Test coverage

| Layer | File | Runs |
|---|---|---|
| Unit | `apps/api/test/customer-portal-host.spec.ts` | always (7 passing) |
| RLS | `apps/api/test/customer-portal-rls.spec.ts` | with DB |
| Integration | `apps/api/test/customer-portal-service.spec.ts` | with DB |

## Known issues / scoping notes

- Local-disk logo URLs are relative (`/files/<key>`) and served by the API;
  in production the `StorageProvider` (S3) returns absolute URLs. The web
  prefixes relative URLs with `NEXT_PUBLIC_API_URL` for `<img>` rendering.
- The staff `TenantBrandingService` write path (upsert + domain-reset + base64
  logo decode) has no dedicated unit test; it's exercised by typecheck + build
  and the contract is validated by the shared Zod schemas. The "branding fetch"
  read path is covered by the integration `auth.branding(host)` test. A focused
  write-path integration test is a low-risk follow-up.
- Portal login timing is minutely distinguishable between inactive/locked
  accounts (no password-hash burn) and a wrong password (hash burn). This
  mirrors the staff `auth.service.ts` shape exactly — no new oracle is
  introduced; the missing-account path does burn argon2 work to mask
  enumeration.
- Pre-existing biome diagnostics in `apps/api/src/main.ts`,
  `apps/api/test/integration/auth.spec.ts`, and
  `apps/api/test/integration/import.spec.ts` are unchanged by this work
  (they exist on `master`). All 25 paths in this diff are biome-clean.

## Commands

```bash
pnpm typecheck && pnpm biome check && pnpm test && pnpm build
# DB-backed tests: run with DATABASE_URL (+ DATABASE_ADMIN_URL) pointed at a
# migrated Postgres; otherwise the RLS/integration specs self-skip.
```
