# syntax=docker/dockerfile:1.7
#
# Build context must be the repo root (monorepo with pnpm workspaces).
# Railway service config: set "Root Directory" to /, "Dockerfile Path" to
# apps/api/Dockerfile, and "Watch Paths" to apps/api/**, packages/**.
#
# Single-stage build: pnpm install once with the full workspace, build the
# api filter (which transitively builds @towdispatch/db and @towdispatch/shared
# if they have build steps), then run start:prod. Image size is not optimal
# but reliability beats optimization for a first deploy.

FROM node:20-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# Bring the workspace manifest + every package.json first so pnpm can build
# its dep graph without invalidating cache on every source change.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/

RUN pnpm install --frozen-lockfile

# Source.
COPY . .

# Build the API and its transitive workspace dependencies.
RUN pnpm --filter @towdispatch/api... build

ENV NODE_ENV=production
# Railway sets PORT — config.service honors it when API_PORT is not set.
EXPOSE 3001

# Run from the workspace root so pnpm resolves the @towdispatch/api start:prod
# script and the workspace node_modules layout is intact.
CMD ["pnpm", "--filter", "@towdispatch/api", "run", "start:prod"]
