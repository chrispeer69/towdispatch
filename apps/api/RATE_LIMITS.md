# API Rate Limits

_Phase 0 hardening (Session 17). Source of truth for the limits enforced by
the API. Edit this doc whenever a `@Throttle` decorator or a per-email cap
changes._

The API enforces rate limits in **two layers**:

1. **Global throttler** (`common/throttle/throttle.module.ts`) — a
   Redis-backed `@nestjs/throttler` `APP_GUARD` keyed by **client IP + route**.
   Two named windows run in parallel; a request must pass both.
2. **Per-route overrides** — `@Throttle({...})` on a controller method
   replaces the global window for that route.
3. **Per-identifier caps** — `RateLimiterService` (sliding window, Redis
   `INCR`+`EXPIRE`) inside `AuthService`, keyed by **email** (not IP) for the
   sensitive auth flows the IP-keyed throttler can't express.

Under tests a `NoopThrottlerGuard` is installed so parallel vitest forks
sharing one Redis don't 429 each other; per-email caps still have their own
coverage.

## Global defaults (env-tunable)

| Window     | Limit | TTL    | Env vars |
|------------|-------|--------|----------|
| `burst`    | 30    | 60s    | `RATE_LIMIT_BURST_LIMIT`, `RATE_LIMIT_BURST_TTL_SECONDS` |
| `sustained`| 300   | 900s   | `RATE_LIMIT_SUSTAINED_LIMIT`, `RATE_LIMIT_SUSTAINED_TTL_SECONDS` |

Applies to every route without a `@Throttle` override. Keyed by IP + route.

## Per-endpoint overrides (IP-keyed)

### `auth/*` (`modules/auth/auth.controller.ts`)

| Endpoint                      | burst (per 60s) | sustained |
|-------------------------------|-----------------|-----------|
| `POST /auth/signup`           | 5               | 20 / 900s |
| `POST /auth/check-slug`       | 30              | —         |
| `POST /auth/login`            | 10              | 60 / 900s |
| `POST /auth/mfa/setup`        | 5               | —         |
| `POST /auth/mfa/verify`       | 10              | —         |
| `POST /auth/mfa/challenge`    | 10              | —         |
| `POST /auth/refresh`          | 30              | —         |
| `POST /auth/forgot-password`  | 5               | 30 / 3600s|
| `POST /auth/reset-password`   | 5               | 30 / 3600s|
| `POST /auth/verify-email`     | (override)      | (override)|

### Other sensitive surfaces

| Endpoint                                            | burst (per 60s) | notes |
|-----------------------------------------------------|-----------------|-------|
| `POST /driver-auth/*` (`driver-experience`)         | 10              | in-truck PIN/login flows |
| `POST /users/invites/*` (`user-invites`)            | 30              | invite issue/accept |
| `POST /onboarding/*` public (`onboarding-public`)   | 5 / 3600s       | unauthenticated self-serve |
| `POST /admin/email/test` (`admin-email`)            | 10              | diagnostic, token-gated |
| `GET /_debug/boom` (`debug`)                        | 10              | smoke harness, token-gated |

(Limits are read from the `@Throttle` decorators; grep `@Throttle` to verify.)

## Per-email caps (identifier-keyed, `AuthService`)

These run **inside** the service after the email is validated, so they cap a
single account regardless of source IP.

| Flow                          | Limit | Window | On exceed |
|-------------------------------|-------|--------|-----------|
| Login (`LOGIN_RATE_LIMIT`)    | 5     | 15 min | `429 rate_limited` |
| Forgot password               | 3     | 60 min | **silent** — stops sending email but returns 200 (no account-existence leak) |
| Resend verification           | 3     | 60 min | `429 rate_limited` |

MFA challenge/verify additionally lock the **user row** after 5 failures in
15 min (`mfa_failed_attempts`), independent of the Redis windows above.

## Operational notes

- Storage is Redis (`ThrottlerStorageRedisService`); if Redis is down the
  throttler fails open (requests pass) — readiness (`/ready`) will already be
  reporting Redis down, so the orchestrator pulls the replica.
- A 429 is rendered as RFC 9457 problem+json with `code: "rate_limited"`.
- To raise/lower global limits in production, set the `RATE_LIMIT_*` env vars
  — no redeploy of code required.
