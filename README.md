# TowCommand Pro

The operating system for the modern towing industry.

A multi-tenant SaaS platform built to serve 10,000+ towing companies and 100M+ dispatched jobs per year.

---

## Quickstart

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+ (`corepack enable && corepack prepare pnpm@9.12.3 --activate`)
- **Docker Desktop** (for Postgres + Redis + Mailhog)

### 1. Install

```bash
pnpm install
cp .env.example .env
cp .env.example apps/api/.env
cp .env.example apps/web/.env.local
```

### 2. Start infrastructure

```bash
docker compose up -d
```

This starts:

- Postgres 16 + PostGIS on `:5432`
- Redis 7 on `:6379`
- Mailhog UI on `:8025` (SMTP `:1025`)

### 3. Database setup

```bash
pnpm db:migrate     # runs Drizzle schema migrations + raw SQL files (extensions, roles, RLS, audit)
pnpm db:seed        # creates 2 test tenants and 6 users
```

### 4. Run the dev servers

```bash
pnpm dev
```

- API: <http://localhost:3001>
- Web: <http://localhost:3000>
- Health: <http://localhost:3001/health>
- Ready: <http://localhost:3001/ready>

### 5. Verify RLS

```bash
pnpm --filter @towcommand/api test test/integration/rls.spec.ts
```

This runs the cross-tenant integrity test that gates every release.

---

## Repo layout

```
towcommand/
├── apps/
│   ├── api/        NestJS + Fastify backend
│   └── web/        Next.js 15 frontend
├── packages/
│   ├── db/         Drizzle schema + raw SQL (RLS, roles, audit triggers)
│   ├── shared/     Zod schemas, types, constants
│   └── ui/         Shared React components (placeholder)
├── docker-compose.yml
└── ARCHITECTURE.md
```

---

## Development scripts

| Command            | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `pnpm dev`         | Run API and Web in parallel                              |
| `pnpm build`       | Build everything                                         |
| `pnpm typecheck`   | Type-check every workspace                               |
| `pnpm lint`        | Biome lint                                               |
| `pnpm format`      | Biome format                                             |
| `pnpm test`        | Run unit + integration tests across packages             |
| `pnpm test:e2e`    | Playwright e2e (web)                                     |
| `pnpm db:generate` | Generate a new Drizzle migration                         |
| `pnpm db:migrate`  | Apply migrations + raw SQL                               |
| `pnpm db:seed`     | Idempotent seed                                          |
| `pnpm db:studio`   | Open Drizzle Studio                                      |
| `pnpm db:reset`    | Drop and recreate the database (dev only)                |

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full set of decisions and invariants.

The non-negotiables:

1. **RLS is sacred.** Every tenant table has `FORCE ROW LEVEL SECURITY`. The app connects as a non-superuser; per-request transactions `SET LOCAL app.current_tenant_id`.
2. **Audit everything.** Trigger-driven `audit_log` capturing before/after state.
3. **Soft delete only.** `deleted_at` everywhere. Hard purge is a separate scheduled job.
4. **UUIDv7 only.** Sortable, indexable, no exposing internal counts.
5. **No `any`.** Strict TypeScript, exact optional property types.
6. **All external calls are observable.** Idempotency keys on writes.

---

## License

Proprietary — © TowCommand, Inc.
