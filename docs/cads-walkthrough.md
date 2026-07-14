# CADS manual walkthrough

A human-driveable version of `apps/e2e/tests/e2e-013-capacity-signaling.spec.ts`.
Takes ~10 minutes with the local stack.

## 0. Stack up

```bash
docker compose up -d postgres redis
pnpm --filter @ustowdispatch/db migrate
pnpm --filter @ustowdispatch/db seed        # prints the CADS demo credentials
pnpm --filter @ustowdispatch/api dev        # terminal 2
pnpm --filter @ustowdispatch/web dev        # terminal 3
npx http-echo-server 4010                   # terminal 4 — the demo partner's webhook sink (optional)
```

Log in at http://localhost:3000 as `owner@acme.test` / `ChangeMe123!`.

## 1. Widget renders live state

1. Open **Live Dispatch** (`/dispatch`).
2. Find the **Capacity Signal** panel. Expect four gauges: **Blended**
   first, then **Light / Medium / Heavy**.
3. The seed put four drivers on shift (light/medium/heavy trucks), so each
   class shows a driver count and a green **Available now** pill at ratio
   0.00. If you cleared the shifts, classes show a gray **Offline** pill —
   that's the zero-driver rule.
4. Note the **Last broadcast** stamp in the header ("never" on a fresh DB).

## 2. Live updates (event-driven, no refresh)

1. Keep `/dispatch` open. In a second tab, create a job via **Intake** and
   dispatch it to a light-duty driver.
2. Watch the Light gauge move (ratio climbs, e.g. 0.50) **without
   reloading** — that's the `capacity.status_changed` socket event.

## 3. Manual override (storm mode)

1. In the widget header click **Set override**.
2. Duty class **All**, forced status **At capacity**, reason
   `Storm — every truck committed`, duration **1 hour** → **Force status**.
3. Expect: a yellow override banner (reason + countdown), the Blended pill
   flips to red **At capacity** with an `(override)` marker, and the class
   gauges show their forced band while the tooltip reveals the computed
   band still running underneath.
4. Click **Clear** on the banner. The computed signal resumes immediately.
5. Audit check: `/settings/capacity` → the override appears in the
   overrides section history (who, reason, expiry).

## 4. Settings save

1. Open **Settings → Capacity Signaling** (`/settings/capacity`).
2. Change **Guideline minutes** 60 → 45, click **Save thresholds**, reload:
   the value sticks.
3. Try setting Limited max below Available max — the form refuses
   (thresholds must stay ordered).

## 5. Partner + signed webhook

1. Same page → **Add partner**: name `Local echo`, network `generic`,
   delivery `webhook`, URL `http://localhost:4010/echo`, all classes.
2. A modal shows the **webhook secret** and **API key** once — copy both.
3. Click **Test fire** on the partner row. Expect a success toast with
   HTTP 200 + latency, the echo terminal prints the signed payload
   (`X-TowCommand-Signature` header), and the delivery appears in the
   **broadcast log** with status `delivered`.
4. Try registering a partner with URL `https://169.254.169.254/x` — it is
   rejected (private ranges are blocked).

## 6. Pull API

With the API key from step 5:

```bash
curl -s http://localhost:3001/v1/capacity \
  -H "authorization: Bearer tc_test_…" | jq
curl -s "http://localhost:3001/v1/capacity/history?hours=24" \
  -H "authorization: Bearer tc_test_…" | jq '.total'
```

Expect the same payload shape the webhook delivers, scoped to the partner's
class visibility; a wrong key gets 401; the 61st request inside a minute
gets 429 with a `Retry-After` header.
