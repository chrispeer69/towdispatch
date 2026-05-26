# SESSION 55 — Customer Self-Serve Portal — Decision Log

Branch: `feature/session-55-customer-portal` (off `origin/master` @ 13439ba)
Date: 2026-05-24

---

## D0 — Base was broken (committed merge-conflict markers on master) — FIXED

`origin/master` @ `13439ba` ("Merge PR #129 Enterprise SSO") was committed **with
unresolved git conflict markers** in 6 files — the SSO merge was botched. The base
did not type-check. Per CLAUDE.md Rule 1 (never ask; pick the conservative path,
document, continue) and Rule 10 (done = compiles), I resolved them as **additive
unions** (the obviously-intended merge result — every conflict was "HEAD added
features A; SSO branch added feature B", never a true content overlap):

| File | Resolution |
|------|------------|
| `apps/api/src/app.module.ts` | keep both module lists (PublicApi…MarketplaceApi **and** SsoModule) |
| `apps/api/src/config/config.schema.ts` | keep both env blocks (Phase-0…AI-retention **and** SSO) |
| `apps/api/src/config/config.service.ts` | keep both getters; added a `}` to close `marketplaceWebhookDeliveryEnabled` before `enterpriseSso` |
| `apps/web/src/app/(app)/settings/tabs.ts` | split into two tab objects (`branding` **and** `sso`) |
| `packages/db/src/schema/index.ts` | keep both re-export blocks |
| `packages/shared/src/constants/error-codes.ts` | keep both code blocks (Auction/Marketplace **and** SSO/SCIM) |

Committed as a **separate first commit** so it is independently reviewable /
cherry-pickable back to master. **This is not Session-55 scope** — flagged 🟡 for
the maintainer: master needs this fix regardless of this PR.

---

## D1 — Naming: do NOT clobber Session 32 White-Label Portal

S32 already owns the literal `customer-portal` API module, the `/portal` web routes
(login/signup/dashboard/jobs), and the `customer_portal_users` / `customer_portal_auth_tokens`
tables (migration 0037). S55 is a **different** feature (per-impound, account-less,
magic-link). Renaming to avoid clobber is non-destructive and reversible:

- **API module:** `apps/api/src/modules/self-serve-portal/` (sibling to `customer-portal/`)
- **Shared contracts:** `packages/shared/src/self-serve-portal/`
- **Web routes:** `/recover` route group (vehicle owner "recover your vehicle" — the
  impound domain term). Reuses S32's host→branding resolution, not its `/portal` tree.
- **DB tables:** kept the spec's `customer_portal_*` names — they do **not** collide
  with S32's two tables and the namespace is conceptually correct.

The launch prompt's `apps/api/src/modules/customer-portal/...` and `/portal/...` paths
are overridden by this decision for safety.

## D2 — Migration number: 0051

Highest on master is `0050_enterprise_sso.sql`. → `0051_self_serve_portal.sql`.
(Parallel sessions hold 0042–0050 on their own feature branches; reconcile contiguity
at merge per the repo's migration-numbering convention. migrate.ts re-applies all
idempotent `sql/*.sql` each run, so gaps are harmless.)

## D3 — Payment rail: minimal-touch parallel rail (NOT the invoice rail)

The shared payments path is **invoice-coupled + Stripe Connect**: `createPaymentIntent`
requires `invoiceId`, and the webhook `onPaymentIntentSucceeded` early-returns without
`invoiceId` metadata. The advisor recommended generating a real invoice per release
intent. **Rejected** because:

1. Invoices require a billing **customer/account FK**. A walk-in vehicle owner using
   self-serve is **not** an account holder — there may be no customer to bill.
2. The spec's data model is explicitly release-intent-centric
   (`customer_portal_release_intents.stripe_payment_intent_id`, `customer_portal_payments`).
3. Refunds are explicitly **out of v1 scope** (operator handles via existing billing),
   which was the advisor's main argument for the invoice rail.

**Chosen:** own `release_intent` + `customer_portal_payments` as source of truth.
Create the PaymentIntent via the existing `PaymentProvider` with
`connectedAccountId = tenants.stripeAccountId` and `metadata.kind = 'self_serve_portal'`
+ `metadata.releaseIntentId`. Reuse the existing `stripe_events` idempotency table by
adding **one additive, metadata-guarded branch** to `onPaymentIntentSucceeded` — the
idempotency INSERT runs *before* the type switch, so the branch cannot weaken it. On
success: mark release_intent `paid` → `ready_for_gate`, emit a domain event.

🟡 Follow-up: portal payments are not yet posted to the accounting ledger
(`AccountingService`). Documented for a v2 reconciliation pass.

## D4 — Auth: magic link, SMS-first / email-fallback

Chose **magic link** over OTP: no shared secret to phish, one tap on mobile (80% of
traffic). Single-match lookup sends the link to the owner phone on file (Twilio SMS) or,
if absent, the owner email (SendGrid). If **neither** channel is configured for the
tenant, the lookup endpoint returns a clear `magic_link_no_channel` error and sends
nothing (per the DO-NOT list).

## D5 — Session scope: single impound, not account-wide

A portal session is bound to **one** impound + a verified identity. No cross-vehicle
or account-wide access — smallest blast radius if a link leaks. Session cookie is
HttpOnly + Secure + SameSite=Lax, HMAC-signed, 60-min sliding lifetime.

## D6 — ID verification: self-attested in v1; gate operator re-verifies physically

V1 stores self-attested name/DOB/ID-type/ID-**last4-only** (never full number, never SSN).
`verified_by = 'self_attested'`. The portal only flags **"id-on-file"**; the existing
impound release gate (`evaluateReleaseGate`, requires `idVerified` + `ownershipDocVerified`)
still forces a physical check at the yard. Stripe Identity is documented as the v2 path,
not implemented. ID-last4 is **encrypted at rest** (AES-256-GCM).

## D7 — Encryption key: dedicated portal key, not the QBO key

The existing `TokenEncryptionService` lives in `accounting/` and reads
`config.quickbooks.tokenEncryptionKey`. Reusing the QBO key for portal PII is wrong
(key separation). Hoisted the AES-256-GCM helper to a shared, key-injected util and
added `SELF_SERVE_PORTAL_ID_ENCRYPTION_KEY` (32+ chars, mirrors the SSO/QBO key pattern).

## D8 — Partial payments: disallowed in v1

Must pay the full balance to reach `ready_for_gate`. `paid_cents < total_due_cents`
keeps the intent `paid`-but-not-`ready` is **not** a state we allow; a single full
PaymentIntent flips it to `ready_for_gate`. Path to enabling: accept multiple
`customer_portal_payments` rows and gate `ready_for_gate` on
`SUM(paid) >= total_due` — deferred.

## D9 — Rate limits (reuse Redis `RateLimiterService`)

- Lookup: **5 / IP / 15 min** (`rl:ssp:lookup:<ip>`)
- Magic-link send: **3 / impound / hour** (`rl:ssp:maglink:<impoundId>`)
Fail-closed if Redis is unavailable.

## D10 — Tenant resolution: reuse S32 host logic

Public requests carry no JWT, so tenant is resolved from the request **Host**:
verified custom domain → `<slug>.<portal base domain>` subdomain. Reuses S32's
`normalizeHost` / `extractSubdomainSlug` / `resolveTenantByHost`. The resolved
tenant id is set on the request context so RLS scopes every subsequent query.

## D11 — S54 yard / gate release is ABSENT on master → fallback

No `ReleaseWorkflowService` / `gateRelease` / `yard` module exists on master (S54 is an
unmerged feature branch). Fallback: on payment success the portal sets
`release_intent.status = 'ready_for_gate'` and **emits a domain event**; the operator
completes the physical release via the **existing** impound release flow
(`ImpoundService.releaseRecord` → `evaluateReleaseGate`). When S54 lands, its
`gateRelease` should additionally flip the intent to `gate_completed`. Documented.

## D12 — Env gates

- `CUSTOMER_PORTAL_ENABLED` (default **false**) — master gate; controllers 503 when off.
- `CUSTOMER_PORTAL_PAYMENT_ENABLED` (default **false**) — separate gate so the portal can
  launch **read-only** first (lookup + balance, no pay). Pay endpoints 503 when off, and
  also hard-fail if `tenants.stripeAccountId` is null (tenant not onboarded to Connect).

## D13 — Stripe webhook idempotency: reuse existing pattern

No new endpoint or secret. Reuse `POST /webhooks/stripe` + the `stripe_events`
PK + `ON CONFLICT DO NOTHING` dedupe already in `PaymentsService.handleWebhookEvent`.
