# CADS — Capacity-Aware Dispatch Signaling

CADS continuously computes this company's live dispatch load and broadcasts
machine-readable availability to motor-club partners (Agero, AAA, NSD, GEICO,
Urgently, or any generic consumer) with zero human intervention, so partner
systems — increasingly AI-driven — can assign jobs with confidence the
operator can perform inside the contractual window (default **60-minute**
max-response guideline).

```
load_ratio = weighted_active_jobs / eligible_signed_in_drivers
```

computed **per duty class** (`light` | `medium` | `heavy`) and **blended**
(`all`), recomputed on every relevant event (no polling): shift start/end,
driver break, driver–truck assignment change, truck in/out of service, job
created, any job status transition, override set/cleared/expired, and
settings changes.

- **Eligible driver** — on an open shift, not on break, assigned to an
  in-service truck. The driver's class is the truck's `duty_class`.
- **Weighted active job** — job statuses map to weights
  (default: `dispatched`, `enroute`, `on_scene`, `in_progress` → 1.0;
  everything else 0). Weights are tenant-configurable.
- **Zero eligible drivers in a class ⇒ that class is `offline`** — never a
  divide-by-zero, never `at_capacity`.

## Status bands

| Band | Default ratio range | Meaning |
|---|---|---|
| `available_now` | 0.00 – 0.75 | immediate response capacity |
| `limited` | 0.76 – 1.50 | slight delay likely |
| `constrained` | 1.51 – 2.00 | low confidence on the 60-min ETA |
| `at_capacity` | 2.01+ | cannot meet the guideline |
| `offline` | no eligible drivers | class is dark |

Thresholds are per-tenant (Settings → Capacity Signaling).

### Anti-flapping

Partners must be able to trust the signal, so band changes are damped:

- **Hysteresis buffer** (default `0.05`): the ratio must cross a band
  boundary by more than the buffer to flip immediately.
- **Dwell** (default `60 s`): an in-buffer crossing must persist for the
  dwell period before the published band moves.
- **Broadcast floor** (default `60 s`): at most one outbound webhook per
  partner per interval; a flap storm coalesces into one delivery carrying
  the latest state.
- `offline` transitions bypass hysteresis in both directions — driver
  headcount is a fact, not a noisy signal.

### Manual override

Dispatchers/admins can force a band globally or per class ("storm mode ⇒
at_capacity"). Overrides require a reason, auto-expire (default 4 h, max
24 h), and are fully audit-logged. The computed status keeps calculating
underneath and resumes on expiry/clear. Partners see only an
`override_active` boolean — never the reason.

## Delivery surfaces

### 1. Outbound webhooks (push)

On every effective band transition (post-hysteresis, override-aware), CADS
POSTs a signed JSON payload to each enabled webhook partner.

**Payload** (`schema_version` pinned at `1.0`; fields are only ever added —
renames/removals bump the version):

```json
{
  "schema_version": "1.0",
  "tenant_id": "0190…uuid",
  "tenant_name": "Acme Towing",
  "timestamp": "2026-07-14T18:04:11.201Z",
  "guideline_minutes": 60,
  "override_active": false,
  "classes": {
    "light":  { "status": "available_now", "ratio": 0.5, "drivers": 4, "active_jobs": 2 },
    "medium": { "status": "limited",       "ratio": 1.0, "drivers": 1, "active_jobs": 1 },
    "heavy":  { "status": "offline",       "ratio": null, "drivers": 0, "active_jobs": 0 }
  },
  "blended": { "status": "available_now", "ratio": 0.6, "drivers": 5, "active_jobs": 3 }
}
```

`classes` is filtered to the partner's class visibility (a light-only
partner receives only `light`); `blended` always ships. `ratio` is `null`
exactly when the class is `offline`.

**Headers**

| Header | Contents |
|---|---|
| `X-TowCommand-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |
| `X-TowCommand-Delivery-Id` | unique per delivery (replay nonce) |
| `X-TowCommand-Event` | `capacity.status_changed` |

**Signature verification (partner side).** The HMAC is computed over the
exact string `${t}.${rawBody}` with the shared `whsec_…` secret. Verify in
constant time and reject stale timestamps (±300 s recommended):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, rawBody, header, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2)));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const presented = Buffer.from(parts.v1 ?? '', 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return presented.length === wanted.length && timingSafeEqual(presented, wanted);
}
```

**Retries.** Non-2xx responses retry on a backoff ladder
(1 m → 5 m → 30 m → 2 h → 12 h, max 5 attempts), then the delivery is
dead-lettered. Every attempt is recorded in the broadcast log
(Settings → Capacity Signaling → broadcast log) — the receipts table for
"you said you were available" disputes.

Webhook URLs must be public `https` — private/internal ranges are rejected
at registration **and** re-checked (with DNS resolution) before every POST.

### 2. Pull API

Authenticated with a per-partner API key (`tc_live_…` / `tc_test_…`,
Bearer), rate-limited at 60 req/min per key:

- `GET /v1/capacity` — the live payload above, straight from cache.
- `GET /v1/capacity/history?hours=24&page=1&per_page=100` — snapshot
  time-series (bounded to 168 h, paginated), scoped to the partner's class
  visibility.

### 3. Adapter interface

`CapacitySignalAdapter` (apps/api/src/modules/capacity/adapters/) follows
the motor-club provider pattern. The generic signed-JSON webhook is the
live v1 implementation; `agero` / `nsd` / `urgently` stubs bound the future
work of speaking each network's native capacity format — no motor club
accepts capacity pushes today, so the generic webhook + pull API are the
live surfaces and the stubs are the readiness story.

## Settings reference (Settings → Capacity Signaling)

| Setting | Default | Notes |
|---|---|---|
| `availableMaxRatio` | 0.75 | upper bound of `available_now` |
| `limitedMaxRatio` | 1.50 | must be > available |
| `constrainedMaxRatio` | 2.00 | must be > limited; above ⇒ `at_capacity` |
| `jobWeights` | dispatched/enroute/on_scene/in_progress → 1.0 | statuses absent from the map count 0 |
| `hysteresisBuffer` | 0.05 | ratio units |
| `hysteresisDwellSeconds` | 60 | |
| `minBroadcastIntervalSeconds` | 60 | per-partner floor |
| `guidelineMinutes` | 60 | contractual max-response window |
| `overrideDefaultExpiryMinutes` | 240 | hard max 1440 (24 h) |
| `perYardEnabled` | off | v1 stub — data model is zone-aware (`yard_id` on snapshots) but v1 computes company-wide only; no zone UI |

Partner management (register, enable/disable, rotate webhook secret / API
key, test-fire) lives on the same page. **Credentials are shown exactly
once** at creation/rotation: the webhook secret is AES-256-GCM-encrypted at
rest (the worker must decrypt it to sign), the API key is stored only as
prefix + PBKDF2 hash.

## Operational notes

- Live state is cached in Redis (`capacity:status:<tenant>`); the dispatch
  widget updates over the tenant's Socket.IO room on
  `capacity.status_changed`.
- Snapshots persist on every band transition and at most every 5 minutes in
  steady state — that's the history the pull API serves.
- A once-a-minute cron expires lapsed overrides (recompute + partner
  notify) and sweeps due broadcast retries. Everything else is
  event-driven.
- Dev seed (`pnpm --filter @ustowdispatch/db seed`) creates default
  settings + a demo partner pointing at `http://localhost:4010/cads-echo`
  with fixed dev credentials (printed by the seed).
- Manual browser walkthrough: [cads-walkthrough.md](./cads-walkthrough.md).
