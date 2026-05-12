# Android MFA Gap — Scoping Report

Read-only investigation. No code changes proposed; this report only describes
what is in the tree today.

---

## 1. Android source location

`apps/driver-android/`

This is the *driver* app (Gradle namespace `ai.bluecollar.towcommand.driver`,
applicationId `ai.bluecollar.towcommand.driver`). It is the only Android module
in the repo — there is no `apps/admin-android` or similar. iOS lives at
`apps/driver-ios` and is out of scope here.

Module under inspection: `apps/driver-android/app/`.

---

## 2. Login flow code

### Files

| Layer | Path |
| --- | --- |
| Login screen (Compose) | `apps/driver-android/app/src/main/java/ai/bluecollar/towcommand/driver/ui/login/LoginScreen.kt` |
| Login view-model | `apps/driver-android/app/src/main/java/ai/bluecollar/towcommand/driver/ui/login/LoginViewModel.kt` |
| Repository (calls API, returns sealed `LoginResult`) | `apps/driver-android/app/src/main/java/ai/bluecollar/towcommand/driver/data/repo/AuthRepository.kt` |
| Retrofit interface | `apps/driver-android/app/src/main/java/ai/bluecollar/towcommand/driver/data/api/TowCommandApi.kt` |
| Login response DTOs | `apps/driver-android/app/src/main/java/ai/bluecollar/towcommand/driver/data/api/dto/AuthDtos.kt` |

### Login response data class

`AuthDtos.kt` models the API response as a **single flat `@Serializable data class`**,
not a sealed class. Every status-specific field is declared as nullable so the
same class can carry any of the four backend variants:

```kotlin
@Serializable
data class LoginResponse(
    val status: String,
    val user: AuthUserDto? = null,
    val tenant: AuthTenantDto? = null,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val expiresIn: Int? = null,
    val tenants: List<TenantSelectionDto>? = null,
    val mfaToken: String? = null,        // STALE — server now sends `challengeToken`
)
```

There is **no** `challengeToken` field, **no** `setupToken` field, and **no**
`role` field on this DTO. The class predates the MFA refactor that landed in
this session.

Authoritative backend shape (`packages/shared/src/schemas/auth.ts`):

| status | additional fields |
| --- | --- |
| `authenticated` | `user`, `tenant`, `accessToken`, `refreshToken`, `expiresIn` |
| `needs_tenant_selection` | `tenants[]` |
| `mfa_required` | **`challengeToken`** (used to be `mfaToken`) |
| `mfa_setup_required` | `setupToken`, `role` |

The prompt mentioned `{status: "authenticated", token: "..."}` — the actual
field name is `accessToken`, not `token`, and the response also carries
`refreshToken`, `expiresIn`, `user`, and `tenant`.

### How the response is handled

`AuthRepository.login()` (lines 26-55) does a `when (res.status) {}` on the
string:

- `"authenticated"` → unpacks `accessToken` + `refreshToken`, persists via
  `AuthTokenStore`, returns `LoginResult.Success(role)`.
- `"mfa_required"` → returns `LoginResult.MfaRequired` (a `data object`, no
  payload carried — the `mfaToken` / `challengeToken` is **dropped on the
  floor**).
- `"needs_tenant_selection"` → returns `LoginResult.NeedsTenantSelection`
  (also a `data object`, tenant list dropped).
- everything else → `LoginResult.Failure("Unexpected response status: $status")`.
  Note `"mfa_setup_required"` is NOT a recognized branch and falls into this
  bucket; if a driver-role user ever happens to receive that status (today the
  backend gates it on OWNER/ADMIN, so drivers won't, but the case isn't covered).

`LoginResult` itself is a sealed class with four cases (`Success`, `MfaRequired`,
`NeedsTenantSelection`, `Failure`).

### The "MFA required — sign in via the web app first" string

Lives at `apps/driver-android/.../ui/login/LoginViewModel.kt:45`:

```kotlin
LoginResult.MfaRequired -> _state.update {
    it.copy(submitting = false, error = "MFA required — sign in via the web app first")
}
```

This is a **deliberate branch in the state machine**, not a generic error
fallback. The repository specifically returns `LoginResult.MfaRequired`, and
the VM specifically converts it into that user-facing string and surfaces it
in the existing `LoginUiState.error` field. There is no MFA screen, no
navigation, no challenge call — it terminates the flow.

The AuthDtos comment (line 32-36) is explicit about the intent:

> The driver app only cares about the authenticated payload — multi-tenant
> pick + MFA are out-of-scope for v1. We model the success case and reject
> the rest at the repository layer.

So the gap is acknowledged in code; the v1 punt is now what's blocking the
real-device login on Samsung S23+.

---

## 3. Navigation system

**Jetpack Compose Navigation, single-activity.**

- Nav graph: `apps/driver-android/app/src/main/java/ai/bluecollar/towcommand/driver/ui/nav/DriverNavGraph.kt`
- `MainActivity.kt` mounts `DriverNavGraph()` once; everything else is a
  composable destination.
- String-keyed routes via an `object Routes { const val LOGIN = "login" … }`
  and `composable(Routes.X) { … }`. Args via `navArgument`.
- Existing destinations: `LOGIN`, `JOB_LIST`, `JOB_DETAIL`, `PHOTO_CAPTURE`,
  `SIGNATURE`, `PROFILE`, `EARNINGS`.
- Start destination is decided by an observed `AuthTokenStore.isLoggedIn`
  flow (line 54). Logged-in → `JOB_LIST`, else → `LOGIN`. The graph hands a
  `onAuthenticated` lambda into `LoginScreen`; the lambda does
  `navController.navigate(JOB_LIST) { popUpTo(LOGIN) { inclusive = true } }`.
- ViewModels are produced by `hiltViewModel()` at each composable. There is
  no shared state across destinations beyond the token store.

No nested graphs, no bottom-nav, no fragments.

---

## 4. Existing dependencies

From `apps/driver-android/app/build.gradle.kts` (lines 52-105). Versions are
in the catalog, not in this file.

| Concern | Present today |
| --- | --- |
| **TOTP** | **None.** No `otplib`, `googleauth`, `Authy`, or hand-rolled RFC 6238. (Not needed on the driver path — the driver only validates a code the user types in, the server does the math.) |
| **Networking** | Retrofit 2 + OkHttp + OkHttp logging interceptor. |
| **JSON / serialization** | `kotlinx.serialization.json` + `retrofit2.converter.kotlinx-serialization`. Configured with `ignoreUnknownKeys = true`, `explicitNulls = false`, `coerceInputValues = true` (`NetworkModule.kt:26-30`). Adding new optional fields to `LoginResponse` is therefore source-compatible — old builds won't crash on a `challengeToken` field they don't know about. |
| **QR rendering** | **None.** No `zxing`, no `qrcode-kotlin`. (Not needed for the driver-side challenge flow — drivers consume codes, they don't enroll on the device.) |
| **DI** | Hilt (`hilt.android`, `hilt.compiler` kapt, `hilt.navigation.compose`, `hilt.work`). |
| **Storage** | Jetpack DataStore Preferences (`androidx.datastore.preferences`) + Room. No `EncryptedSharedPreferences`. |
| **UI** | Compose BOM, Material3, Material icons extended, navigation-compose, lifecycle-runtime/viewmodel-compose, activity-compose. |
| **Other notable** | CameraX (photo capture), Firebase Messaging (push), WorkManager, Coil, Accompanist permissions. |

Plugins (top of file): `android.application`, `kotlin.android`, `kotlin.compose`,
`kotlin.kapt`, `hilt`, `ksp`, `kotlinx.serialization`, `google.services`. JVM
target 17, compileSdk 35, minSdk 26.

---

## 5. API client setup

### Base URL

`BuildConfig.API_BASE_URL` is hardcoded to `"https://api.towcommand.cloud"` for
both `debug` and `release` buildTypes (`build.gradle.kts:28, 32`). No staging
or local-dev override switch lives in this file. Retrofit is constructed in
`NetworkModule.provideRetrofit()` (`NetworkModule.kt:51-59`) with that base URL
plus the kotlinx JSON converter.

### Auth interceptor pattern

Two-layer pattern on the OkHttp client built in `NetworkModule.kt:32-49`:

- **`AuthInterceptor` (per-request, adds Bearer):** reads
  `tokenStore.accessTokenSnapshot()` synchronously inside `runBlocking` and
  attaches `Authorization: Bearer <token>` if the access token is present.
  Source: `data/api/AuthInterceptor.kt`.
- **`TokenAuthenticator` (OkHttp `Authenticator`, handles 401-refresh-retry):**
  on a 401, blocks on `tokenStore.refreshTokenSnapshot()`, calls
  `api.refresh(RefreshRequest(refresh))`, persists the rotated pair, and
  replays the original request with the new token. One retry max. If refresh
  fails, the token store is cleared (the next `isLoggedIn` flow tick drops
  the app back to `LOGIN`). Source: `data/api/TokenAuthenticator.kt`. Uses
  `Provider<TowCommandApi>` to break the OkHttp ↔ Retrofit construction cycle.

### How the JWT is stored

`apps/driver-android/app/src/main/java/ai/bluecollar/towcommand/driver/data/prefs/AuthTokenStore.kt`.

**Jetpack DataStore (Preferences)**, file `auth_prefs`. **Plain DataStore — NOT
EncryptedSharedPreferences** and not the encrypted variant of DataStore.

Stored keys after a successful login:

- `access_token` (string)
- `refresh_token` (string)
- `access_expires_at_epoch_ms` (long, computed as `now + expiresInSec*1000`)
- `user_id`, `user_email`, `user_name` (= `"$firstName $lastName"`)
- `role`, `tenant_slug`, `tenant_name`
- plus app prefs unrelated to auth (notif sound/vibrate, map provider)

Save path (from `AuthRepository.login()`):

```kotlin
tokenStore.saveTokens(access, refresh, ttl)
tokenStore.saveSession(userId, email, firstName, lastName, role, tenantSlug, tenantName)
```

Logout calls `tokenStore.clear()` + `jobDao.clearAll()`.

The `isLoggedIn` Flow is the single source of truth for "am I authed?" — it
maps `access_token != null/blank`. `DriverNavGraph` observes it to choose the
start destination.

---

## 6. What's missing for MFA challenge

Concretely, for the driver app to handle `mfa_required` on the live backend:

### DTO / parsing

- **`LoginResponse` is missing `challengeToken`.** It still carries the stale
  `mfaToken` field; the backend has renamed this. New optional field needs to
  be added (and the dead `mfaToken` removed or aliased). `kotlinx.serialization`
  is configured with `ignoreUnknownKeys = true`, so live responses already
  *parse* — they just lose the token.
- **`LoginResponse` is missing `setupToken` and `role`** (for completeness
  even though drivers don't currently receive `mfa_setup_required`).
- No `MfaChallengeRequest` / `MfaChallengeResponse` DTOs exist. Backend
  contract from `packages/shared/src/schemas/auth.ts`:
  - request: `{ challengeToken: string, code: string }` where `code` is a
    6-digit TOTP **or** a recovery code (server is whitespace/dash-insensitive)
  - response: same `AuthenticatedResponse` shape as a normal login (`status`,
    `user`, `tenant`, `accessToken`, `refreshToken`, `expiresIn`).

### Retrofit interface

- `TowCommandApi.kt` has no `@POST("/auth/mfa/challenge")` method. Needs to
  be added.

### Repository (`AuthRepository.kt`)

- `LoginResult.MfaRequired` is a `data object` — it drops the challenge
  token. Needs to become a data class carrying the token through to the VM.
- Needs a new method like `submitMfaChallenge(challengeToken, code) ->
  LoginResult` that calls the new endpoint, treats the response identically to
  the `"authenticated"` branch of `login()` (persist tokens + session), and
  returns `LoginResult.Success(role)`.
- The "Unexpected response status" else branch will also be hit by
  `mfa_setup_required` — drivers aren't expected to hit that today, but the
  branch should at minimum produce a clean "MFA enrollment must be completed
  on the web app" message rather than the generic unexpected-status one.

### View-model

- `LoginViewModel.kt` line 45 currently transforms `MfaRequired` into a
  terminal error string. That branch needs to switch to: stash the
  `challengeToken` in some shared state and trigger navigation to the new
  challenge destination.
- A new view-model (e.g., `MfaChallengeViewModel`) is needed for the
  challenge screen: holds the 6-digit code input, the (optional) recovery-code
  toggle, an inflight flag, and the error string. On submit it calls
  `authRepo.submitMfaChallenge(...)`. On success, the existing
  `AuthTokenStore` write triggers `isLoggedIn = true`, which is exactly the
  signal the rest of the app already uses to enter the authed graph — so
  almost no other code has to change.

### Navigation

- `Routes` needs a new entry, e.g. `MFA_CHALLENGE = "auth/mfa/challenge"`,
  registered with `composable(Routes.MFA_CHALLENGE) { MfaChallengeScreen(...) }`
  in `DriverNavGraph.kt`.
- Token handoff between `LoginScreen` and the MFA challenge screen — options:
  - pass through nav arg (would put a short-lived JWT in the back stack URL,
    survives recompose but is ugly),
  - keep it in a shared `@HiltViewModel` scoped to the activity, or
  - keep it in a small in-memory `MfaSessionHolder` singleton (no
    persistence — the 5-min token shouldn't outlive a process death).
- The `onAuthenticated` lambda already wired into `LoginScreen` is also the
  right callback to fire after a successful challenge — the success path is
  identical (tokens are now in DataStore, `isLoggedIn` flips, route to
  `JOB_LIST`).

### UI

- New Compose screen for the challenge: 6-digit numeric input, error display,
  submit button, and a "use a recovery code" link/toggle that switches the
  field's keyboard / pattern. Matches the existing `LoginScreen` layout
  (Scaffold + centered Column + Material3 OutlinedTextField + Button).

### Storage / interceptors

- **No changes needed.** The existing `AuthTokenStore.saveTokens` /
  `saveSession` are the exact same call shape the challenge response will
  use; `AuthInterceptor` + `TokenAuthenticator` continue to work because
  they only ever see the access/refresh tokens that ultimately land in the
  same DataStore keys.

### Build / dependencies

- **No new libraries required.** No TOTP, no QR — the driver receives a
  6-digit code from a separate authenticator app (Google Authenticator, 1Password,
  etc.) and just types it in. The server validates it.

### Out of scope (worth flagging but not part of "fix the challenge gap")

- **Enrollment on device.** Drivers don't currently get
  `mfa_setup_required` from the backend (gated to OWNER/ADMIN in
  `auth.service.ts`), so no QR/recovery-code panel is needed on Android. If
  driver enrollment is ever a requirement, that's a separate piece of work
  involving a QR view (e.g. `zxing-android-embedded`) and a recovery-code
  display.
- **EncryptedSharedPreferences / Keystore-backed token storage.** The
  current store is plain DataStore. Not strictly a blocker for the MFA gap
  — but the MFA work introduces a new token type (`challengeToken`) flowing
  through the same store. Worth a separate hardening pass.
- **The `tenants[]` payload on `needs_tenant_selection` is also discarded**
  by `AuthRepository.login()`. Same shape of gap as the MFA one. Same fix
  pattern (carry the data through the sealed `LoginResult`, add a screen).
