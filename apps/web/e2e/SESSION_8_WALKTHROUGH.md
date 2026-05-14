# Session 8 — Fleet & Driver Management Walkthrough

Click-by-click verification for COO review. Run against a fresh dev DB
(`pnpm --filter @ustowdispatch/db reset && pnpm --filter @ustowdispatch/db migrate && pnpm --filter @ustowdispatch/db seed`)
and a logged-in `owner@acme.test` session.

---

## 1. Sidebar — new Fleet entry

1. Open the app shell. The left sidebar should now show **Fleet** between
   **Live Dispatch** and **Drivers** under Operations.
2. Click **Fleet**. You land on `/fleet/trucks` (the index redirects).
3. Verify the sub-nav reads: `Trucks` · `Drivers` · `Expirations` ·
   `Maintenance` · `DVIR`. Active tab has the orange pill background.

## 2. Trucks — list, create, profile

1. From `/fleet/trucks`, type a query into the search box. The list
   debounces and refetches.
2. Click **+ New truck** in the upper right.
3. Fill: unit number `T-COO-1`, year `2022`, make `Peterbilt`, model `389`,
   VIN any 17-char `[A-HJ-NPR-Z0-9]`, capacity class `heavy`, GVWR
   `52000`, fuel type `diesel`. Tick `flatbed` and `winch` under Equipment.
   Set registration expiry 20 days out, insurance expiry 5 days out.
4. Click **Create truck**. You land on the truck profile page.
5. Sections rendered:
   - Assigned drivers (empty, "No drivers assigned.")
   - Documents (empty)
   - Maintenance schedules / history (empty)
   - Recent DVIRs (empty)
   - Edit form with all fields pre-populated.

## 3. Documents — upload + tenant-scoped storage

1. On the truck profile, in the **Documents** card, choose `registration`.
2. Pick an expiry date inside 30 days (e.g. 20 days out).
3. Pick a small PDF/text file from disk.
4. Click **Upload document**. The file appears in the documents list with
   `exp <date>`.
5. Open `apps/api/storage/tenants/<your-tenant-id>/truck/<truck-id>/...`.
   The bytes are physically there. **Important**: no other tenant directory
   should be writable from this path.

## 4. Drivers — create + assign

1. Click **Drivers** in the sub-nav, then **+ New driver**.
2. Fill: first `Mike`, last `Smith`, email, phone, CDL `A`, CDL expires 60
   days out, license state `OH`, medical card 3 days out.
3. Tick `WreckMaster_4_5` and `TIM` under Certifications.
4. Click **Create driver**. You land on the driver profile.
5. In **Assigned trucks**, pick `T-COO-1` and click **Assign truck**. The
   list updates to show `T-COO-1`.
6. Visit `/fleet/trucks/<id>` → the **Assigned drivers** section now lists
   the new driver id.

## 5. DVIR — submit out_of_service → truck flips to in_maintenance

1. Open `/fleet/dvirs`.
2. Pick the new driver and truck. Type `pre_trip`. Optionally enter an
   odometer reading.
3. Click **+ Add defect**. Component `Brakes`, severity `out_of_service`.
4. Click **Submit DVIR**. A success message confirms `out_of_service`.
5. Go back to the truck profile (`/fleet/trucks/<id>`). The status badge in
   the form now reads `in_maintenance`. The notes field shows an `[auto]`
   line referencing the DVIR id.

## 6. Maintenance — schedule + record

1. Use the API directly (curl / Insomnia / Postman) for the maintenance
   surface. Web UI for create/record lands in a follow-up:
   ```bash
   curl -X POST $API/fleet/maintenance/schedules \
     -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"truckId":"<id>","scheduleType":"mileage","serviceType":"oil","intervalMiles":5000,"lastServicedMiles":50000}'
   ```
   Response includes `nextDueMiles: 55000`.
2. Record service:
   ```bash
   curl -X POST $API/fleet/maintenance/records \
     -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"truckId":"<id>","scheduleId":"<sched-id>","performedAt":"2026-05-10","performedMiles":55200,"serviceType":"oil","costCents":8900}'
   ```
3. `GET /fleet/maintenance/due` — schedules past due appear here.
4. Visit `/fleet/maintenance` in the web UI to see the due list rendered.

## 7. Expirations dashboard

1. Open `/fleet/expirations`.
2. Default window is 30 days. Buckets render in this order:
   - **Expired** — anything past today (likely empty in a fresh seed).
   - **Critical (≤ 7 days)** — should contain the truck insurance (5 days)
     and driver medical card (3 days).
   - **Warning (≤ 30 days)** — should contain the uploaded registration
     document (20 days) and the truck registration field (20 days).
3. Each row shows `Nd left` plus the absolute date.

## 8. Cross-tenant isolation (smoke)

1. Open a private window. Sign up a fresh tenant.
2. Try `/fleet/trucks` — list is empty.
3. Visit `/fleet/trucks/<id-from-acme-tenant>` — 404.
4. Try downloading the uploaded document by id (URL-guessed) — 403/404.

---

## What's deferred

- Maintenance create/record forms in the web UI (API is complete; web UI
  uses /fleet/maintenance read-only for this session).
- S3 storage provider — interface is ready, only the local-disk
  implementation is wired.
- Document virus-scan — stubbed (passthrough). Integration with ClamAV is
  a Session 9 deliverable.
- EXIF preservation on photo uploads — bytes are written through unmodified;
  any EXIF-stripping tooling lands when the photo workflow ships.
- Dispatch-side DVIR submit form on the driver app (mobile-native — Sessions
  6/7 own that surface).
