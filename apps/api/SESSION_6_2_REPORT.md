# Session 6.2 — Backend gaps for the iOS driver app

Two gaps surfaced by Session 6.1 (native iOS driver app) — `/fleet/*` role
gates that locked drivers out, and a missing chat module — are now closed.
iOS contract (`apps/driver-ios/Packages/Core/Sources/Core/Networking/`) is
the source of truth; nothing in the iOS tree was touched. As soon as these
land, the iOS outbox starts flushing the queued DVIRs, document uploads,
shift mutations, and chat messages with zero client changes.

---

## What shipped

### Gap 1 — `/fleet/*` role gates

`@Roles(...)` decorators on the seven driver-facing routes now include
`ROLES.DRIVER`. The role widening alone would have leaked peers' data, so
each backing service got a service-layer driver-scoping check. The scope
helper lives in a shared module so any future internal caller (background
job, gateway, cron) inherits the rule.

- [x] `POST /fleet/dvirs` — driver can only submit DVIRs for themselves
- [x] `GET /fleet/dvirs` — driver sees only their own
- [x] `POST /fleet/documents` — driver can only upload onto their driver
  record, their assigned trucks, or a job assigned to them
- [x] `GET /fleet/documents` — driver sees only own driver-docs + their
  current truck's docs
- [x] `GET /fleet/documents/:id/download` — same access rule as `list`
  (404 instead of 403 when out of scope, to avoid leaking existence)
- [x] `GET /fleet/expirations` — driver sees only their own driver-row
  expirations + their assigned trucks + docs for either
- [x] `GET /fleet/drivers/:id/trucks` — driver can only enumerate their own
  truck assignments (this is the path iOS calls; the controller already
  exposed it as `/fleet/drivers/:id/trucks` — verified against
  `Endpoints.swift::driverTrucks`)

### Gap 1.5 — `/dispatch/shifts/*` time-clock for drivers

iOS Session 6.1 fires `POST /dispatch/shifts/start` and
`POST /dispatch/shifts/end` from the driver app's time-clock screen, but
the routes were gated to dispatcher-and-up. Opened both to `ROLES.DRIVER`
and added self-only scoping in `DriversService` (`startShift`, `endShift`,
`updateShiftStatus`, `updateShiftLocation`) so drivers can only operate
their own shift. The status/location routes were already DRIVER-permitted
but unscoped; this closes that hole at the same time.

### Gap 2 — Chat module

- [x] `apps/api/src/modules/chat/` with `ChatModule`, `ChatService`,
  `ChatController`, and `chat.testables.ts` (pure helpers extracted so unit
  tests can exercise the wire-format mappers without booting Postgres)
- [x] `chat_threads` / `chat_messages` tables, FORCE RLS, audit triggers,
  partial unique index for idempotency
- [x] Four endpoints under `/dispatch/chat` (paths match iOS exactly)
- [x] Service-layer participant scoping (DRIVER must be assigned to the
  job; dispatcher/admin/manager/owner have tenant-wide chat access)
- [x] Cursor-based pagination (newest first, `created_at + id` tiebreaker)
- [x] Idempotency on POST via `client_message_id` (partial unique index +
  in-service read-back for the retry case)
- [x] Push notification fan-out on every new message via the existing
  `NotificationService`. Driver→dispatcher routes to a tenant/role pseudo-
  address (sink-only on stub); dispatcher→driver routes to the assigned
  driver's phone. Failures are logged, not bubbled — chat send never blocks
  on notification provider hiccups.

---

## Migrations created

| Path | Purpose |
| --- | --- |
| `packages/db/drizzle/0011_chat.sql` | Create `chat_threads` and `chat_messages` with FKs and the supporting btree index. |
| `packages/db/drizzle/meta/_journal.json` | Registered the `0011_chat` entry so `pnpm migrate` applies it on next run. |
| `packages/db/sql/0016_chat.sql` | FORCE RLS policies, `author_role` / `attachment_type` CHECK constraints, `body OR attachment` CHECK, audit triggers, and the partial unique index on `(tenant_id, thread_id, client_message_id) WHERE client_message_id IS NOT NULL` that backs idempotency. |
| `packages/db/src/schema/chat.ts` | Drizzle schema for the two tables (referenced by service layer). |

The drizzle migration runner reads from `packages/db/drizzle/` and the raw
SQL pass from `packages/db/sql/` (see `packages/db/src/migrate.ts`). The
journal entry's `idx`/`when` are increasing, so `pnpm --filter @towdispatch/db
migrate` applies cleanly against a database at the prior head.

> Note on path: the brief mentioned `apps/api/db/migrations/`. The repo
> actually houses migrations in `packages/db/{drizzle,sql}/`. I followed the
> existing layout rather than inventing a parallel one.

---

## Endpoints added

All under `@Controller('dispatch/chat')`, gated by `@UseGuards(RolesGuard)`.

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| POST | `/dispatch/chat/threads/:jobId/messages` | DRIVER, DISPATCHER, ADMIN, MANAGER, OWNER | Creates the thread on first message. Idempotent per `client_message_id`. |
| GET  | `/dispatch/chat/threads/:jobId/messages` | DRIVER, DISPATCHER, ADMIN, MANAGER, OWNER | Cursor-paginated, newest first. Returns `{ messages, nextCursor }`. |
| PATCH | `/dispatch/chat/messages/:messageId/read` | DRIVER, DISPATCHER, ADMIN, MANAGER, OWNER | Sender's own message is a no-op (cannot mark your own as read). Idempotent on re-mark. |
| POST | `/dispatch/chat/messages/:messageId/attachment-url` | DRIVER, DISPATCHER, ADMIN, MANAGER, OWNER | Returns `{ uploadUrl, attachmentUrl, expiresAt }`. Local-disk dev returns synthetic URLs (real S3 presigning lands when the StorageProvider grows a `presignPut` method). |

OWNER added everywhere for symmetry — the role gate explicitly enumerates
every privileged role (see `roles.decorator.ts` for the codebase convention
that "at least manager" is encoded as `ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER`).

---

## Test coverage

| Metric | Before | After |
| --- | --- | --- |
| Unit tests | 88 | 101 (+13 chat helpers) |
| Total tests collected | 250 | 275 (+25; 12 chat integration tests skip without Postgres) |
| New test files | — | `src/modules/chat/chat-units.spec.ts`, `test/integration/chat.spec.ts` |

Existing tests: **no regressions** — `pnpm --filter @towdispatch/api test`
remains 100% green on the unit suite. Integration tests are skipped on this
host (no `DATABASE_ADMIN_URL`/`REDIS_URL`); they auto-run on the docker-
compose stack via `skipIfNoDb`.

Chat integration coverage (`test/integration/chat.spec.ts`):

1. Driver posts first message → thread auto-created, returns iOS wire shape.
2. Idempotency: re-POST with same `clientMessageId` returns the original row
   even when the body differs.
3. Dispatcher reads the same thread, messages newest-first.
4. Cursor pagination: no overlap between pages.
5. Cross-tenant RLS: attacker-tenant driver hits 404 (the job is invisible
   under their tenant context).
6. Read receipts: sender can't mark own; dispatcher mark transitions
   `deliveryState` from `sent` → `read`.
7. Attachment-URL mint succeeds for a participant.
8. `/fleet/dvirs` returns only the caller's DVIRs.
9. `/fleet/drivers/{self}/trucks` returns 2xx.
10. `/fleet/drivers/{other}/trucks` returns 403 for a driver.
11. `/fleet/expirations` returns the expected shape for a driver.

---

## Inconsistencies discovered

These predate Session 6.2 and were left alone — flagging here for triage:

- **`apps/api` typecheck and build fail with 4 pre-existing errors** in
  `src/modules/billing/billing.controller.ts:119` and
  `src/modules/payments/stripe.provider.ts:{108,181,197}`. They are all
  `exactOptionalPropertyTypes` mismatches around the Stripe SDK and the
  invoice update payload. Verified pre-existing by `git stash -u` and
  re-running `tsc --noEmit` on the stashed tree: same 4 errors. My session
  added zero new typecheck errors. These belong to Sessions 10–11 (billing
  / Stripe payments) and should be picked up there.

- **Notifications module path drift** — the brief referenced
  `apps/api/src/modules/notifications/`. The actual location is
  `apps/api/src/integrations/notification/`. I integrated with the real
  path. There is no separate "Session 15 notifications module"; today the
  notification surface is `NotificationService.sendSms()` over a registry
  that also supports the `push` channel. When push channels grow real
  drivers (APNs/FCM), `ChatService.enqueueNotification()` is the single
  call-site to upgrade — the rest of the service is push-agnostic.

- **`Endpoints.swift::driverTrucks`** points at `/fleet/drivers/:id/trucks`
  rather than the brief's nominal `/fleet/driver-truck-assignments`.
  Followed the iOS contract — that's the source of truth — and opened that
  route to DRIVER with self-only scoping.

- **`startShift` / `endShift`** at `/dispatch/shifts/start|end` were
  formerly gated to `OWNER/ADMIN/MANAGER/DISPATCHER` (no DRIVER). iOS
  Session 6.1's time-clock screen calls these routes, so they were
  effectively dead from the driver app. Opened both to `ROLES.DRIVER` in
  this session, with service-layer self-only scoping in `DriversService`:
  drivers may only start, end, status, or relocate **their own** shift,
  resolved via `drivers.user_id = ctx.userId`. Dispatchers retain
  tenant-wide control. Now consistent with `shifts/:id/status` and
  `shifts/:id/location` which were already DRIVER-accessible but
  unscoped — both now enforce self-only too.

---

## Breaking changes

Zero. Every change is additive:
- The role gate widens (admit DRIVER), doesn't tighten.
- Service-layer scoping only fires when `role === DRIVER`; existing
  callers (web admin, dispatch UI) keep tenant-wide visibility.
- The chat module is a new module / new routes / new tables.
- `CallerContext.role` was added as a new optional field on
  `FleetController.callerCtx` and `DispatchController.callerCtx`; existing
  callers compile without changes due to structural typing.

---

## Deployment notes

- **Env vars added**: none.
- **Migrations to run on next deploy**:
  1. `pnpm --filter @towdispatch/db migrate` — applies
     `packages/db/drizzle/0011_chat.sql` (tables + FKs + indexes) and
     `packages/db/sql/0016_chat.sql` (RLS, CHECK constraints, audit
     trigger, partial unique index). Both files are idempotent
     (`IF NOT EXISTS`, `DROP ... IF EXISTS`).
- **Storage**: chat attachment URLs are minted by `ChatService.mintAttachmentUrl`.
  In local-disk dev they return synthetic URLs; production S3 wiring is the
  next StorageProvider implementation and replaces only that method.

---

## Anything iOS should be aware of

Nothing. The contract was iOS — the backend mirrored its request and
response shapes. Verified:

- Response field names match `Core/Models/ChatMessage.swift` exactly:
  `id, jobId, sender, kind, body, attachmentUrl, durationSeconds,
  createdAt, deliveryState`.
- `sender` is collapsed to `driver | dispatcher | system` (admin/manager
  fold to `dispatcher`) so the iOS Codable enum decodes without changes.
- `kind` maps from `attachment_type` (none→text, voice_memo→voice,
  photo→photo, video→video). iOS-only `quick_reply` is accepted on input
  and stored as text.
- `clientMessageId` mirrors `SendChatMessageRequest.clientMessageId` and
  is the idempotency key.

The iOS outbox should now flush queued chat sends, queued DVIRs, queued
document uploads, and queued driver-truck reads. Time-clock shift mutations
remain gated to dispatcher+ on `/dispatch/shifts/*` — flagged above under
inconsistencies.
