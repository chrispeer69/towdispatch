# US Tow DISPATCH

The operating system for the modern towing industry.

A multi-tenant SaaS platform built to serve 10,000+ towing companies and 100M+ dispatched jobs per year. Replaces Towbook + a stack of glue tools with one product: dispatch board, driver app, customer billing, Stripe payments, QuickBooks accounting, and motor-club integration (Agero today, more in Phase 1).

**Phase status:** end of Phase 0. The platform is ready to replace the founder's Towbook subscription. See [`apps/PHASE_0_EXIT_REPORT.md`](apps/PHASE_0_EXIT_REPORT.md) for the cancellation-readiness checklist.

---

## Architecture at a glance

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full decision log and invariants.

```
apps/
├── api/         NestJS + Fastify backend, Postgres-backed, Redis for socket pub-sub
├── web/         Next.js 15 App Router frontend (operator console)
├── driver-ios/  Native iOS driver app (Session 6)
└── e2e/         Playwright suite that runs in CI on every PR

packages/
├── db/          Drizzle schema + raw SQL (RLS, roles, audit triggers, perf indexes, auth hardening)
├── shared/      Zod schemas, types, error codes, role constants
└── ui/          Shared React components (placeholder)
```

The non-negotiable invariants (enforced in code, tested in CI):

1. **RLS is sacred.** Every tenant table has `FORCE ROW LEVEL SECURITY`. The app connects as `app_user`, not the superuser. Every request runs in a transaction that `SET LOCAL app.current_tenant_id = …` so RLS engages. See `apps/api/test/security/rls-bypass.spec.ts`.
2. **Audit everything.** Trigger-driven `audit_log` captures before/after state for every INSERT/UPDATE/DELETE on tenant tables.
3. **Soft delete only.** `deleted_at` everywhere. Hard purge is a separate scheduled job (Phase 1).
4. **UUIDv7 only.** Sortable, indexable, no exposing internal counts.
5. **No `any`.** Strict TypeScript, `exactOptionalPropertyTypes: true`.
6. **All external calls are observable.** Idempotency keys on writes; PII redacted from logs.

---

## Prerequisites

- **Node.js** 22 LTS (any 20+ should work for development)
- **pnpm** 9 (`corepack enable && corepack prepare pnpm@9 --activate`)
- **Docker Desktop** (for Postgres + Redis + Mailhog locally)
- **Postgres** 16 with PostGIS — provided by docker-compose

---

## Local setup (fresh clone → running stack)

```bash
# 1. Install deps
pnpm install

# 2. Bring up infra (Postgres + Redis + Mailhog)
docker compose up -d

# 3. Copy env templates
cp .env.example .env
cp .env.example apps/api/.env
cp .env.example apps/web/.env.local

# 4. Apply migrations + seed dev tenants
pnpm --filter @ustowdispatch/db migrate
pnpm --filter @ustowdispatch/db seed

# 5. Run dev servers (API + web in parallel)
pnpm dev
```

URLs:

- API: <http://localhost:3001>
- Web: <http://localhost:3000>
- Mailhog UI: <http://localhost:8025>
- Liveness probe: <http://localhost:3001/health>
- Readiness probe: <http://localhost:3001/ready>
- Prometheus metrics: <http://localhost:3001/metrics>

Verify the stack is healthy:

```bash
curl -sf http://localhost:3001/ready
# → {"status":"ok","checks":{"db":"ok","redis":"ok"}}
```

---

## Tests

```bash
# Unit + integration (DB-gated specs skip without Postgres)
pnpm --filter @ustowdispatch/api test

# Web vitest (presentation tests)
pnpm --filter @ustowdispatch/web test

# Typecheck every workspace
pnpm typecheck

# Build every workspace
pnpm build
```

### E2E (Playwright)

```bash
# Boot the stack first (docker + api + web running on the e2e ports)
# Then:
pnpm --filter @ustowdispatch/e2e exec playwright install chromium
E2E_RUN_REQUIRES_STACK=1 pnpm --filter @ustowdispatch/e2e test
```

CI runs the full suite on every PR via `.github/workflows/e2e.yml` — Postgres + Redis service containers, API + web started as background processes, Chromium (+ Firefox + WebKit on master push).

---

## Operational scripts

Everything in `scripts/`:

| Script | Purpose |
|---|---|
| `scripts/check-migrations.sh` | Validates migration order, naming, and header comments. Run in CI before deploy. |
| `scripts/check-env.sh` | Warns if required env vars are missing or set to dev placeholders in production. |
| `scripts/deploy.sh` | Deploy template — Railway by default, AWS dry-run path documented. Idempotent on the same SHA. |
| `scripts/seed-driver-job.sh` | Seeds a driver + job for the Session 6 walkthrough. |
| `scripts/verify-*.sh` | Per-session acceptance scripts retained for historical walkthroughs. |

---

## Workspace scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Run API + web in parallel |
| `pnpm build` | Build everything |
| `pnpm typecheck` | Type-check every workspace |
| `pnpm lint` | Biome lint |
| `pnpm format` | Biome format |
| `pnpm test` | Unit + integration tests across packages |
| `pnpm --filter @ustowdispatch/e2e test` | Playwright e2e (gated on `E2E_RUN_REQUIRES_STACK=1`) |
| `pnpm --filter @ustowdispatch/db generate` | Generate a new Drizzle migration |
| `pnpm --filter @ustowdispatch/db migrate` | Apply migrations + raw SQL |
| `pnpm --filter @ustowdispatch/db seed` | Idempotent dev seed |
| `pnpm --filter @ustowdispatch/db studio` | Open Drizzle Studio |
| `pnpm --filter @ustowdispatch/db reset` | Drop + recreate dev DB (refuses if `NODE_ENV=production`) |

---

## Deploy

Current platform: **Railway**. AWS migration path documented in `docs/runbooks/scaling-event.md` §3.

```bash
# Dry-run a production deploy from master
DRY_RUN=1 scripts/deploy.sh production

# Real production deploy (CI does this on master push)
scripts/deploy.sh production
```

The deploy script:

1. Runs `check-migrations.sh` + `check-env.sh`
2. Installs deps, builds api + web
3. Runs unit + integration tests + typechecks
4. Applies forward-only migrations
5. Pushes the new artifact to Railway
6. Probes `/health` + `/ready` until both return 200 (60s timeout)
7. Tags the release with the git SHA

---

## Runbooks

Production operating procedures — read **before** something breaks at 2 AM:

| Runbook | When to use |
|---|---|
| [`docs/runbooks/incident-response.md`](docs/runbooks/incident-response.md) | Anything labeled SEV-1/2/3 |
| [`docs/runbooks/database-restore.md`](docs/runbooks/database-restore.md) | Data loss, bad migration, PITR |
| [`docs/runbooks/tenant-onboarding.md`](docs/runbooks/tenant-onboarding.md) | New customer signs up |
| [`docs/runbooks/motor-club-down.md`](docs/runbooks/motor-club-down.md) | Agero gateway degraded |
| [`docs/runbooks/payment-processor-down.md`](docs/runbooks/payment-processor-down.md) | Stripe degraded |
| [`docs/runbooks/scaling-event.md`](docs/runbooks/scaling-event.md) | Traffic spike, CPU/memory pressure |
| [`docs/runbooks/security-incident.md`](docs/runbooks/security-incident.md) | Suspected breach, credential compromise |
| [`docs/runbooks/secrets-rotation.md`](docs/runbooks/secrets-rotation.md) | Routine rotation OR emergency response |
| [`docs/runbooks/backup-strategy.md`](docs/runbooks/backup-strategy.md) | Backup cadence + retention reference |
| [`docs/observability.md`](docs/observability.md) | Alert thresholds + dashboard reference |

---

## Session reports (history)

Each session's deliverables and decisions are documented at:

- `apps/api/SESSION_16_REPORT.md` — Towbook importer
- `apps/api/SESSION_17_REPORT.md` — type cleanup
- `apps/api/SESSION_17A_REPORT.md` — perf / security / observability
- `apps/SESSION_17B_REPORT.md` + `apps/SESSION_17B_ADDENDUM.md` — a11y / error states / E2E
- `apps/SESSION_17C_REPORT.md` — runbooks / deployment / Phase 0 exit

The exit gate: [`apps/PHASE_0_EXIT_REPORT.md`](apps/PHASE_0_EXIT_REPORT.md).

---

## Tier Offer Composer environment variables (Moat #3)

The Tier Offer Composer is the collective-bargaining mechanism that lets operators propose pricing offers to motor-club account managers and run dispatches against the resulting acceptance ledger. It reads the following env vars; most are shared with other features, two are new in Session 4.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `JWT_SECRET` | yes | — | Already used elsewhere. Magic-link tokens for the public `/offers/[token]` landing page are HS256-signed with this secret (audience `tier-offer-magic-link` provides domain separation from access / refresh / mfa / driver tokens). |
| `SENDGRID_API_KEY` | recommended | empty | When non-empty the invitation email is delivered via the SendGrid HTTP API; otherwise the SMTP fallback handles it (mailhog locally). |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | **yes in production** | empty | **New (Session 4).** Base64-encoded ECDSA P-256 SPKI public key SendGrid surfaces in its event-webhook UI. The webhook handler at `POST /webhooks/sendgrid/tier-offers` verifies the signature on each delivery using this key. When unset, the webhook accepts requests with a logged warning (development friendliness); production deploys MUST set the key. |
| `TIER_OFFER_CRON_ENABLED` | no | `false` | **New (Session 4).** Gates the lifecycle cron — a 5-minute tick that walks offer status `sent` → `event_active` → `event_concluded` and expires non-responding recipients past their `acceptance_deadline_at`. Set to `true` only on the production API to avoid dev / CI churn. |
| `WEB_PUBLIC_URL` / `NEXT_PUBLIC_WEB_URL` | yes | localhost | Already used by other features; the magic-link absolute URLs land at `${WEB_PUBLIC_URL}/offers/[token]`. Must point at the real public domain on the production API server so motor clubs see the right URL in their inbox. |

The SendGrid event webhook URL to register on the SendGrid side (Settings → Mail Settings → Event Webhook) is `https://<api-domain>/webhooks/sendgrid/tier-offers`. Enable the `delivered`, `open`, `bounce`, `dropped`, and `deferred` events; the others are intentionally ignored.

---

## License

Proprietary — © US Tow DISPATCH, Inc.

<!-- trigger deploy May 20, 2026 -->

