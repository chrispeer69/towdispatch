# CLAUDE.md — Operating Rules for Claude Code Sessions in this Repo

You are working in the **US Tow Dispatch** monorepo. This is a **production SaaS** deployed on **Railway** serving real customers. Read this entire file at the start of every session and obey it for the entire session.

> **OPERATOR CONTEXT:** The current operator may be a non-technical founder.
> All guardrails below exist to prevent accidental breakage of production,
> security, git history, or the deployment pipeline. Follow them strictly.

---

## Behavioral Rules — How to Interact with the Operator

### Always ask questions in plain, functional language
- The operator thinks in **business outcomes**, not code.
- ✅ Ask: *"Should the driver see a confirmation screen after accepting a job?"*
- ❌ Don't ask: *"Should I add a React portal with a modal component that dispatches a Redux action?"*
- Frame every question around **what the user/customer experiences**, not what the code does.
- If you need to explain a tradeoff, describe it in terms of what the user will see or what could break — not in framework jargon.

### Stick to the tech stack we already use — no new frameworks or tools
The current stack is locked. Do not introduce alternatives.

| Layer | Technology | Do NOT introduce |
|-------|-----------|-----------------|
| Backend | NestJS + Fastify + Drizzle ORM | Express, Prisma, TypeORM, tRPC |
| Frontend | Next.js (App Router) + React | Remix, Vite SPA, Vue, Svelte |
| Database | PostgreSQL (via Railway) | MongoDB, MySQL, SQLite, Supabase |
| Cache | Redis | Memcached |
| Styling | CSS Modules / Tailwind | styled-components, Emotion, Sass |
| Testing | Vitest + Playwright | Jest, Cypress, Mocha |
| Package manager | pnpm (workspaces) | npm, yarn |
| Deployment | Railway | Vercel, Fly.io, AWS direct |

If a task seems to require a new tool, document the need in TODO.md and move on with what we have.

### Always be backward compatible
- **Never break existing features** to build new ones.
- Every change must work alongside the current production behavior.
- If an API endpoint changes, the old shape must still be accepted (add fields, don't rename or remove them).
- If a database column is added, it must have a default value so existing rows are unaffected.
- If a UI flow changes, existing bookmarks/URLs must still work.
- When in doubt: **add, don't replace**.

---

## Rule 0 — HARD FORBIDDEN ACTIONS (read first)

These actions are **never allowed** regardless of what the user asks. If the user requests one, explain why it is dangerous and refuse.

### Deployment & Infrastructure
- ❌ **Never modify** `apps/api/railway.toml` or `apps/web/railway.toml`
- ❌ **Never modify** `scripts/deploy.sh` or `scripts/railway-start.mjs`
- ❌ **Never modify** `docker-compose.yml` (production database config)
- ❌ **Never modify** `.github/workflows/` CI pipeline files
- ❌ **Never run** `railway deploy`, `railway up`, or any Railway CLI command
- ❌ **Never delete or rename** database migration files in `packages/db/`
- ❌ **Never run** `pnpm --filter @ustowdispatch/db run migrate` against production

### Security & Auth
- ❌ **Never modify** RLS policies, database roles, or tenant isolation logic
- ❌ **Never modify** `apps/api/src/modules/auth/` (authentication system)
- ❌ **Never modify** CSP headers in `apps/web/src/middleware.ts`
- ❌ **Never modify** `.env`, `.env.example`, or any secrets/credentials
- ❌ **Never weaken** password hashing, token expiry, or rate limiting
- ❌ **Never disable** or skip tests, linters, or type-checking
- ❌ **Never commit** API keys, tokens, passwords, or secrets into code

### Git & Version Control
- ❌ **Never commit directly to `master`**. Always use a feature branch.
- ❌ **Never force-push** (`git push --force` / `git push -f`)
- ❌ **Never use `--no-verify`** on `git commit` or `git push` — pre-commit hooks (husky/lint-staged) are safety nets that must always run
- ❌ **Never bypass or disable** pre-commit hooks, husky, or lint-staged
- ❌ **Never rebase or squash** existing commits on shared branches
- ❌ **Never delete** remote branches without explicit instruction
- ❌ **Never run** `git reset --hard` on shared branches

### Dependencies
- ❌ **Never add new npm/pnpm dependencies** without documenting the reason
- ❌ **Never upgrade major versions** of core frameworks (Fastify, NestJS, Next.js, Drizzle)
- ❌ **Never remove** existing dependencies without understanding downstream impact

---

## Rule 1 — TODO.md is a living changelog (MANDATORY)

**Every time you make a code change**, you MUST update `TODO.md` in the repo root.

Format:
```markdown
## Changes Log

### [DATE] — [Short description]
- What was changed and why
- Files modified: `path/to/file.ts`
- Status: ✅ Done / 🟡 Partial / ❌ Blocked

---
(previous entries below)
```

- Prepend new entries at the top (newest first).
- Never delete previous entries.
- Be specific: file paths, what changed, why.
- If a change is reverted, add a new entry noting the revert — don't delete the original.

---

## Rule 2 — Demo workflow: showcase, don't invent

The demo lives at `apps/web/src/app/(demo)/`. It exists to showcase the **real product interface** to investors and prospects.

**Rules for demo work:**
- ✅ Use mock data from `demo/mock-data.ts` to populate existing UI components
- ✅ Wire up navigation, sidebar, and page routing within the demo layout
- ✅ Adjust copy, labels, and sample data to tell a compelling product story
- ❌ **Never create new UI components** for the demo — use the real ones from `apps/web/src/app/(app)/`
- ❌ **Never create demo-only API endpoints** or backend logic
- ❌ **Never duplicate** existing components — import and reuse them
- ❌ **Never add placeholder/lorem-ipsum content** — use realistic tow industry data

If a real component doesn't exist yet for a demo need, note it in TODO.md as a feature request — don't build a fake one.

---

## Rule 3 — Git workflow (simplified for safety)

**Use ONE working branch for all your changes.** Do NOT create a new branch for every feature. Pick a branch name like `founder/working` and keep using it.

```
# FIRST TIME ONLY — create your working branch:
git checkout -b founder/working

# EVERY TIME you make changes:
1. (make your changes)
2. git add .
3. git commit -m "feat: short description"       ← use conventional commits
4. git push origin founder/working
5. Open a Pull Request on GitHub against master (reuse the same PR if one is already open)
6. Wait for CI checks to pass before merging

# AFTER merging your PR — sync back to master and continue:
git checkout master
git pull origin master
git checkout -b founder/working                  ← fresh branch from updated master
```

⚠️ **Do NOT create branches like** `feature/add-button`, `feature/fix-label`, `feature/update-page` for every small change. One branch, many commits.

**Commit message prefixes:**
- `feat:` — new functionality
- `fix:` — bug fix
- `docs:` — documentation only
- `style:` — formatting, no logic change
- `chore:` — maintenance, deps, config

**Before every push**, run:
```bash
pnpm --filter @ustowdispatch/web typecheck    # catches type errors
pnpm --filter @ustowdispatch/web test         # runs unit tests
```

If either command fails, fix the errors before pushing.

---

## Rule 4 — Railway deployment awareness

This app is deployed on **Railway**. Merging to `master` triggers an automatic production deployment.

**What this means:**
- Every merge to master goes live to real customers within minutes
- The `railway.toml` files configure how Railway builds and deploys each service
- Database migrations run automatically via `preDeployCommand` before new code goes live
- If migrations fail, Railway halts the deploy and keeps the old version running

**Do not touch:**
- `apps/api/railway.toml` — API service deployment config
- `apps/web/railway.toml` — Web app deployment config
- `scripts/railway-start.mjs` — Production start script
- `scripts/deploy.sh` — Deploy automation

---

## Rule 5 — Non-negotiable codebase invariants

1. **RLS is sacred.** Every tenant table has FORCE ROW LEVEL SECURITY. App connects as `app_user`. Every request sets `app.current_tenant_id`.
2. **Audit everything.** Trigger-driven `audit_log` on every state-changing table.
3. **Soft delete only.** `deleted_at` everywhere. Never hard delete from app code.
4. **UUIDv7 only.** Never serial IDs.
5. **No `any` in TypeScript.** Strict mode. `exactOptionalPropertyTypes: true`.
6. **All external API calls are observable.** Idempotency keys on writes. PII redacted from logs.
7. **Branch-then-PR workflow.** Never commit directly to master.

---

## Rule 6 — Conventions for new code

- TypeScript: match imports + headers of neighbors. Zod for validation. Use existing error codes in `packages/shared/src/constants/error-codes.ts`.
- Spanish parity: every user-visible string in BOTH en + es. Mark uncertain with `// TODO(i18n)`.
- Tests required for every new feature. Match the existing framework.
- No new external dependencies unless required. Document any addition in TODO.md.

---

## Rule 7 — Read these before writing code

1. `ARCHITECTURE.md` — non-negotiable invariants (RLS, audit, soft delete, UUIDv7)
2. `BUILD_DECISIONS.md` — past decision log
3. `MOAT_LIST.md` — strategic context
4. Any `SESSION_*_REPORT.md` in the area you're working in
5. The relevant `README.md` for the subdir you're modifying

---

## Rule 8 — Communication style

- Short. Bulleted. No novellas.
- No preamble. No "Great question!" No "I'll help you with that!"
- Lead with the answer or the action.
- If something is blocked or risky, say so plainly.

---

## Rule 9 — Production-readiness defaults

- Production-ready solution, not minimal demo.
- Offline-safe path on driver-app code.
- Tenant-isolated path on backend.
- Accessible path on UI (keyboard, screen reader, contrast).
- UTC in DB, local time only in presentation.

---

## Rule 10 — When in doubt, mirror

If a feature exists on another platform (web vs iOS vs Android), read the existing implementation first. Mirror its contract.

Contract sources of truth, in order:
1. Backend endpoint in `apps/api/src/modules/`
2. Zod schema in `packages/shared/src/schemas/`
3. Web client in `apps/web/src/lib/`
4. iOS or Android implementation (whichever shipped first)

---

## Rule 11 — Definition of done

Done when: code compiles + type-checks + lints clean, tests pass, branch pushed, PR opened, TODO.md updated.

NOT done when: tests are failing, you've skipped type-checking, or TODO.md wasn't updated.
