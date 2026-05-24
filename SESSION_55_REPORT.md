# SESSION 55 — Customer Self-Serve Portal — Report

Branch: `feature/session-55-customer-portal` · Base: `origin/master` @ 13439ba

## TL;DR

Shipped an account-less, per-impound **Customer Self-Serve Portal**: a vehicle
owner resolves their tenant by host, looks up their impounded vehicle (no
account), gets a magic link, self-attests ID (last-4 encrypted), sees a
fee-ledger balance, pays via Stripe Connect (Elements, PCI SAQ A), and the
release intent flips to `ready_for_gate` for the yard to finish in person.

**Two things to know up front:**
1. `origin/master` did **not** compile — it carried pervasive pre-existing
   corruption (committed merge-conflict markers, dropped `/**`/braces, merged
   getters, two-file splices, duplicate barrel exports). I repaired the
   deterministic subset in an isolated first commit (`fix(base): …`) so the
   feature could be built and verified. See SESSION_55_DECISIONS.md **D0**.
2. The launch named module `customer-portal` + routes `/portal` — both already
   owned by the **Session 32** white-label portal. To avoid clobbering it I
   used module `self-serve-portal`, routes `/recover`, shared dir
   `self-serve-portal` (DB table names `customer_portal_*` kept — no clash).
   See **D1**.

## Decision log

Full rationale in **SESSION_55_DECISIONS.md** (D0–D13). Highlights:
- **D3 — payment rail:** minimal-touch parallel rail (NOT the invoice rail).
  Release intents/payments are the source of truth; the PaymentIntent carries
  `metadata.kind='self_serve_portal'`; one additive, metadata-guarded branch in
  `PaymentsService.onPaymentIntentSucceeded` reuses the existing `stripe_events`
  idempotency. Chosen because a walk-in owner has no billing-customer FK and
  refunds are out of v1 scope.
- **D6 — ID:** self-attested + last-4 only, encrypted (AES-256-GCM, dedicated
  key D7); gate operator physically re-verifies. Stripe Identity = v2.
- **D11 — S54 absent:** the yard gate workflow isn't on master; payment success
  emits `ready_for_gate` and the operator finishes via the existing impound
  release gate (`evaluateReleaseGate`).

## Shipped ✅

- **Migration** `packages/db/sql/0051_self_serve_portal.sql` — 4 tables, FORCE
  RLS + tenant-isolation policies, audit triggers, updated_at triggers,
  cross-tenant consistency triggers, partial-unique idempotency indexes.
- **Drizzle schema** — `customer-portal-{sessions,id-verifications,release-intents,payments}.ts`,
  registered in the schema barrel. Type-checks clean.
- **Shared Zod contracts** — `packages/shared/src/self-serve-portal/*` (lookup,
  session, id-verification, balance, release-intent + pure state machine,
  payment). `packages/shared` type-checks **green**.
- **Pure logic + 48 passing unit tests** — lookup match-quality + masking,
  session-token HMAC sign/verify/expiry/slide, balance math, release-intent
  state machine, rate-limit policy/keys, AES id-cipher, message templates.
- **API module** `apps/api/src/modules/self-serve-portal/` — service (host
  resolution, RLS-scoped reads/writes, rate limiting, lookup→magic-link,
  verify→cookie, attest, balance, release-intent + Stripe pay), public
  controller (HttpOnly sliding session cookie), module wiring, app.module
  registration.
- **Webhook handoff** — additive `self_serve_portal` branches in
  `PaymentsService` (succeeded → `ready_for_gate`; failed → intent stays open).
- **Env gates** — `CUSTOMER_PORTAL_ENABLED` (master, default false),
  `CUSTOMER_PORTAL_PAYMENT_ENABLED` (separate, read-only-first), session TTL +
  secret, dedicated ID encryption key.
- **Web** `apps/web/src/app/recover/*` — mobile-first lookup, magic-link verify,
  vehicle+balance detail, ID attestation, Stripe Elements pay, release/gate
  card; `lib/recover` client + en/es i18n.
- **Templates** — magic-link (SMS/email), receipt, ready-for-gate, reminder
  (pure, tested).

## Deferred 🟡

- **Base repair is partial (D0).** ~13 pre-existing errors remain in *unrelated*
  features and need a dedicated master-repair pass — they block a fully-green
  `pnpm typecheck`/`build`:
  - `packages/db` `webhookDeliveries`: two drizzle tables both named SQL
    `webhook_deliveries` (public-api S29 vs notifications) — a real schema
    collision, not a rename; cascades into `webhook-subscriptions.service.ts`.
  - pre-existing broken specs (`health-metrics`, `admin.controller`,
    `customer-portal-service`) and a `portal-auth.guard` cast.
  - **None are in Session-55 code** (verified: 0 type errors in
    `self-serve-portal/`).
- **Owner-contact join.** S22 `impound_records` has no owner phone/email/
  case-number/lastName columns, so v1 lookup matches plate/VIN (case = impound
  id) and magic-link delivery returns a clear "no channel" error until the
  impound→customer contact join lands. SMS path is wired to `NotificationService`;
  email-fallback delivery awaits that join.
- Integration / RLS / security test suites: written-intent documented but not
  run — they require a compiling `apps/api` build + a DB, both blocked by the
  base. The pure-logic units (incl. cross-tenant masking & rate-limit) DO run.
- Stripe Identity (v2), partial payments (D8), portal-payment → accounting
  ledger posting (D3), refund/chargeback handling.

## Not touched

Operator console routes; the S32 `customer-portal` module + `/portal` routes;
billing/invoice flows; refund logic; any DB table outside the 4 new ones.

## Test coverage

- `apps/api` self-serve-portal unit tests: **48 passed** (7 files) via
  `pnpm --filter @ustowdispatch/api exec vitest run src/modules/self-serve-portal`.
- `packages/shared` typecheck: **green**.
- biome: **clean** on all new files (api + shared + db + web).
- `apps/api` typecheck: 0 errors in new code; 13 pre-existing errors remain in
  unrelated features (see Deferred).

## Known issues

- Full `pnpm typecheck && pnpm build` cannot pass until the pre-existing base
  rot (esp. the `webhook_deliveries` table collision) is resolved.
- Magic-link delivery is effectively a no-op until owner-contact wiring lands
  (returns the documented no-channel error rather than sending).

## Commands

```
# unit tests (green)
pnpm --filter @ustowdispatch/api exec vitest run src/modules/self-serve-portal
# contracts
pnpm --filter @ustowdispatch/shared run typecheck
# lint (clean on new files)
npx biome check apps/api/src/modules/self-serve-portal packages/shared/src/self-serve-portal apps/web/src/app/recover
```
