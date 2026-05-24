# US Tow DISPATCH — Public REST API & Webhooks (v1)

The Public API lets a tenant's own integrations read and write dispatch data
programmatically, and receive webhook callbacks when events happen. It is
**tenant-scoped by the API key** — a key only ever sees its own tenant's data,
enforced by Postgres Row-Level Security exactly as the web app is.

Base URL: `https://<your-api-host>` · All paths below are under `/v1`.

---

## Authentication

Send your API key as a Bearer token:

```
Authorization: Bearer tc_live_<prefix>_<secret>
```

- Keys are created in the web app under **Settings → API & Webhooks** (Owner/Admin).
- The full key is shown **once**, at creation. Store it securely — only the
  `prefix` is recoverable afterward.
- We store a SHA-256 fingerprint of the key, never the key itself.
- A revoked or expired key returns `401` (`api_key_invalid` / `api_key_expired`).

### Scopes

Every key carries an explicit set of scopes. A call to a route whose required
scope the key does not hold returns `403 insufficient_scope`.

| Scope          | Grants                                  |
| -------------- | --------------------------------------- |
| `jobs:read`    | `GET /v1/jobs`, `GET /v1/jobs/:id`      |
| `jobs:write`   | `POST /v1/jobs`, `PATCH /v1/jobs/:id/status` |
| `trucks:read`  | `GET /v1/trucks`, `GET /v1/trucks/:id`  |
| `drivers:read` | `GET /v1/drivers`, `GET /v1/drivers/:id`|
| `impound:read` | `GET /v1/impound`, `GET /v1/impound/:id`|

### Rate limits

Each key has a per-minute request budget (default **60 req/min**, configurable
per key at creation). Exceeding it returns `429 rate_limited` with a
`Retry-After` header (seconds).

### Versioning

The API is versioned in the path (`/v1`). Additive changes (new fields, new
endpoints) ship within `v1`; breaking changes will land under a new version
prefix. Treat unknown response fields as forward-compatible.

---

## Pagination

List endpoints are cursor-paginated (keyset on the record id, newest first):

```
GET /v1/jobs?limit=25&cursor=<opaque>
```

Response envelope:

```json
{
  "data": [ /* ... */ ],
  "nextCursor": "MDE4Zj...",   // pass back as ?cursor= for the next page; null when done
  "hasMore": true
}
```

`limit` defaults to 25, max 100. Cursors are opaque — don't parse them.

---

## Endpoints

| Method | Path                    | Scope          | Notes                                            |
| ------ | ----------------------- | -------------- | ------------------------------------------------ |
| GET    | `/v1/jobs`              | `jobs:read`    | Cursor list. Optional `?status=` filter.         |
| GET    | `/v1/jobs/:id`          | `jobs:read`    | Single job.                                      |
| POST   | `/v1/jobs`              | `jobs:write`   | Create from intake data (customer + vehicle + service + pickup). Honors `Idempotency-Key`. |
| PATCH  | `/v1/jobs/:id/status`   | `jobs:write`   | `{ "status": "...", "reason"?: "..." }`. Follows the job state machine; `dispatched` is not settable here (requires driver assignment). |
| GET    | `/v1/trucks`            | `trucks:read`  | Cursor list.                                     |
| GET    | `/v1/trucks/:id`        | `trucks:read`  | Single truck.                                    |
| GET    | `/v1/drivers`           | `drivers:read` | Cursor list.                                     |
| GET    | `/v1/drivers/:id`       | `drivers:read` | Single driver.                                   |
| GET    | `/v1/impound`           | `impound:read` | Cursor list of impound records.                  |
| GET    | `/v1/impound/:id`       | `impound:read` | Single impound record.                           |

### Idempotency

Send an `Idempotency-Key` header on `POST /v1/jobs` to make retries safe. A
repeat with the same key and the same request body replays the original
response; a repeat with the same key but a *different* body returns
`409 idempotency_key_reused`.

### Errors

All errors are RFC 9457 `application/problem+json`:

```json
{
  "type": "https://errors.ustowdispatch.com/insufficient_scope",
  "title": "API key is missing required scope(s): jobs:write",
  "status": 403,
  "code": "insufficient_scope",
  "requestId": "018f..."
}
```

Stable `code` values: `api_key_invalid`, `api_key_expired`, `insufficient_scope`,
`rate_limited`, `validation_failed`, `not_found`, `idempotency_key_reused`,
`invalid_state_transition`.

---

## Webhooks

Register HTTPS endpoints under **Settings → API & Webhooks**. When a subscribed
event fires, we POST a signed JSON payload. Each delivery has a unique id (the
idempotency key for the receiver).

### Event catalog (v1)

| Event              | Fires when                                              | `data` shape (summary)                             |
| ------------------ | ------------------------------------------------------- | -------------------------------------------------- |
| `job.created`      | A job is created (intake or direct).                    | `{ job: { id, jobNumber, status, ... } }`          |
| `job.status_changed` | A job transitions state (incl. assign/unassign).      | `{ jobId, jobNumber, fromStatus, toStatus, actorUserId }` |
| `impound.opened`   | A vehicle is taken into storage (impound intake).       | `{ impoundRecordId, yardId, status, vehicleVin, licensePlate, arrivedAt }` |
| `impound.released` | An impound record is released.                          | `{ impoundRecordId, releasedToName, releasedToType, totalFeesCents, releasedAt }` |

> `lien.advanced` is reserved for the Lien Processing module (a separate
> session) and is **not** emitted in this release.

### Envelope

```json
{
  "id": "018f3a1c-...",          // delivery id — dedupe on this
  "type": "job.created",
  "createdAt": "2026-05-24T12:00:00.000Z",
  "data": { /* per-event, see catalog */ }
}
```

Headers on every delivery:

- `X-TowCommand-Signature: t=<unix>,v1=<hmac-sha256-hex>`
- `X-TowCommand-Delivery-Id: <uuid>`
- `X-TowCommand-Event: <event type>`

### Verifying the signature

The signature is `HMAC-SHA256(secret, "<t>.<rawBody>")`, hex-encoded. Compare in
constant time and reject timestamps older than ~5 minutes to defeat replay.

**Node.js**

```js
const crypto = require('node:crypto');

function verify(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Express: use express.raw({ type: 'application/json' }) so rawBody is the exact bytes.
app.post('/hook', express.raw({ type: 'application/json' }), (req, res) => {
  const ok = verify(req.body.toString('utf8'), req.get('X-TowCommand-Signature'), process.env.WEBHOOK_SECRET);
  if (!ok) return res.sendStatus(400);
  res.sendStatus(200);
});
```

**Python**

```python
import hashlib, hmac, time

def verify(raw_body: bytes, header: str, secret: str, tolerance_sec: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts.get("t", "0"))
    if abs(time.time() - t) > tolerance_sec:
        return False
    expected = hmac.new(
        secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))

# Flask: read request.get_data() (raw bytes) BEFORE accessing request.json.
```

### Delivery & retries

- Respond `2xx` within 10s to acknowledge. Anything else (or a timeout/connection
  error) is a failure and is retried.
- Backoff ladder: **1m → 5m → 30m → 2h → 12h**, up to **5 attempts**, then the
  delivery is marked `failed`.
- Deliveries are at-least-once. Dedupe on `id` / `X-TowCommand-Delivery-Id`.
- Operators can replay any delivery and send a test event from the dashboard.
- The delivery worker is environment-gated (`WEBHOOK_DELIVERY_ENABLED`); a
  staging deploy with it off will queue deliveries without sending.
