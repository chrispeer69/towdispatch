# Theming — light, dark, and system

This document covers the theme system in `apps/web`: tokens, the toggle
component, and the per-theme value flips that make the existing
class names (`bg-bg-base`, `text-text-primary-on-dark`, `border-divider`,
…) render correctly in both themes today.

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
- **The dispatcher role tokens (`--bg-base`, `--bg-surface`, …,
  `--text-primary-on-dark`, `--text-secondary-on-dark`,
  `--bg-divider*`) also flip per theme.** `:root` holds the light
  values; `.dark` restores the original dark values. So existing
  utility classes (`bg-bg-base`, `text-text-primary-on-dark`,
  `border-divider`) work in both themes without renaming the 600+
  call sites. The `-on-dark` suffix in the token name is historical;
  the value flips to remain readable against whichever theme is
  active.

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

### Dispatcher role tokens (flip per theme)

The 600+ call sites of `bg-bg-base`, `bg-bg-surface`,
`text-text-primary-on-dark`, `text-text-secondary-on-dark`, and
`border-divider*` all read these tokens. They flip under `.dark` so
the existing utility classes render correctly in both themes without
renaming the call sites. The `-on-dark` suffix is historical and is
no longer accurate in light mode; the semantic is now "primary /
secondary text colour for the current theme."

| Token | `:root` (light) | `.dark` |
|---|---|---|
| `--bg-base` | `#F8FAFC` (`210 40% 98%`) page background | `#0E1117` (`222 25% 7%`) |
| `--bg-surface` | `#FFFFFF` (`0 0% 100%`) sidebar / topbar / cards | `#1C2333` (`224 26% 15%`) |
| `--bg-surface-elevated` | `#F1F5F9` (`210 40% 96%`) hover | `225 21% 23%` |
| `--bg-divider` | `#E2E8F0` (`214 32% 91%`) | `225 21% 29%` |
| `--bg-divider-strong` | `#CBD5E1` (`215 25% 80%`) | `225 21% 37%` |
| `--text-primary-on-dark` | `#0F172A` (`222 47% 11%`) | `#F1F5F9` (`210 40% 96%`) |
| `--text-secondary-on-dark` | `#64748B` (`215 16% 47%`) | `#94A3B8` (`215 20% 65%`) |

`--text-primary-on-light` and `--text-secondary-on-light` stay dark
text across both themes (they're for fixed-light surfaces — currently
unused but preserved for the marketing/landing hero).

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

## Known carve-outs

A small number of surfaces are intentionally not theme-aware — they
need to look the same regardless of toggle state.

- `apps/web/src/app/track/[token]/track-client.tsx` — public tracking
  page. Dark-themed with white-alpha overlays (`bg-white/10`,
  `bg-white/20`) over a tenant-branded hero. The page sets its own
  background colour from the tenant accent and stays dark regardless
  of the user toggle.
- `apps/web/src/app/auth/mfa/enroll/enroll-client.tsx` — contains one
  literal `bg-white` for the TOTP QR code background. Intentional —
  QR scanners require a white background.

## Backlog

1. **`text-text-secondary-on-dark-on-dark` typo** in
   `apps/web/src/components/app-shell/sidebar.tsx` and
   `apps/web/src/components/app-shell/topbar.tsx`. The suffix is
   doubled. The class doesn't exist in the Tailwind config so it
   silently resolves to no colour. Pre-existing; not fixed here.
2. **Rename the role tokens** to drop the `-on-dark` suffix. The
   value flip in `globals.css` makes the existing classes render
   correctly in both themes, but the name `text-text-primary-on-dark`
   is now misleading (it's just "primary text"). A find-and-replace
   sweep can rename to `text-foreground` (shadcn) or
   `text-text-primary` (dropping the suffix), but it touches ~600
   call sites and warrants its own PR.
3. **`. {` malformed selector** in `globals.css` line ~195. Looks
   like the class name was stripped, leaving a bare dot. Biome flags
   it on direct CSS parse, but lint-staged scopes only to
   TS/TSX/JS/JSX/JSON/MD so commits don't fail on it. Pre-existing.

## Verification

This PR was verified at the build level (typecheck + Next.js build +
biome). It was **not** verified in a running browser; the
authenticated app shell needs the local NestJS API + Postgres running,
which is out of scope for a foundation-only PR. The new shadcn
primitives + the rewired tokens compile cleanly and resolve correctly
in the build output; visual confirmation across both themes is the
first job of the follow-up sweep.
