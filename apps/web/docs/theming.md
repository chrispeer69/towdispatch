# Theming — light, dark, and system

This document covers the theme system in `apps/web`: tokens, the toggle
component, and the known gap between the foundation (which works in
both themes today) and the existing UI (most of which still bakes the
dark anchor into class names like `text-text-primary-on-dark` and
`bg-bg-base`).

## TL;DR

- The toggle lives top-right of every header surface (app shell topbar,
  auth shell header, landing page header). It offers Light, Dark, and
  System.
- `next-themes` runs with `attribute="class"`, `defaultTheme="system"`,
  `enableSystem`, `disableTransitionOnChange`.
- An inline anti-flash script in `<head>` applies `.dark` to `<html>`
  before React hydrates.
- Tailwind utilities backed by shadcn-style tokens (`bg-background`,
  `text-foreground`, `bg-card`, `border-border`, `bg-primary`, …) flip
  correctly under `.dark`. New components should consume these.
- Most of the existing dispatcher UI is wired to dark-anchored tokens
  (`bg-bg-base`, `text-text-primary-on-dark`, `border-divider`). These
  do **not** flip and will continue to render the dark stack regardless
  of theme. Renaming them is the follow-up sweep described in
  [Known gaps](#known-gaps).

## Token map

Values are HSL channels (no `hsl()` wrapper); Tailwind composes them via
`hsl(var(--token) / <alpha-value>)`.

### Brand & status (stable across themes)

| Token | Value | Hex |
|---|---|---|
| `--brand-primary` | `217 76% 44%` | `#1A56C4` (TowGrade royal blue) |
| `--brand-primary-hover` | `217 76% 39%` | `#174DB0` |
| `--brand-primary-text` | `0 0% 100%` | `#FFFFFF` |
| `--status-success` | `160 84% 39%` | `#10B981` |
| `--status-warning` | `38 92% 50%` | `#F59E0B` |
| `--status-danger` | `0 84% 60%` | `#EF4444` |

Brand is **royal blue, not orange**. The codebase aligned to the
TowGrade palette in a prior PR; that decision stands. The legacy
`--orange` token (`#F05A1A`) remains in `globals.css` so older
components that still import it keep compiling, but the brand utility
`bg-brand-primary` resolves to royal blue.

### shadcn semantic tokens (flip per theme)

| Token | `:root` (light) | `.dark` |
|---|---|---|
| `--background` | `#FFFFFF` | `#0E1117` (via `--bg-base`) |
| `--foreground` | `#0F172A` | `#F1F5F9` (via `--text-primary-on-dark`) |
| `--card` | `#FFFFFF` | `#1C2333` (via `--bg-surface`) |
| `--card-foreground` | `#0F172A` | `#F1F5F9` |
| `--popover` | `#FFFFFF` | `#1C2333` |
| `--popover-foreground` | `#0F172A` | `#F1F5F9` |
| `--primary` | `#1A56C4` | `#1A56C4` (stable) |
| `--primary-foreground` | `#FFFFFF` | `#FFFFFF` |
| `--secondary` | `#F1F5F9` | `#1C2333` |
| `--secondary-foreground` | `#0F172A` | `#F1F5F9` |
| `--muted` | `#F1F5F9` | `#1C2333` |
| `--muted-foreground` | `#64748B` | `#94A3B8` |
| `--accent` | `#F1F5F9` | `#384156` (via `--bg-surface-elevated`) |
| `--accent-foreground` | `#0F172A` | `#F1F5F9` |
| `--destructive` | `#EF4444` | `#EF4444` (stable) |
| `--destructive-foreground` | `#FFFFFF` | `#FFFFFF` |
| `--border` | `#E2E8F0` | `#2A334D` (`224 26% 22%`) |
| `--input` | `#E2E8F0` | `#2A334D` |
| `--ring` | `#1A56C4` | `#1A56C4` (stable) |

### Dark-stack role tokens (do **not** flip)

These are the values utilities like `bg-bg-base` and
`text-text-primary-on-dark` consume. They are baked dark because the
class names themselves encode the dark assumption (`-on-dark` is
literally in the name). They are unchanged in `.dark`.

| Token | Value | Hex |
|---|---|---|
| `--bg-base` | `222 25% 7%` | `#0E1117` |
| `--bg-surface` | `224 26% 15%` | `#1C2333` |
| `--bg-surface-elevated` | `225 21% 23%` | (one step lighter) |
| `--bg-divider` | `225 21% 29%` | divider line |
| `--bg-divider-strong` | `225 21% 37%` | divider hover |
| `--text-primary-on-dark` | `210 40% 96%` | `#F1F5F9` |
| `--text-secondary-on-dark` | `215 20% 65%` | `#94A3B8` |
| `--text-primary-on-light` | `222 47% 11%` | `#0F172A` |
| `--text-secondary-on-light` | `215 25% 27%` | `#475569` |

### Legacy hue-named tokens (preserved verbatim)

`--orange`, `--steel`, `--text-primary`, `--text-secondary`,
`--text-muted`, `--green`, `--yellow`, `--red`, `--blue`, `--purple`,
plus the `--orange-glow*` and `--grid-stroke-rgba` decorative tokens.
These are kept so existing component code that references `bg-orange`,
`bg-steel`, `text-text-primary`, etc. keeps compiling. The `--steel-*`
and `--text-*` groups DO flip under `.dark` (this pre-dated the
shadcn-token rewire and is left intact).

## Toggle component

`apps/web/src/components/ui/theme-toggle.tsx`.

- Trigger: 44 × 44px (touch target), `lucide-react` Sun (light) or Moon
  (dark) icon. The icon shown reflects the **resolved** theme so a user
  on System sees the OS-matched glyph.
- Menu: shadcn `DropdownMenu` (Radix-backed wrapper at
  `apps/web/src/components/ui/dropdown-menu.tsx`). Three items: Light /
  Dark / System with a `Check` glyph beside the currently-selected
  option. Keyboard accessible by virtue of Radix.
- `aria-label="Toggle theme"` on the trigger; the trigger also carries
  `title="Toggle theme"` for hover feedback.
- Hydration safety: renders a same-size placeholder pre-mount so the
  topbar layout doesn't jump.

### Mount points

The toggle is already mounted in three places (no further wiring needed
for this PR):

| Surface | File | Position |
|---|---|---|
| Authenticated app topbar | `apps/web/src/components/app-shell/topbar.tsx` | Right cluster, immediately left of Help / Notifications / user badge |
| Public auth shell (login / signup / forgot / reset / mfa / verify-email) | `apps/web/src/components/auth/auth-shell.tsx` | Header right |
| Marketing landing | `apps/web/src/app/page.tsx` | Header right |

## Anti-flash script

`apps/web/src/app/layout.tsx` injects a synchronous inline `<script>` in
`<head>` that runs before React hydrates. It:

1. Reads `localStorage.theme` (set by `next-themes`).
2. If unset or `'system'`, falls back to `prefers-color-scheme`.
3. Applies `.dark` to `<html>` if the resolved value is dark.
4. Sets `document.documentElement.style.colorScheme` so native form
   controls (scrollbars, date pickers, etc.) match.

The script is wrapped in `try/catch` because storage access throws in
some private-browsing modes; on failure it falls back to dark, which
matches the previous app default.

`<html>` carries `suppressHydrationWarning` so React doesn't complain
about the class mismatch between server render and the post-script
client DOM.

## Known gaps

The foundation is two-theme-ready, but most of the existing dispatcher
UI is wired to dark-anchored tokens. Switching to Light today will
flip the body chrome (`bg-background` → white, `text-foreground` →
near-black) and any new shadcn primitives — but it will not flip
existing cards, sidebars, or topbars that explicitly reference the
dark stack.

### Files most coupled to the dark anchor

Each of these uses one or more dark-baked token utilities throughout.
A theme-correct migration requires renaming the class itself (or
introducing theme-aware aliases that swap based on `.dark`); a value
change alone is insufficient because the class name encodes the
assumption.

- `apps/web/src/components/app-shell/sidebar.tsx` — top sidebar:
  `bg-bg-surface`, `border-divider`, `text-text-primary-on-dark`,
  `text-text-secondary-on-dark`, `hover:bg-bg-surface-elevated`. Carries
  the pre-existing `text-text-secondary-on-dark-on-dark` typo — left
  in place; out of scope for this PR.
- `apps/web/src/components/app-shell/topbar.tsx` — same suffix family.
  Carries the same typo.
- `apps/web/src/app/(app)/layout.tsx` — body class
  `bg-bg-base text-text-primary-on-dark`. Wraps every authenticated
  route, so until this layout is theme-aware, Light mode leaves the
  app shell dark even with the toggle switched.
- Every `(app)/**` page: most use `bg-bg-surface`,
  `border-divider`, `text-text-primary-on-dark`. Examples — `dispatch`,
  `intake`, `jobs`, `billing`, `customers`, `accounts`, `fleet`,
  `accounting`, the new `settings` shell, and the ecosystem
  placeholders.
- `apps/web/src/app/track/[token]/track-client.tsx` — public tracking
  page. Intentionally dark-themed with white-alpha overlays
  (`bg-white/10`, `bg-white/20`) over a tenant-branded hero. Left as
  dark-only; the public tracking page is not in scope for the
  Light/Dark toggle today.
- `apps/web/src/app/auth/mfa/enroll/enroll-client.tsx` — contains one
  literal `bg-white` for the TOTP QR code background. Intentional —
  QR scanners require a white background. Leave as-is.

### Recommended follow-up

A subsequent PR should:

1. Audit the `(app)` layout and topbar/sidebar. Either:
   (a) rename the utilities they use to the shadcn-token equivalents
   (`bg-card`, `text-foreground`, `border-border`), letting them flip
   per theme; or
   (b) introduce per-theme aliases that swap under `.dark`.
2. Fix the `text-text-secondary-on-dark-on-dark` typo at the same
   time (it currently silently resolves to no color, since the class
   doesn't exist in the Tailwind config).
3. Sweep every `(app)/**` page; the rewrite is mechanical (`-on-dark`
   → drop the suffix, `bg-bg-base` → `bg-background`, etc.) but it is
   touching many files and warrants its own review.

### Why ship the foundation alone

- The toggle, anti-flash, provider, and token system are independently
  useful: new components (shadcn primitives, the Settings shell
  follow-up, anything built fresh) will be theme-correct out of the
  box.
- A one-PR rename of the entire `(app)` tree is high-risk without
  parallel local-dev verification of every page; ships better as a
  follow-up so each affected surface can be browser-checked.
- The user explicitly directed the brand color to **stay royal blue**
  (TowGrade alignment). That decision is locked in here so the
  follow-up sweep has a stable target.

## Verification

This PR was verified at the build level (typecheck + Next.js build +
biome). It was **not** verified in a running browser; the
authenticated app shell needs the local NestJS API + Postgres running,
which is out of scope for a foundation-only PR. The new shadcn
primitives + the rewired tokens compile cleanly and resolve correctly
in the build output; visual confirmation across both themes is the
first job of the follow-up sweep.
