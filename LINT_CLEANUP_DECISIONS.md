# LINT_CLEANUP_DECISIONS.md

Lint-only PR. Clears the pre-existing repo-wide biome lint **errors** deferred across PRs #92, #93, #94. No features, no refactors, no behavior changes.

## TL;DR

- **37 biome errors → 0.** `pnpm lint` now exits 0.
- 33 cleared by safe auto-fix (`biome check --write`), 4 by targeted manual edits.
- 22 warnings intentionally left untouched — out of scope for an errors-only pass (see below).
- One latent bug surfaced and fixed because it *was* the lint error (broken CSS selector). Zero behavior impact — the selector was unused.

## Inventory (baseline, from `biome check .`)

792 files checked. **37 errors, 22 warnings.** Error breakdown by `×` diagnostic (ground truth from the default reporter; the `--reporter=summary` error/warning split miscounts noNonNullAssertion and is not authoritative):

| Rule / category | Errors | Auto-fixable (safe) |
|---|---|---|
| `format` (formatter would reflow) | 20 | yes |
| `organizeImports` (imports unsorted) | 8 | yes |
| `lint/correctness/noUnusedImports` | 3 | yes |
| `lint/style/useTemplate` | 1 | unsafe only → manual |
| `lint/style/noUnusedTemplateLiteral` | 1 | unsafe only → manual |
| `lint/suspicious/noExplicitAny` | 1 | manual |
| `globals.css` parse error (`Expected an identifier`) ×2 + `format` aborted ×1 | 3 | manual |
| **Total** | **37** | |

## Decision log

1. **Scope `--write` to an explicit file list, not `biome check --write .`.**
   `organizeImports` is enabled in `biome.json`. A repo-wide `--write` would have been safe in principle (biome only edits flagged files), but to guarantee zero collateral churn the write pass was run against the exact 28-file union of flagged files. Result: 29 files changed total (28 + the manual `client.ts`), all from the flagged set — confirmed via `git status`.

2. **`format` diagnostics touch many lines per file. Expected, not a refactor.**
   Biome's formatter rewraps long array/argument lists onto multiple lines (lineWidth 100) and corrects indentation. e.g. `test/user-invites-rls.spec.ts` shows +39 lines — that is line-wrapping of SQL parameter arrays, contents and order byte-identical. No logic changed.

3. **`noUnusedImports` removals (3) verified as named-symbol imports, not side-effect imports.**
   - `apps/web/src/lib/auth/session.ts`: removed `cookies` from `next/headers` — no remaining `cookies()` call site (only the unrelated `./cookies` module import + comments remain).
   - `apps/api/src/modules/users/user-invites.controller.ts`: removed unused `Query`, `ForbiddenException`.
   - `apps/api/src/modules/users/user-invites.service.ts`: removed 1 unused import.
   None are `import './x'` side-effect lines. Typecheck (api + web) confirms nothing broke.

4. **`mfa-provision.mjs:72` — `useTemplate` + `noUnusedTemplateLiteral` fixed manually.**
   Biome only offers *unsafe* fixes for these two and they conflict (one wants a plain string, the other wants a template literal). Manual fix: collapsed the `+`-concatenated template literals into a single template literal. Removes the concatenation (clears `useTemplate`) and the single literal still interpolates `${email}` etc. (clears `noUnusedTemplateLiteral`). Output string is byte-identical. The result is one ~240-char line; that is the *only* form satisfying both rules at once, and biome does not reflow inside template literals, so it passes the formatter unchanged.

5. **`client.ts:114` — `noExplicitAny` fixed by `RequestOpts<any>` → `RequestOpts<unknown>`.**
   `resolveAccessToken` reads only `opts.accessToken`; the `TBody` generic is irrelevant to it. `unknown` is the minimal correct type. Callers pass `RequestOpts<TBody>`, which is assignable to `RequestOpts<unknown>`. Typecheck clean.

6. **`globals.css:224` — parse error was a real bug; fixed by restoring the intended selector.**
   The selector read `. {` (a bare dot). `git blame` traces it to commit `0a6552a2` ("design(web): visual system ripple", #19), a token-rename pass that mangled `.bg-orange-glow-radial` down to `.`. The malformed rule meant biome could not parse OR format the file (3 of the 37 errors). Fix: `. {` → `.bg-orange-glow-radial {`.
   **Behavior impact: none.** `grep` confirms `.bg-orange-glow-radial` is referenced nowhere in `apps/web/src` — the class is dead either way, so restoring the name changes no rendered output. Restoring the original name (vs deleting the block) is the smaller, intent-preserving change and keeps the design token usable.

## Warnings left untouched (out of scope — 22)

This is an errors-only PR; `pnpm lint` already exits 0 with these present. Left as-is:

- `lint/style/noNonNullAssertion` ×16 — `warn` severity per `biome.json`. Fixing each `!` is a per-site judgment call that risks behavior change; not a lint *error*.
- `lint/suspicious/noConsoleLog` ×2 (`client.ts:168,198`) — deliberate diagnostic logging guarded by a `// Remove once the list-pages-empty triage closes` comment. Owner's intentional temp instrumentation; not ours to remove.
- `lint/correctness/useExhaustiveDependencies` ×2 — `warn`; touching React dep arrays can change render/effect behavior.
- `suppressions/unused` ×2 (`dispatch-map.tsx:124,156`) — `warn`; stale `// biome-ignore` comments. Harmless; out of an errors-only scope.

## Rules disabled

**None.** No global rule disables, no new `// biome-ignore` comments added. `biome.json` is unchanged.

## Verification

- `pnpm lint` → **0 errors** (22 warnings, pre-existing, out of scope). Exit 0.
- `pnpm --filter @ustowdispatch/api typecheck` → clean (exit 0).
- `pnpm --filter @ustowdispatch/web typecheck` → clean (exit 0).
- `pnpm build` (`pnpm -r run build`) → **green** (exit 0).
- `pnpm --filter @ustowdispatch/api test` → **225 passed, 0 failed, 376 db-skipped** (`describeIfDb`, no DB in this env). The two reformatted spec files (`tenants-company-profile.spec.ts`, `user-invites-rls.spec.ts`) collect and load cleanly.
- `pnpm test` (full `-r`) → web vitest has **1 failing test, pre-existing and unrelated to this PR** (see below). All other web tests pass (31/32). `pnpm -r` halts further packages on first failure, so the API suite was run separately (above).

### Pre-existing test failure (NOT a regression)

`apps/web/.../offline-queue.spec.ts > offline queue lifecycle > drops applied + skipped entries on a successful replay and keeps failures`

- Root cause: `TypeError: Cannot read properties of undefined (reading 'hostname')` at `apps/web/src/lib/driver/api-client.ts:67` — `window.location` is undefined in the jsdom test env; `replayQueue` reaches `driverApiBase` which reads `window.location.hostname`. A test-env stubbing gap, not a lint issue.
- **Proof it is not caused by this PR:** `offline-queue.ts`, its spec, and its entire import graph (`api-client.ts`, `storage-keys.ts`) are **byte-identical to `origin/master`** (`git diff origin/master` empty for all three). `apps/web/vitest.config.ts` is also unchanged. None are in this PR's 29-file diff. Same files + same config (`environment: 'node'`, no `NEXT_PUBLIC_API_URL`) → identical failure on master.
- **Not CI-gated:** the repo's only workflow is `.github/workflows/e2e.yml` (Playwright). No CI job runs the `apps/web` vitest unit suite, so this failure does not block CI. `api-client.ts:65` early-returns when `NEXT_PUBLIC_API_URL` is set; the crash at `:67` only manifests when that env var is absent (local runs).
- Left as-is per the lint-only constraint. Flagged here for the owner.

## Bugs noticed but NOT fixed (per lint-only constraint)

- The `globals.css` selector bug was fixed because it *was* the lint/parse error (inseparable).
- Pre-existing `offline-queue` test failure (above) — a `window.location` stubbing gap in the driver test env. Out of scope.
