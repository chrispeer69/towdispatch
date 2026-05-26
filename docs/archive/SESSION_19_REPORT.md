# Session 19 — Android driver app MFA challenge

Date: 2026-05-12
Branches: `scope/android-mfa` (read-only scoping) → `feature/android-mfa-challenge`
(implementation), both landed on `master`.
Live URLs touched: `https://api.ustowdispatch.cloud` (via the
`https://web-production-7e5b.up.railway.app` BFF, since the custom domain
verification went through that path earlier in the session).

## What we set out to do

Drivers with MFA enrolled on the web were stuck on the Samsung S23+ at
`"MFA required — sign in via the web app first"`. The driver app's repo
specifically dropped the challenge token on the floor (the v1 punt was
annotated in code). Close the loop so the same MFA-enrolled user can sign in
end-to-end from the device, against the live backend, with no manual SQL or
web round-trip.

## What shipped

### Phase 1 — Scoping (commit `26b2140`, branch `scope/android-mfa`)

Read-only investigation, committed at `docs/android-mfa-scoping-report.md`.
Concrete deltas surfaced:
- `LoginResponse` was a flat nullable-fields DTO with a stale `mfaToken`
  field; backend now sends `challengeToken`.
- `LoginResult.MfaRequired` was a `data object` — challenge token dropped.
- No nav route, no screen, no `@POST("/auth/mfa/challenge")`.
- JWT storage is plain DataStore (left untouched, flagged for follow-up).
- Confirmed the authoritative authenticated-payload field name is
  `accessToken` (not `token`, as the session prompt suggested).

### Phase 2 — Implementation (commit `10699a1`, branch `feature/android-mfa-challenge`)

| Layer | Change |
| --- | --- |
| `AuthDtos.kt` | `LoginResponse` drops stale `mfaToken`, adds `challengeToken`, `setupToken`, `role` for completeness. New `MfaChallengeRequest` / `MfaChallengeResponse` mirror the backend contract exactly. |
| `UsTowDispatchApi.kt` | New `@POST("/auth/mfa/challenge") fun mfaChallenge(@Body req)`. |
| `AuthRepository.kt` | `LoginResult.MfaRequired` becomes a data class carrying the `challengeToken`. New `challenge(challengeToken, code)` method classifies HTTP outcomes into a dedicated `MfaChallengeResult` sealed class (401 → `InvalidCode`, 403/429 → `TooManyAttempts`, 400 → `SessionExpired`). On success persists via the existing `AuthTokenStore.saveTokens` + `saveSession` — no new storage path. |
| `ui/mfa/MfaChallengeScreen.kt` + `MfaChallengeViewModel.kt` | Numeric 6-digit field with auto-submit on the 6th keystroke, recovery-code toggle (alphanumeric paste-friendly), monospace 28sp letter-spaced display for gloved-hand legibility, error and rate-limit copy, session-expired bounce back to `/login`. |
| `LoginViewModel.kt` | `MfaRequired` now stashes the token + flips a nav field. The "go to web" string is removed. |
| `LoginScreen.kt` | New `onMfaChallenge` callback fired by a `LaunchedEffect`; VM clears the field via `onMfaNavigated()` so the effect cannot loop. |
| `DriverNavGraph.kt` | New `auth/mfa-challenge/{challengeToken}` route. The JWT is URL-encoded on the way in (a JWT is path-safe in practice, but the `/` and `_` make it worth being explicit). On `onBackToLogin` we `popBackStack(LOGIN, inclusive=false)` so a session-expired bounce drops the user back at the password screen with a clean back-stack. |

Untouched per the session spec: DataStore token store, `TokenAuthenticator`
refresh path, signup, MFA enrollment (driver app does not enroll —
backend gates `mfa_setup_required` to OWNER/ADMIN).

### Phase 3 — Live verification on hardware

Device: Samsung S23+ (model `SM_S916U`, serial `R3CWA03T0PM`) wired via ADB
after a USB-mode swap. The previously installed APK on the device had a
different debug signing key, so a clean `adb uninstall` + `adb install` was
needed once; subsequent installs work `-r`.

Provisioned a brand-new MFA-enrolled test tenant on the live BFF via the new
`apps/api/scripts/mfa-provision.mjs` helper — that script handles signup →
login (`mfa_setup_required`) → setup (TOTP secret + 10 recovery codes) →
verify (TOTP) → printed credentials + secret + recovery codes — so the
device test had a known TOTP seed to generate codes from on the host.

End-to-end walkthrough on the phone, driven through `adb shell input`:

```
app boot                                     → no crash in logcat
tap email field, type address                → populated
TAB to password, type password               → populated
back-key dismisses keyboard                  → Sign-in button revealed
tap Sign in                                  → /auth/login → mfa_required
                                               + challengeToken
nav routes to /auth/mfa-challenge/{token}    → "Two-factor required" screen
                                               renders with the 6-digit field,
                                               "Use a recovery code instead"
                                               toggle, and "Back to sign in"
type 6-digit TOTP code (auto-submit fires)   → /auth/mfa/challenge 200,
                                               accessToken + refreshToken
                                               persisted to DataStore
isLoggedIn flips                             → NavGraph routes to /jobs,
                                               "Active jobs / Driver Dev"
                                               with empty-state visible
```

Screenshots captured at each transition; no errors in logcat for the app
process beyond the existing benign SLF4J no-op warning from OkHttp's logging
interceptor.

## Decisions made under the no-questions guardrail

| Decision | Why |
| --- | --- |
| Kept `LoginResponse` as a flat nullable-fields DTO. | Already the established pattern, and `kotlinx.serialization` ignores unknown keys, so extending it is non-breaking. Refactoring to a sealed class would have churned every call site for no payoff. |
| `LoginResult.MfaRequired` → data class instead of new sealed type. | Smallest possible shape change, keeps the existing `when` in `LoginViewModel` legible. |
| New `MfaChallengeResult` sealed class instead of overloading `LoginResult`. | The challenge screen needs MFA-specific copy (rate-limit vs invalid-code vs session-expired) that the regular login flow has no business surfacing. |
| Single-field numeric input with auto-submit on the 6th keystroke; **no** 6-slot auto-advance UX. | Auto-advance looks slick but breaks paste, screen readers, and gloves. A single tall field with a numeric IME is the right call for the actual user. Comments left in the code explaining the choice. |
| Recovery-code toggle stays in the same screen. | Adding a second route would have meant another nav graph entry for one extra mode toggle. The viewmodel's `mode` field keeps the contract tight. |
| URL-encode the challenge JWT into the nav arg. | JWTs are mostly path-safe in practice, but `_` and `-` aren't the only payload chars and `=` padding has been spotted in the wild. Cheap defensive choice. |
| Did **not** touch JWT storage. | Plain DataStore stays as-is; flagged as future hardening (EncryptedSharedPreferences or DataStore-with-Keystore-wrapped-DEK) but out of scope for this session. |

## End-to-end provisioning helper

Committed at `apps/api/scripts/mfa-provision.mjs`. Hits the live BFF and
prints credentials + TOTP secret + recovery codes for a fresh MFA-enrolled
test tenant. Run from `apps/api` so `otplib` resolves via workspace deps:

```
node scripts/mfa-provision.mjs
# → email/password/tenant/secret/current-TOTP/10 recovery codes
```

Useful any time a future session needs a known-good MFA account to drive
device/web tests against.

## Open follow-ups (not blocking, surfaced this session)

- **Plain DataStore for tokens.** Move to `EncryptedSharedPreferences` (or
  DataStore with a Keystore-wrapped DEK) so a rooted device or a malicious
  on-device app can't read tokens directly. Affects this session's
  `challengeToken` path too — the bridge fields all go through the same
  store on success.
- **`needs_tenant_selection` is still dropped.** Same shape of gap as MFA
  was; pattern of fix is identical (carry data through `LoginResult`, add a
  picker screen). Hit it when it matters.
- **Two pre-existing deprecation warnings** in the Android build, not from
  this session:
  - `Room.fallbackToDestructiveMigration()` (use the parameterized overload)
  - `LocalLifecycleOwner` import (moved into the
    `androidx.lifecycle.compose` package)
- **Signing key drift between dev machines.** First install on the S23+
  failed with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` because the previous APK
  was signed with a different debug keystore. One-time `adb uninstall` cured
  it. Worth standardising on a shared dev debug keystore (or a `signingConfigs`
  block pointing at a committed keystore) if more than one machine ships
  debug builds.

## Acceptance criteria — final state

- [x] `LoginResponse` carries `challengeToken` (and `setupToken` + `role`
      for completeness).
- [x] `MfaChallengeRequest` / `MfaChallengeResponse` DTOs added.
- [x] `@POST("/auth/mfa/challenge")` on `UsTowDispatchApi`.
- [x] `LoginResult.MfaRequired` carries `challengeToken`.
- [x] `AuthRepository.login()` surfaces the token rather than dropping it.
- [x] `AuthRepository.challenge()` calls the endpoint, persists via
      existing `AuthTokenStore`, returns `MfaChallengeResult`.
- [x] New Compose `MfaChallengeScreen` with all required UX states.
- [x] `auth/mfa-challenge/{challengeToken}` route on the nav graph; old
      "go to web" string deleted.
- [x] No duplicate routing logic — the existing `isLoggedIn` observation in
      `DriverNavGraph` is what fires the move into the authed flow on
      success.
- [x] `./gradlew :app:assembleDebug` clean (1m 15s).
- [x] APK installed on connected S23+ via ADB.
- [x] Full flow walked end-to-end against the live backend: signup →
      mfa-enrolled login → MFA challenge screen → TOTP verify →
      "Active jobs" with tenant name.
