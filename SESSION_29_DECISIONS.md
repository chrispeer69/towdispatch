# Session 29 — Public REST API + Webhooks — Decision Log

Branch: `feature/session-29-public-api` · Module: `apps/api/src/modules/public-api`

## TL;DR

Shipped the tenant-facing programmable surface: API-key auth, a versioned `/v1`
REST API (jobs/trucks/drivers/impound), webhook endpoints with HMAC-signed,
retrying delivery, an operator UI under **Settings → API & Webhooks**, and docs.
Four new RLS tables. Built on the existing `DispatchEventsService` event bus —
no new event infrastructure, no new runtime dependencies.

## Decisions

- **Key format — `tc_live_<prefix>_<secret>`.** `prefix` = 12 hex (public,
  indexed lookup handle, also displayed). `secret` = 64 hex (256-bit entropy).
  `test` env variant supported for future sandbox keys.

- **Hash algo — SHA-256, not argon2/bcrypt.** API keys are high-entropy random
  tokens, so a fast hash is correct: the secret already has 256 bits of entropy,
  rainbow tables are irrelevant, and running a slow KDF on *every* API request
  would be a self-inflicted DoS. This mirrors how Stripe/GitHub fingerprint
  tokens. `bcryptjs`/`argon2` (present in the repo) remain for **passwords**,
  where they belong.

- **Webhook signing secret is ENCRYPTED at rest, not hashed.** The spec named
  the column `secret_hash`, but outbound HMAC signing *requires the plaintext
  secret* — a hash makes signing impossible. Stored AES-256-GCM-encrypted
  (`secret_encrypted`) under `WEBHOOK_SIGNING_ENCRYPTION_KEY`, reusing the exact
  TOTP/QBO token-encryption construction already in the repo. Shown once at
  creation, never logged.

- **`api_keys.created_by` / `webhook_endpoints.created_by` are NOT NULL.** A key
  is always minted by an authenticated operator, and that user becomes the audit
  actor (`app.current_user_id`) for every write made with the key — so both the
  audit trigger and `jobs.created_by_user_id` get a valid user without a
  synthetic/system id.

- **Rate limit — 60 req/min default, per key.** Stored on the `api_keys` row
  (`rate_limit_per_min`, configurable at creation) and enforced via the existing
  Redis `RateLimiterService` keyed by key id. A per-tenant override **UI** is
  deferred per the task's DO-NOT list; the per-key column already makes the limit
  tenant-configurable at the API level.

- **Retry schedule — 1m, 5m, 30m, 2h, 12h; max 5 attempts**, then `failed`.
  Fixed ladder in `webhook-retry.logic.ts` (pure, unit-tested). Any non-2xx,
  timeout, or connection error retries.

- **Event catalog v1 — shipped:** `job.created`, `job.status_changed`,
  `impound.opened`, `impound.released`. **Deferred:** `lien.advanced` (the Lien
  Processing module is a separate session and isn't on `master`).

- **Reused the existing `DispatchEventsService`** (in-process pub/sub, already
  `@Global`) instead of adding `@nestjs/event-emitter`. Jobs already emit
  `job.created` / `job.status_changed` — zero changes to JobsService. Added two
  emits to `ImpoundService` (`impound.opened` on intake, `impound.released` on
  release) — the only modification to an existing domain module, purely additive.

- **`/v1` writes delegate to `JobsService`.** `POST /v1/jobs` reuses the intake
  flow (so a consumer can create from raw customer/vehicle data with no
  prerequisite IDs) and `PATCH /v1/jobs/:id/status` reuses `transition()`. This
  keeps the state machine + event emission authoritative — and is what makes
  webhooks fire on API-driven writes. `dispatched` is rejected via the public
  status patch (it needs driver assignment, which isn't a public surface).

- **`/v1` reads are dedicated keyset-cursor queries** returning trimmed public
  DTOs, decoupled from internal DTO churn. Keyset on the UUIDv7 id (time-sortable
  → newest-first), opaque base64url cursor that rejects non-uuids.

- **Inbound `Idempotency-Key` support** (4th table, `public_api_idempotency_keys`).
  Not in the literal 3-table deliverable, but `POST` idempotency is a
  correctness requirement for a public API (ARCHITECTURE §10) — clients retry on
  network failure. Same-key+same-body replays; same-key+different-body → 409.

- **Publish is best-effort, not transactionally atomic.** The domain emit fires
  inside the originating request's transaction (pre-commit); the publisher defers
  its fan-out with `setImmediate` so the commit lands first. A true transactional
  outbox (exactly-once enqueue) is a v2 conversation. Delivery itself is
  at-least-once with a dedupe id, which is the contract consumers expect.

- **Web UI strings are English-only**, matching every existing `/settings/*`
  page (the web app has no i18n dictionary). Spanish parity for settings is a
  repo-wide follow-up, not introduced piecemeal here.

- **Webhook URLs must be HTTPS** (Zod + DB CHECK). No plaintext sinks.

## Auth model

`/v1` controllers are `@Public()` (skip the global session `JwtAuthGuard`) and
guarded by `ApiKeyGuard` (authn, tenant + rate limit) then `ScopeGuard` (authz).
The session role grid does not apply to key traffic — no `@Roles` on `/v1`.
Management endpoints (`/public-api/*`) stay session-auth'd, Owner/Admin only.

## Tests

- **Unit (always run):** key gen/hash/parse, HMAC sign/verify + replay window,
  retry backoff ladder + exhaustion, cursor encode/decode/page, scope guard. 26
  tests, green.
- **RLS (`test/public-api-rls.spec.ts`, DB-gated):** cross-tenant isolation +
  WITH CHECK + child-consistency triggers + https CHECK + idempotency unique for
  all four tables.
- **Integration (`test/integration/public-api.spec.ts`, DB-gated):** mint key →
  `/v1/jobs` 200; wrong scope → 403; revoked → 401; write needs `jobs:write`;
  Idempotency-Key replay; publish → delivery row → retry scheduled on
  unreachable sink.

## NOT touched

Session auth (`modules/auth`), existing domain modules beyond the two impound
emits, and the per-tenant rate-limit override UI (deferred).

## Known issues / follow-ups

- Transactional outbox for exactly-once publish (currently best-effort).
- `lien.advanced` event once Lien Processing merges.
- Spanish parity for the settings UI (repo-wide).
- Per-tenant rate-limit override UI.

## Commands

```
pnpm --filter @ustowdispatch/shared run typecheck
pnpm --filter @ustowdispatch/db run typecheck
pnpm --filter ./apps/api run typecheck
pnpm --filter ./apps/web run typecheck
pnpm --filter ./apps/api exec vitest run src/modules/public-api   # unit
pnpm biome check .
```

Migration: `packages/db/sql/0037_public_api.sql` (applied by `pnpm --filter @ustowdispatch/db run migrate`).
