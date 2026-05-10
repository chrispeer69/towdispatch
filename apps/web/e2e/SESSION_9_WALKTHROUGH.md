# Session 9 — Customer Tracking SMS + Public Tracking Page

A click-by-click walkthrough for COO review. Run the full stack first
(`pnpm dev` from repo root, with the docker compose for Postgres + Redis
already up).

## Prerequisites

- Local stack running: `docker compose up -d` then `pnpm dev`
- Migrations applied (`pnpm db:migrate`) — tracking_links / tracking_messages /
  job_ratings should exist (`\d tracking_links` in `psql`)
- Seeded acme tenant: `pnpm db:seed` (creates `owner@acme.test` /
  `ChangeMe123!`, plus a driver + truck + active shift)

## 1. Generate the tracking SMS at intake

1. Browse to <http://localhost:3000/login> and sign in as
   `owner@acme.test` / `ChangeMe123!`.
2. Open `/intake`. Fill out a complete tow job:
   - Phone: any 10-digit number (`+15558881234` is fine — the stub provider
     will log the would-be SMS to console).
   - Email: anything `@example.com`.
   - VIN, plate, vehicle, pickup, dropoff: realistic but unique values.
3. **Leave the new "Skip customer SMS" checkbox unchecked**.
4. Click **DISPATCH**. You should land on `/dispatch?created=YYYYMMDD-NNNN`
   and see the success toast appended with:
   > Customer tracking SMS will fire automatically on assign.

## 2. Assign the job and observe the badge state

1. Drag the new job from the **Queue** column onto the seeded driver card.
2. The job moves to the **Dispatched** group of the active section.
3. A small "Sent ✓" pill appears beneath the job card (the `TrackingBadge`).
   - In dev with the stub provider, the status flips to **Delivered ✓**
     immediately. Twilio in prod will sit at "Sent" until the carrier
     webhook fires.
4. Tail the API process and verify a line like:
   > `[stub-notification] channel=sms to=*****1234 ref=<uuid> body=Your tow truck …/track/<token>`

## 3. Open the customer tracking page

1. Copy the link from the API stub log (or click the badge → URL field).
2. Open it in an **incognito window** (or `Ctrl-Shift-N`) so you can confirm
   no auth is required.
3. Verify:
   - Tenant name and brand chrome render (logo placeholder if none).
   - Status label is **"Driver assigned"** (not the raw enum `dispatched`).
   - Driver name shows first name + truck unit number — but **not** the
     driver's phone number.
   - Status timeline shows the five steps with the first dot lit.
   - Mapbox preview renders if `NEXT_PUBLIC_MAPBOX_TOKEN` is real; otherwise
     a "Driver location will appear here…" placeholder.

## 4. Two-way messaging

1. On the customer page, type "Test from customer" in the chat input and hit
   **Send**.
2. Switch to the dispatcher window. Click the tracking badge on the job
   card. The thread modal opens with the inbound message visible.
3. Type a dispatcher reply and **Send**. Switch back to the customer page —
   the dispatcher reply lands within ~1 second over the live `/track`
   socket.

## 5. Status transitions land live

1. From the dispatcher view, click the job to mark it **enroute**, then
   **on_scene**, then **in_progress**, then **completed** in turn (or use
   the existing dispatch board controls).
2. Each transition flips the customer page header text:
   - On the way → On scene → Loaded, in transit → Delivered.
3. The status timeline pip lights up to the corresponding step.

## 6. Rating after completion

1. After the job hits `completed`, the customer page shows the **"How was
   your service?"** panel.
2. Tap a star (or click on desktop). Optional comment.
3. Click **Submit**. Verify the panel swaps to the "Thanks!" copy.
4. Re-submitting overwrites the prior rating (intentional — a typo can be
   corrected).

## 7. Mobile testing

### Chrome DevTools mobile emulation

- Open DevTools (`F12`), toggle device toolbar (`Ctrl-Shift-M`).
- Select an iPhone 14 / Pixel 7 preset.
- Reload `/track/<token>`.
- Verify the chat input remains tappable, the map preview fills the width,
  and the rating panel is reachable below the fold.

### Real iPhone (if available)

- On the same Wi-Fi network as the dev box, browse to
  `http://<host-ip>:3000/track/<token>`.
- Confirm iOS Safari renders without horizontal scroll, status pills are
  legible, and the "Call dispatcher" link opens the dialer when tapped.

## 8. Spanish toggle

1. Append `?lang=es` to the URL or use the **Español** link in the header.
2. Status labels switch to Spanish (`Conductor asignado`, `En camino`,
   `Entregado`).

## 9. Privacy + revoke + expiry

1. From the dispatcher modal, click **Revoke link**. Confirm the prompt.
2. Reload the customer page. It should now show the "This tracking link has
   been expired" page (HTTP 410 under the hood).
3. To verify auto-expiry without waiting 24 hours, run in `psql`:
   ```sql
   UPDATE tracking_links SET expires_at = now() - interval '1 hour'
   WHERE token = '<token>';
   ```
   Reload the customer page → expired copy.

## 10. Cross-tenant isolation spot check

1. Sign up a second tenant from `/signup`.
2. As that second tenant, hit `GET /tracking/<jobId-from-tenant-A>` (use
   curl or the network tab). Expect either `200 {link: null}` or `404`.
   The link must not leak.

## 11. SMS analytics tile

1. Navigate to `/reporting`.
2. The "Customer tracking" tile should show non-zero counts after the runs
   above (sent / delivered / viewed / ratings).

---

## Failure modes to watch

- **No badge appears on the dispatched job card.** The auto-create
  subscriber is in `TrackingService.onModuleInit`; check the API log for
  `auto-create tracking link failed` warnings.
- **SMS "failed" status with `no_customer_phone`.** The intake customer
  needs a phone number; verify it isn't being scrubbed by the cleaning
  regex in `lookupCustomerPhone` (only digits + leading + survive).
- **WebSocket disconnect loop on the customer page.** Make sure
  `NEXT_PUBLIC_API_URL` matches the host the browser can reach (not
  `localhost` if you're testing from a phone).
