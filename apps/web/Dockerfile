# syntax=docker/dockerfile:1.7
#
# Build context = repo root. Railway service config: "Root Directory" = /,
# "Dockerfile Path" = apps/web/Dockerfile, "Watch Paths" = apps/web/**,
# packages/shared/**, packages/ui/**.
#
# next.config.mjs sets transpilePackages for @ustowdispatch/shared|db|ui so the
# workspace deps don't need a separate compile step — Next bundles them at
# build time.

FROM node:20-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# Manifest layer for cache hits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/

RUN pnpm install --frozen-lockfile

COPY . .

# NEXT_PUBLIC_* env vars are baked at build time. Railway substitutes them
# from the service env at build time when wired with ARG/ENV.
ARG NEXT_PUBLIC_API_URL=https://api.towcommand.cloud
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_MAPBOX_TOKEN=${NEXT_PUBLIC_MAPBOX_TOKEN}

# Verify the value is baked in (logs it during build so we can see it).
RUN echo "BAKED NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}"

RUN pnpm --filter @ustowdispatch/web build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@ustowdispatch/web", "run", "start:prod"]
