# Session 46.5 — Marketplace ↔ S29 consolidation: BLOCKED (precondition unmet)

**Status: ABORTED at the pre-flight hard gate, per the launch protocol.** No
consolidation code was written. This document is the ready-to-execute plan;
convert this branch to a real consolidation PR the moment the unblock condition
below is met.

## Why blocked

The launch brief states: *"S46 (PR #128, merged) … Both implementations now
exist in master."* **This is factually wrong as of `origin/master` @ `ac28e8a`.**

| Pre-flight gate | Result |
|---|---|
| `apps/api/src/modules/public-api` exists on master (S29) | ✅ **PASS** — PR #103 merged 2026-05-24T09:38Z |
| S29 scopes catalog present | ✅ `packages/shared/src/schemas/public-api.ts` → `apiScopeValues` |
| S29 webhook subsystem present | ✅ `public-api/webhooks/*` (publisher, worker, cron, retry, DLQ) + `crypto/webhook-signature.ts` |
| `apps/api/src/modules/marketplace-api` exists on master (S46) | ❌ **FAIL** — **PR #128 is still OPEN, not merged** |

S46 lives only on `feature/session-46-marketplace-api` (`8ce9727`). The launch's
own instruction for a failed gate is: *"ABORT and write CONSOLIDATION_BLOCKED.md
describing the gap. Do not proceed."* — which is what this is. Consolidating two
modules requires both present on one base; collapsing S46 onto S29 before S46 is
on master would mean building against a moving target (a 46.5 diff against master
would meaninglessly include all of S46, and could not land before #128 anyway).

## Unblock condition (precise — it is NOT just "merge #128")

A local `git merge-tree` of `feature/session-46-marketplace-api` against current
`origin/master` shows **conflicts** (S29 merged *after* the S46 branch was cut at
the old master `3a6fcee`). The unblock is therefore:

1. **Rebase `feature/session-46-marketplace-api` onto current `origin/master`**, resolving conflicts in (at least):
   - `packages/shared/src/constants/error-codes.ts` (both sessions appended codes)
   - `packages/shared/src/index.ts` (both added barrel re-exports)
   - `apps/api/src/config/config.schema.ts` / `config.service.ts` (both added env gates)
   - `apps/api/src/app.module.ts` (both registered a module)
2. **Merge PR #128** to master.
3. **Then** re-cut `feature/session-46-5-marketplace-s29-consolidation` off master and execute the plan below.

## Canonical primitives (verified on master @ `ac28e8a`)

**Scopes** — `packages/shared/src/schemas/public-api.ts`:
`apiScopeValues = ['jobs:read','jobs:write','trucks:read','drivers:read','impound:read']`.
Convention: **`resource:action`**. Enforced by `public-api/auth/scopes.guard.ts` + `scopes.decorator.ts`.

**Tokens** — `public-api/auth/api-key.util.ts` + `api-key-auth.service.ts`:
format `tc_<env>_<prefix>_<secret>`; `prefix` (12 hex) is the indexed public
handle; `SHA-256(full)` persisted in the `apiKeys` table; constant-time compare;
revoked/expired checks; resolves on the admin pool to `{tenantId, scopes, …}`.
**No refresh tokens, no app linkage.**

**Webhooks** — `public-api/webhooks/{webhook-publisher,webhook-delivery.worker,webhook-delivery.cron,webhook-retry.logic}.ts` + `crypto/{webhook-signature,webhook-secret-cipher}.ts` + `management/webhooks.service.ts`:
**event-driven** — `WebhookPublisher` subscribes to `DispatchEventsService`, fans
out one `webhook_deliveries` row per tenant-owned `webhookEndpoints` subscribed
to the event type; a cron/worker signs (per-endpoint AES-encrypted secret) +
retries + DLQs. Catalog `webhookEventTypeValues = ['job.created','job.status_changed','impound.opened','impound.released']` — **no app-lifecycle events**, **no per-app delivery target**.

## Ready-to-execute consolidation plan (run after unblock)

### 1. Scopes → S29 catalog (⚠ public-contract reconciliation)
S29 uses `resource:action`; S46 uses **`action:resource`** (`read:jobs`). These
collide. Resolution:
- Rename S46 scopes to S29 convention: `read:jobs→jobs:read`, `write:jobs→jobs:write`, `read:impound→impound:read`, `read:fleet→` (split to `trucks:read`+`drivers:read`).
- **Add S46-only scopes to `apiScopeValues` as the canonical home** (not duplicated): `invoices:read`, `invoices:write`, `customers:read`, `customers:write`, `vehicles:read`, `profile:read`, `webhooks:read`.
- Delete `packages/shared/src/marketplace-api/scopes.ts`; repoint all S46 imports to `apiScopeValues`/`ApiScope`.
- **⚠ Contract impact:** the `scope` string in `/oauth/token` responses changes. Acceptable **only because #128 has no production consumers yet** — this rename MUST land in the same release as #128, never after a public GA.

### 2. Tokens → S29 primitive (one verifier, two issuance paths)
S29's deliverable test requires an S46-issued token to authenticate on an S29
`/v1` endpoint. Chosen design (document in SESSION_46_5_DECISIONS.md at execution):
- **`token_kind` discriminator** column on the `apiKeys` table (`'tenant_api_key' | 'marketplace_oauth'`) + nullable `app_install_id` FK + refresh-token columns (`refresh_hash`, `access_expires_at`).
- S46's `/oauth/token` mints **S29-format** keys (`tc_live_<prefix>_<secret>`) via `generateApiKey`, stored in `apiKeys` with `token_kind='marketplace_oauth'`; `ApiKeyAuthService.resolve` already verifies them unchanged → one verifier.
- S46 uninstall + `/oauth/revoke` call S29's revocation (`revokedAt`) instead of nulling install hashes.
- Delete `marketplace-tokens.util.ts` token issuance/verification; `marketplace_app_installs.oauth_access_token_hash/refresh_token_hash` become an FK to `apiKeys` (or drop, store `app_install_id` on `apiKeys`).
- **⚠ Contract impact:** issued access-token string changes `usto_at_…` → `tc_…`. Same justification as scopes — land with #128.

### 3. Webhooks → extend S29, don't fork
S29 is tenant-endpoint/resource-event oriented; S46 is per-app-URL/lifecycle-event
oriented. Extend S29 (the brief's "secret-resolver callback" path):
- Add app-lifecycle event types to `webhookEventTypeValues`: `app.installed`, `app.uninstalled`, `app.scope_changed`.
- Add a **delivery-target resolver** so a delivery can target an app's `marketplace_apps.webhook_url` + `webhook_secret` (per-app) rather than only tenant `webhookEndpoints`. Either (a) register each install as an implicit endpoint, or (b) a `target_kind` on `webhook_deliveries` + a resolver the marketplace module registers.
- Converge signing on `crypto/webhook-signature.ts` (S46's standalone HMAC is deleted); store the per-app secret via `WebhookSecretCipher`.
- S46 keeps **event composition** (the WHAT); S29 owns **delivery** (sign+retry+DLQ+audit).
- Delete `marketplace-api/webhook-delivery.service.ts` retry/sign/POST; replace with a call into `WebhookPublisher`.

### 4. Migration (next free number — `0050` was free at last check; reconcile at execution)
Additive/idempotent, mirror `0036_impound_storage.sql`: add `token_kind`/`app_install_id`/refresh cols to `apiKeys`; FK `marketplace_app_installs → apiKeys`; drop S46 standalone token storage once unused; webhook target plumbing.

### 5. Tests
Keep all S46 OAuth/lifecycle specs + all S29 token/webhook specs green (contracts
unchanged at the HTTP layer). **Add:** (a) S46-issued OAuth token authenticates on
an S29 `/v1` endpoint; (b) an `app.installed` webhook flows through S29's
publisher → worker with signing + retry.

### 6. Files (preview)
**Delete:** `marketplace-api/marketplace-tokens.util.ts` (token half), `marketplace-api/webhook-delivery.service.ts`, `packages/shared/src/marketplace-api/scopes.ts`.
**Extend:** `public-api` `apiScopeValues`, `apiKeys` schema + `ApiKeyAuthService`, `webhook-publisher.service.ts` + `webhookEventTypeValues`, `marketplace-api/{oauth.service,installs.service,developers.service}.ts` (delegate to S29).

## Zero-public-contract-change audit
Two consolidation steps **do** change the wire contract (scope strings; access-
token format). Per the launch's STOP-and-document constraint, these are flagged
here and are acceptable **only** because S46 (#128) has no merged/GA consumers —
they must ship together with #128, never as a later break. The HTTP **routes**
(`/oauth/*`, `/marketplace`, `/developers`, `/apps/installed`) and webhook
**payload shapes** are otherwise preserved.
