# US Tow DISPATCH — Android Driver App

Native Android driver client. Built with Jetpack Compose, Hilt, Room, Retrofit + kotlinx-serialization, WorkManager, FusedLocationProvider, and CameraX.

`minSdk` 26 · `targetSdk` 35 · Kotlin 2.0.21 · AGP 8.5.2

## Build

```bash
# JAVA_HOME must point at OpenJDK 17
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"

./gradlew :app:assembleDebug         # APK → app/build/outputs/apk/debug/
./gradlew :app:testDebugUnitTest     # JUnit reports → app/build/reports/tests/
./gradlew :app:lintDebug             # Lint report → app/build/reports/lint-results-debug.html
```

The Android SDK location must be set in `local.properties` (not committed). Example:
```
sdk.dir=/opt/homebrew/share/android-commandlinetools
```

## Backend contract — endpoints consumed

| Group | Method | Path | Purpose |
|---|---|---|---|
| **PIN auth** | POST | `/driver-auth/lookup-by-code` | 6-digit workshop code → tenant + driver picker |
|  | POST | `/driver-auth/list-drivers` | Tenant slug → driver picker |
|  | POST | `/driver-auth/login` | driverId + PIN → 12h JWT |
| **Operator (legacy)** | POST | `/auth/login` | Email + password (kept for ops who also use the app) |
|  | POST | `/auth/refresh` | Refresh token swap |
|  | POST | `/auth/logout` | Revoke refresh |
|  | GET | `/auth/me` | Current operator profile |
| **Briefing** | GET | `/driver-briefings/needs-acknowledgment` | Gate decision |
|  | GET | `/driver-briefings/active` | Full briefing payload |
|  | POST | `/driver-briefings/{id}/acknowledge` | Record ack |
| **Pre-trip** | POST | `/driver-pretrip` | Submit inspection |
|  | GET | `/driver-pretrip/my-recent` | Gate decision |
| **Jobs** | GET | `/dispatch/my-jobs` | Driver's assigned queue |
|  | GET | `/dispatch/me/driver` | Driver profile |
|  | POST | `/dispatch/jobs/{id}/transition` | Status change |
|  | POST | `/jobs/{id}/cancel` | Cancel with reason |
| **Evidence (S3)** | POST | `/job-evidence/presign` | Get presigned upload URL |
|  | POST | `/job-evidence/{id}/finalize` | Mark uploaded |
|  | POST | `/job-evidence/{id}/fail` | Mark dead |
| **Offline replay** | POST | `/driver-offline-sync/replay` | Batch up to 50 queued mutations |
| **Telemetry** | POST | `/driver-telemetry/batch` | GPS sample batch |
| **Field payment** | POST | `/job-field-payments/create-intent` | Stripe Terminal intent |
|  | POST | `/job-field-payments/{id}/capture` | Capture |
|  | POST | `/job-field-payments/{id}/cancel` | Cancel |
| **Photos (legacy)** | POST | `/dispatch/jobs/{id}/photos` | Inline base64 upload — fallback only |

All driver-scoped endpoints expect `Authorization: Bearer {driverJwt}` except the three `/driver-auth/*` calls which are public.

## Architecture

```
ui/                    Jetpack Compose screens + ViewModels (Hilt-injected)
data/api               Retrofit interface + interceptors
data/api/dto           kotlinx-serialization DTOs
data/auth              App Link deep-link redeemer
data/connectivity      NetworkCallback-backed ConnectivityObserver
data/jobs              Job state machine (mirrors backend)
data/local             Room database + entities + DAOs
data/prefs             DataStore-backed AuthTokenStore
data/repo              Repository layer (briefing, pretrip, evidence, payment, sync)
data/sync              DriverSyncEngine + WorkManager workers
data/telemetry         FusedLocationProviderClient wrapper
di                     Hilt modules
```

### Offline-first invariant

Every mutating driver action funnels through `OutboxRepository.enqueue()` before touching the network. `DriverSyncEngine.drain()` is the only consumer of the outbox; it batches up to 50 queued actions per `/driver-offline-sync/replay` call. Triggered by:
- App start (when there are pending rows)
- Connectivity changes (`ConnectivityObserver.onAvailable`)
- Manual retry tap on the offline screen
- Tail end of any mutating repo call (best-effort online)

### S3 evidence pipeline

`PendingEvidenceEntity` row walks `PENDING → PRESIGNED → UPLOADED → FINALIZED`. `EvidenceUploadWorker` (`@HiltWorker`) drains under `NetworkType.CONNECTED` and resumes from the latest checkpoint on retry. The S3 PUT uses a dedicated `@S3Upload`-qualified `OkHttpClient` that doesn't carry the driver Authorization header (presigned URL is already signed) and skips logging.

### WorkManager unique work

- `"driver-sync"` → `SyncWorker` (drains offline outbox)
- `"driver-upload"` → `EvidenceUploadWorker` (drains S3 pipeline)

Both use `ExistingWorkPolicy.KEEP` so concurrent enqueues collapse.

### Job state machine

8 states (`new`, `dispatched`, `enroute`, `on_scene`, `in_progress`, `completed`, `cancelled`, `goa`) — exact mirror of `apps/api/src/modules/jobs/job-state-machine.ts`. The driver UI surfaces only the forward path plus terminal off-ramps; the dispatcher-only `dispatched → new` unassign branch is filtered out by `JobStateMachine.driverActions()`.

## Permissions

| Permission | Why |
|---|---|
| `INTERNET` | Obvious |
| `ACCESS_NETWORK_STATE` | Connectivity observer |
| `CAMERA` | Photo capture |
| `ACCESS_FINE_LOCATION` + `COARSE` | GPS telemetry + job-transition coordinates (foreground only) |
| `POST_NOTIFICATIONS` | New-job FCM alerts |
| `VIBRATE`, `WAKE_LOCK`, `FOREGROUND_SERVICE` | Job-alert haptics, keep-screen-on during signature |
| `CALL_PHONE` | Customer tel: shortcuts |

**Background location** (`ACCESS_BACKGROUND_LOCATION`) is intentionally **not** declared. Phone is foregrounded during shift; the Android 11+ background-permission flow is friction we'll add behind an operator setting later.

## App Links

The manifest declares an `<intent-filter android:autoVerify="true">` for `https://app.towcommand.cloud/driver/d/{code}`. Once `.well-known/assetlinks.json` is hosted on the domain with the release-keystore SHA-256 fingerprint, this opens the app directly without a chooser. `DriverCodeRedeemer` persists the code so the PIN entry screen pre-seeds the picker.

## Localization

`res/values/strings.xml` (English) + `res/values-es/strings.xml` (Spanish). Uncertain Spanish translations are flagged with `// TODO(i18n)` comments.

## Session log

See `SESSION_7_REPORT.md` for the full decision log behind this build's scope and deferrals.
