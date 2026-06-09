# API Config Cleanup — Decision Log (R-10 / R-11)

Branch: `chore/api-config-r10-r11`. Scope: move 2 hardcoded value-sets in
`apps/api` into validated config. Source: `docs/audits/PHASE_0_AUDIT_2026-05-14.md`
items R-10 and R-11.

---

## R-10 — Problem-type URN

**D1 — Default domain is `https://errors.ustowdispatch.cloud`, not the
`ustowdispatch.cloud` the task text named.**
- The task text said "default `https://errors.ustowdispatch.cloud` per actual prod
  domain." `towcommand` is the PRE-rebrand brand. Session 20 rebranded the repo
  to US Tow Dispatch; the live API infra is `api.ustowdispatch.cloud` (confirmed
  by grepping SESSION_18/19/20 reports, the Android `BuildConfig`, and the
  Session 19 merge report's "rebrand domain wins" rule).
- The current hardcode is `https://errors.ustowdispatch.com` (`.com`). R-10's
  actual intent (per the audit) is to fix the `.com` vs `.cloud` inconsistency —
  prod infra is `.cloud`. So the correct, intent-matching default is
  `https://errors.ustowdispatch.cloud`: post-rebrand brand + prod TLD.
- This is a deliberate value change (`errors.ustowdispatch.com` →
  `errors.ustowdispatch.cloud`), not a typo. RFC 9457 problem-type URIs are
  identifiers and need not resolve, so no client breaks; prod can still override
  via the new env var.

**D2 — Filter takes `ConfigService` in its constructor; logger is derived from
it.**
- Task said "Inject ConfigService into filter." The filter is manually `new`'d
  in `main.ts` (not Nest-DI-resolved), where `config = app.get(ConfigService)`.
- Old constructor was `(logger, sentry?)`. New is `(config, sentry?)` and
  `this.logger = config.logger` — `config.logger` is the exact object previously
  passed, so logging behavior is byte-identical. Removes the redundancy of
  passing both `config.logger` and `config`.

**D3 — `PROBLEM_TYPE_BASE` is `z.string().url().default(...)`; getter strips a
trailing slash.**
- URN is built as `${base}/<problem-type>`; the getter `problemTypeBase` trims a
  trailing `/` so an operator who sets `…cloud/` doesn't produce `…cloud//CODE`.
- `.env.example` writes the literal default value (mirrors `API_PUBLIC_URL`), NOT
  an empty `PROBLEM_TYPE_BASE=` — an empty string fails `.url()` and exits(1) on
  boot (see `reference_zod_url_default_empty_crashes_boot`).

## R-11 — Intuit OAuth endpoints

**D4 — Three env vars, exactly as specced: `QBO_APPCENTER_BASE`,
`QBO_OAUTH_BASE`, `QBO_API_BASE`.** Defaults grepped/confirmed against the
existing hardcodes:
- `QBO_APPCENTER_BASE=https://appcenter.intuit.com`
- `QBO_OAUTH_BASE=https://oauth.platform.intuit.com`
- `QBO_API_BASE=https://quickbooks.api.intuit.com`
- The path suffixes (`/connect/oauth2`, `/oauth2/v1/tokens/bearer`,
  `/v3/company`) are part of Intuit's API contract, not "base URLs," so they
  stay in `QboProvider`.

**D5 — Sandbox data-API base is DERIVED from `QBO_API_BASE` by prefixing the host
with `sandbox-`; no 4th env var.**
- Intuit's sandbox differs from prod ONLY on the data-API host
  (`sandbox-quickbooks.api.intuit.com`); the OAuth and AppCenter hosts are
  identical for sandbox and prod — which is exactly why the old code had a single
  `OAUTH_TOKEN_URL`/`APPCENTER_BASE` but split `API_BASE_PROD`/`API_BASE_SANDBOX`.
- The per-credential `creds.sandbox` switch is preserved (sandbox is per-tenant,
  not a deploy-wide flag), so no sync logic changes. Default behavior is
  byte-identical. Sandbox values are documented in `.env.example` comments.

**D6 — Threaded through the `QboProvider` constructor `opts` (no global imports),
per the task.** `accounting.module.ts` reads them off the `config.quickbooks`
getter and passes them in; the module already injects `ConfigService` into its
factory.

---

## Verification

- `pnpm --filter @ustowdispatch/api typecheck`
- `pnpm --filter @ustowdispatch/api test`
- `pnpm --filter @ustowdispatch/api build`

(Results recorded in the PR description.)
