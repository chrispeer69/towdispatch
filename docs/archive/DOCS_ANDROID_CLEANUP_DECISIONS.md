# Docs + Android Cleanup — Decision Log

Branch: `chore/docs-android-r08-r09-r15`. Base: `origin/master` HEAD `3a6fcee`.
Scope: Phase 0 audit items R-08, R-09, R-15. **Zero API/web/Kotlin source changes.**

---

## D1 — Worktree bootstrap
Launch named worktree `/tmp/claude-worktrees/docs-android` + branch `chore/docs-android-r08-r09-r15` did not exist. Created off fresh `origin/master` per the established bootstrap pattern. Skipped the recursive `claude --dangerously-skip-permissions` launch line (already in a session). Verified `pwd` + branch before editing.

## D2 — R-15 release domain: `api.towcommand.cloud`, not `api.ustowdispatch.cloud`
The Android build had **both** debug and release pointing at `https://api.ustowdispatch.cloud` (the bug: a debug build hits production). The task spec said use `api.towcommand.cloud`. These conflicted with the file's current value, so I checked which domain is real:
- `api.towcommand.cloud` / `app.towcommand.cloud` are **verified live**: `END_OF_SESSION_REPORT.md` (curl'd `https://api.towcommand.cloud/customers` successfully), `SMOKE_SPRINT_DECISIONS.md` (smoke harness runs against it), `BUILD_DECISIONS.md`, and `BUILD_STATUS_2026-05-17.md` ("`towcommand.cloud` + `ustowdispatch.cloud` both live").
- **Decision:** release → `https://api.towcommand.cloud`. The task is correct; the Android file's `ustowdispatch.cloud` value was the inconsistent one. Matches the verified-live production API used by the web app + smoke tests.

## D3 — R-15 debug variant: `http://10.0.2.2:3001` (emulator → host)
Task offered staging URL OR emulator loopback. Picked **`http://10.0.2.2:3001`** because:
- `10.0.2.2` is the Android emulator's alias for the host machine; `3001` is the confirmed local API dev port (`config.schema.ts` `API_PORT` default 3001).
- `AndroidManifest.xml` already sets `usesCleartextTraffic="true"`, so cleartext `http` to the emulator host works with **no manifest/source change** (R-15 forbids source changes outside `build.gradle.kts`).
- No evidence a `api-staging.towcommand.cloud` deploy exists; a dead staging URL would make fresh debug builds non-functional, whereas the emulator default works against a locally-run backend immediately.
- **Tradeoff (documented in build.gradle.kts comment):** `10.0.2.2` only resolves on the emulator. For a USB-attached physical device, run `adb reverse tcp:3001 tcp:3001` first, or override the BuildConfig string locally.

## D4 — R-08 RTO/RPO stated as targets + honest Railway gap, no fabricated price
backup-strategy.md is already explicitly honest ("daily Railway snapshot, no PITR, no cross-region replication"). Added RTO 1h / RPO 15min as **targets** at the top, then a Railway tier gap analysis: Railway's managed Postgres (Hobby/Pro) offers scheduled daily snapshots only — no native WAL streaming / PITR / warm standby (consistent with the `SESSION_44_REPORT.md` "not true active-active — Railway DB limit" finding). Two gap-closing paths documented (self-managed WAL+replica on Railway, or migrate to a PITR-native managed provider). **Cost delta left as a labeled estimate + verification TODO** rather than a fabricated dollar figure — the precise number depends on the live Railway DB size/usage and chosen target, neither assertable from the codebase. Matches the doc's existing honest voice.

## D5 — R-09 Rollback section placed after `## Deploy`
Rollback is the inverse of deploy; placed the new `## Rollback` section immediately after `## Deploy` in README.md. Grounded every step in real artifacts: Railway dashboard Deployments tab, the `release/<timestamp>-<sha>` tags `scripts/deploy.sh` step 8 pushes, the `/health`+`/ready` probe (deploy step 7), forward-only idempotent migrations (deploy step 5), and `SKIP_TESTS=1` hotfix path. Decision matrix centers on the real constraint: a code rollback does not undo a migration, so irreversible migrations ⇒ forward-fix. Cross-referenced `database-restore.md` for true data-loss (PITR) vs. a deploy rollback.

## D6 — assembleRelease produces an unsigned APK (expected, not a defect)
`build.gradle.kts` has no `signingConfigs` block. `assembleRelease` under AGP 8 reports BUILD SUCCESSFUL and emits `app-release-unsigned.apk`. Did **not** add a signing config — out of scope (R-15 = variant split only; "no source changes outside build.gradle.kts beyond the URL split"). The verification gate is BUILD SUCCESSFUL + variant string split, both satisfiable with an unsigned release APK.

## D7 — Untouched, per DO-NOT list
`NetworkModule.kt` verified only (reads `BuildConfig.API_BASE_URL` at `.baseUrl(...)`, line 68) — not modified. No Kotlin source touched. CameraX/Hilt/Room/KSP versions untouched. No new docs beyond the two listed (backup-strategy.md, README.md). No API/web changes.

---

### Verification (results recorded at commit time)
- `grep "api.towcommand.cloud" apps/driver-android/app/build.gradle.kts` → matches release variant.
- `./gradlew :app:assembleDebug` and `:app:assembleRelease` → see build output in PR body.
- Both `.md` files proofread for render.
