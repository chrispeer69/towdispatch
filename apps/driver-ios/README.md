# US Tow DISPATCH Driver (iOS)

Native iOS driver app for US Tow DISPATCH. SwiftUI + Combine + async/await, MVVM with feature-foldered modular monolith. Offline-first via a SQLite outbox (today: file-backed; GRDB swap planned — see [`SESSION_6_REPORT.md`](SESSION_6_REPORT.md)).

Min iOS: **16.4** (Stripe Tap to Pay on iPhone floor).
Min Xcode: **15.3**, tested on **Xcode 26.4**.

## Layout

```
apps/driver-ios/
├── TowCommandDriver/          # App target (SwiftUI views, view models)
│   ├── App/                   # Composition root, root view, settings store
│   ├── Features/              # Feature-foldered code
│   │   ├── Auth/              # Login + biometric
│   │   ├── Jobs/              # JobList, JobDetail, ActiveJob
│   │   ├── Photos/            # AVFoundation capture + PhotoCaptureScreen
│   │   ├── Signature/         # PencilKit signature
│   │   ├── Navigation/        # Apple/Google/Waze handoff, Twilio masked call
│   │   ├── VIN/               # VisionKit barcode + VIN check-digit
│   │   ├── Payments/          # Stripe service protocol (stub for now)
│   │   ├── Safety/            # Panic button service
│   │   ├── Earnings/, Profile/, Settings/
│   └── Resources/             # Info.plist, entitlements, Localizable.strings
├── Packages/
│   ├── Core/                  # SPM: models, networking, persistence, sync engine, state machine
│   └── DesignSystem/          # SPM: colors, typography, components, glove-mode modifier
├── TowCommandDriverTests/     # App-target unit tests (smoke + VIN validator)
├── TowCommandDriverUITests/   # UI tests (status flow harness)
├── TowCommandDriver.xcodeproj # Generated from scripts/generate-xcodeproj.py
├── scripts/
│   └── generate-xcodeproj.py  # Re-run after adding/removing app source files
├── fastlane/
│   ├── Fastfile               # `bundle exec fastlane test|beta|release`
│   └── Appfile
├── .github/workflows/ios.yml
├── .swiftlint.yml
└── SESSION_6_REPORT.md        # Build report — read this first
```

## First-time setup

```bash
cd apps/driver-ios

# Generate the Xcode project (idempotent — re-run after adding files).
python3 scripts/generate-xcodeproj.py

# Run the SPM unit tests (fast, no Xcode needed)
swift test --package-path Packages/Core

# Open in Xcode
open TowCommandDriver.xcodeproj
```

## Configuration

App config lives in `TowCommandDriver/Resources/Info.plist` under the `TCConfig`
dict. The defaults point at `http://localhost:3001` for the local backend.
Override for staging/prod by editing the plist or providing a `.local.xcconfig`
that sets `TCConfig` keys.

| Key                    | Purpose                                              | Where it goes                |
| ---------------------- | ---------------------------------------------------- | ---------------------------- |
| `ApiBaseURL`           | Backend base URL                                     | Info.plist `TCConfig`        |
| `MapboxAccessToken`    | Mapbox SDK token (deferred until SDK integration)    | Info.plist `TCConfig`        |
| `StripePublishableKey` | Stripe publishable key (deferred)                    | Info.plist `TCConfig`        |
| `SentryDSN`            | Sentry crash-reporting DSN (deferred)                | Info.plist `TCConfig`        |
| `Environment`          | `development | staging | production`                 | Info.plist `TCConfig`        |

Rotation: replace the values in the per-environment plist used by your build
configuration. Production keys should be injected by the CI runner via
`xcconfig` overlay; never commit live keys to git. The `.gitignore` already
excludes `*.local.xcconfig`.

## Build & run

### Simulator

```bash
xcodebuild build \
  -project TowCommandDriver.xcodeproj \
  -scheme TowCommandDriver \
  -destination 'platform=iOS Simulator,name=iPhone 15'
```

### Tests

```bash
# Fast loop — Core package only (no Xcode/sim required)
swift test --package-path Packages/Core

# Full suite — runs in iPhone 15 simulator
xcodebuild test \
  -project TowCommandDriver.xcodeproj \
  -scheme TowCommandDriver \
  -destination 'platform=iOS Simulator,name=iPhone 15'
```

### TestFlight

```bash
bundle exec fastlane beta
```

Requires `APPLE_ID`, `TEAM_ID`, and an App Store Connect API key in CI env
(see [`fastlane/Appfile`](fastlane/Appfile)).

### Seeding a job for manual lifecycle testing

```bash
# From the repo root
DRIVER_EMAIL=driver@demo.test DRIVER_PASSWORD=password \
  ./scripts/seed-driver-job.sh
```

Then pull-to-refresh the **Queue** tab in the running app.

## Backend contract

The iOS app mirrors the Android client's API surface
([`apps/driver-android/.../UsTowDispatchApi.kt`](../driver-android/app/src/main/java/ai/bluecollar/ustowdispatch/driver/data/api/UsTowDispatchApi.kt))
— that's the source of truth. The endpoints in use are:

```
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
GET  /dispatch/my-jobs
GET  /dispatch/me/driver
POST /dispatch/jobs/{id}/transition
POST /jobs/{id}/cancel
POST /dispatch/jobs/{id}/photos
```

If the backend grows new routes for payments / DVIR / earnings / chat, add
them in `Packages/Core/Sources/Core/Networking/Endpoints.swift` and the
matching client method in `USTowDispatchAPI.swift`.

## What ships in Session 6

Read [`SESSION_6_REPORT.md`](SESSION_6_REPORT.md) for the full inventory of
what shipped, what was deferred, and what Chris needs to do before Session 7.
