# Notifications system (Session 15)

## Purpose

A single backbone for every outbound message TowCommand sends. Every part of
the platform funnels through one API; the service routes, queues, retries,
and tracks delivery. Per-user preferences and quiet hours apply
automatically. The web UI surfaces a unified history; admins inspect the
dead-letter queue and edit templates from one screen.

## Architecture

```
caller (dispatch, billing, compliance, scheduler, etc.)
   │
   ▼
POST /internal/notifications/dispatch  ──►  NotificationsService.dispatch
                                              │
                                              ├── idempotency lookup (24h window)
                                              ├── recipient resolve (userId | role-scope)
                                              ├── preference + quiet-hours resolve
                                              ├── template render (tenant override > system default)
                                              ├── persist notifications + notification_deliveries
                                              └── enqueue per channel (BullMQ)
                                                     │
                                                     ▼
                                     channel adapter (push / sms / email / in_app / webhook)
                                                     │
                                                     ▼
                                       recordChannelResult → DLQ on permanent failure
                                                     │
                                                     ▼
                              provider webhook (Twilio / SendGrid / Mailgun)
                                                     │
                                                     ▼
                                       DeliveryTrackingService.apply
```

### Tables

| Table                          | Purpose                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| `notifications`                | One row per dispatch. Idempotency window applied.                |
| `notification_deliveries`      | One row per (notification, channel). Status + retry counters.    |
| `notification_preferences`     | User + tenant-default rows, one per (category, channel).         |
| `notification_quiet_hours`     | One row per user. IANA timezone, override list.                  |
| `notification_templates`       | System defaults (tenant_id IS NULL) + per-tenant overrides.      |
| `webhook_subscriptions`        | Outbound webhook endpoints. AES-GCM-encrypted secret at rest.    |
| `webhook_deliveries`           | Per-attempt log for the admin /admin/notifications inspector.    |
| `notification_dead_letters`    | Terminal failures, retained 30 days.                             |
| `notification_device_tokens`   | FCM/APNs tokens per (tenant, user, device).                      |

Every tenant-scoped table is FORCE-RLS with the standard tenant_isolation
policy from Session 2. Cross-tenant reads are impossible from the
`app_user` role.

### Event catalog

`@towcommand/shared` exports `NOTIFICATION_EVENTS` — the stable enum every
caller picks from. Adding a new event:

1. Append to `NOTIFICATION_EVENTS` in `packages/shared/src/schemas/notifications.ts`
2. Register a category in `EVENT_CATEGORY_BY_EVENT`
3. Add per-channel templates in `apps/api/src/modules/notifications/templates/system-templates.ts`
4. Document in this file's "Event catalog" appendix

### Channels and retry policy

| Channel | Provider                  | Attempts | Backoff               | Notes                                              |
| ------- | ------------------------- | -------- | --------------------- | -------------------------------------------------- |
| push    | FCM (HTTP v1 API)         | 3        | exponential, 5s base  | Driver-app moat — see notifications-driver-app-moat.md |
| sms     | Twilio                    | 2        | fixed 60s             | Twilio retries internally — we only retry on failed.|
| email   | SendGrid / Mailgun / SMTP | 3        | exponential, 30s base | Mailgun used for marketing; SendGrid for transactional. |
| webhook | Outbound HMAC             | 5        | exponential, 60s base | Up to ~6h with the configured base — see queue config. |
| in_app  | DB-only                   | 1        | n/a                   | Delivered the moment the row is written.            |

Workers live in `notifications-workers.service.ts`. Concurrency is per
channel, controlled by `NOTIFY_*_CONCURRENCY` env vars (defaults: push 16,
sms 8, email 8, webhook 8, in_app 16). Scale via API replicas rather than
raising these numbers blindly — provider caps remain the binding constraint.

### Preferences and quiet hours

Resolution order per (event, channel):

1. `priority='emergency'` OR event in `DEFAULT_QUIET_HOURS_OVERRIDES` → always fires
2. User preference row for (category, channel)
3. Tenant default row (user_id IS NULL) for (category, channel)
4. Built-in shipping default from `PreferencesResolverService.DEFAULT_PREFERENCES`

Quiet hours: `notification_quiet_hours.{enabled, startLocal, endLocal, timezone}`.
Inside the window, non-override events are scheduled (via the BullMQ
`delay` option) to fire at `endLocal`. Emergency dispatch always bypasses.

`DEFAULT_QUIET_HOURS_OVERRIDES` is conservative — motor-club jobs, dispatch
assignments, GOA flags, security events, DVIR defects. Users can add events
to the list but cannot remove these from it.

### Idempotency

Every dispatch carries an optional `idempotencyKey` (8–128 chars). Within a
24-hour window, a duplicate call with the same key short-circuits to the
original notification (`deduplicated: true` in the response). The DB
constraint is a partial unique index:

```sql
CREATE UNIQUE INDEX notifications_tenant_idempotency_active_unique
  ON notifications (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND idempotency_expires_at IS NOT NULL
    AND idempotency_expires_at > now();
```

Race-safe: the service catches the 23505 unique-violation and re-reads.

### Templates

Handlebars. System defaults seed at boot (`TemplateLoaderService.onModuleInit`).
Tenant overrides land via the admin UI; the resolver picks tenant > system
per (template_key, channel) so a tenant can override only one channel for a
given event and inherit the rest.

Cached in-memory keyed by `(scope, key, channel)`. The admin upsert path
invalidates the cache on save.

Built-in helpers: `{{formatDate iso}}`, `{{formatTime iso}}`, `{{json this}}`.

### Webhook outbound signing

Header: `X-TowCommand-Signature: sha256=<hex>`. The body signed is
`${timestamp}.${rawBody}` — receivers MUST verify with the shared secret
and reject anything older than 5 minutes to defeat replay. Other headers:

* `X-TowCommand-Event` — event type
* `X-TowCommand-Delivery-Id` — our delivery uuid
* `X-TowCommand-Timestamp` — unix seconds

Secrets are AES-256-GCM at rest using `WEBHOOK_SECRET_ENCRYPTION_KEY`. The
plaintext is returned ONLY on create + rotate; the list view returns null.

### Dead-letter queue

Terminal failures (max attempts exceeded or `permanent=true` from the
adapter) land in `notification_dead_letters` with a frozen payload
snapshot. The /admin/notifications "Dead letters" tab lists them; the
Retry button re-dispatches under a fresh idempotency key
(`dlq-retry:<id>:<uuid>`).

Retention: 30 days (`NOTIFY_DEAD_LETTER_RETENTION_DAYS`). Hourly sweep in
`DeadLettersService.onModuleInit`. Parent notification rows are never
deleted; the audit trail outvalues the disk savings.

### Provider webhooks

* Twilio: HMAC-SHA1 of `${url}${sortedFormParams}` keyed on the auth token
* SendGrid: signature header (v1 ships permissive; raw-body capture is a follow-up)
* Mailgun: HMAC-SHA-256 of `${timestamp}${token}` keyed on the API key

Mapping (`provider-webhooks.controller.ts`):

| Status            | Internal             |
| ----------------- | -------------------- |
| Twilio delivered  | `delivered`          |
| Twilio failed     | `failed`             |
| SendGrid bounce   | `bounced`            |
| Mailgun delivered | `delivered`          |

FCM token-killed responses soft-disable the device token row so the next
dispatch doesn't burn quota on a known-dead handset.

### Rate limits

Per-tenant ceilings keep a runaway loop from torching a Twilio account:

* SMS: 1000/hr (configurable up to the provider cap)
* Email: 5000/hr
* Push: 10000/hr

Above the limit, the queue applies backpressure and an ops alert fires.
The day-one v1 enforces only via BullMQ concurrency — proper token-bucket
ceilings are a Phase-2 follow-up flagged in the report.

### Decisions made during build

* **BullMQ instead of a hand-rolled scheduler.** Standard pattern, retry
  + delay primitives match the policy verbatim.
* **One row per (recipient, channel) push delivery.** A driver with two
  registered devices receives two delivery rows so each receipt callback
  has a stable correlation handle.
* **Webhook secret stored encrypted with the same GCM pattern as
  QuickBooks tokens.** Separate key
  (`WEBHOOK_SECRET_ENCRYPTION_KEY`) so we can rotate independently.
* **Admin UI combined into one /admin/notifications page.** Three sub-pages
  (templates, webhooks, metrics) added clicks without payoff. One page with
  tabs is faster to triage.
* **Recharts charts deferred.** Session 14 owns the Recharts setup; this
  session ships table-only metrics. Bound to lift in a follow-up after the
  Session 14 merge.

## Appendix: Event catalog

See `packages/shared/src/schemas/notifications.ts` for the authoritative
list and `templates/system-templates.ts` for the per-channel templates.

| Event                                       | Category   | Channels (default)          |
| ------------------------------------------- | ---------- | ---------------------------- |
| `dispatch.job_assigned`                     | dispatch   | push, in_app                |
| `dispatch.job_accepted`                     | dispatch   | in_app                      |
| `dispatch.job_declined`                     | dispatch   | in_app, email               |
| `dispatch.job_status_changed`               | dispatch   | in_app                      |
| `dispatch.job_goa_flagged`                  | dispatch   | push, in_app, email         |
| `dispatch.job_cancelled_by_customer`        | dispatch   | push, in_app                |
| `motor_club.job_received`                   | motor_club | push, email, in_app         |
| `motor_club.eta_pushed`                     | motor_club | in_app                      |
| `motor_club.sync_failure`                   | motor_club | email, in_app               |
| `customer.tow_dispatched`                   | customer   | sms, email                  |
| `customer.driver_en_route`                  | customer   | sms                         |
| `customer.driver_arrived`                   | customer   | sms                         |
| `customer.payment_receipt`                  | customer   | email                       |
| `billing.invoice_created`                   | billing    | email, in_app               |
| `billing.invoice_paid`                      | billing    | email, in_app               |
| `billing.payment_failed`                    | billing    | email, in_app               |
| `billing.card_on_file_expiring`             | billing    | email, in_app               |
| `compliance.driver_license_expiring`        | compliance | push, email, in_app         |
| `compliance.medical_card_expiring`          | compliance | push, email, in_app         |
| `compliance.coi_expiring`                   | compliance | email, in_app               |
| `compliance.motor_club_credential_expiring` | compliance | email, in_app               |
| `compliance.dvir_defect_flagged`            | compliance | push, in_app, email         |
| `system.scheduled_report_delivery`          | system     | email, in_app               |
| `system.integration_auth_failure`           | system     | email, in_app               |
| `system.security_event`                     | security   | push, email, in_app         |
| `operational.lien_deadline_approaching`     | operational| in_app                      |
| `operational.hold_vehicle_release_approved` | operational| in_app                      |
| `operational.auction_lot_expiring`          | operational| in_app                      |
