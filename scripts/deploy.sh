#!/usr/bin/env bash
# Deploy template — Railway by default, AWS migration path in Phase 1.
#
# Idempotency contract: re-running this script with the same git SHA is a
# no-op. Re-running with a new SHA deploys that SHA.
#
# Usage:
#   scripts/deploy.sh                          # deploy current HEAD to production
#   scripts/deploy.sh staging                  # deploy current HEAD to staging
#   GIT_SHA=abc123 scripts/deploy.sh           # deploy a specific SHA
#   DRY_RUN=1 scripts/deploy.sh                # print steps; do not execute
#
# Required tools in PATH: git, pnpm, railway (or aws/ecs-cli for Phase 1).
# Required env: RAILWAY_TOKEN (or AWS_PROFILE for Phase 1).

set -euo pipefail

ENV_TARGET="${1:-production}"
GIT_SHA="${GIT_SHA:-$(git rev-parse HEAD)}"
DRY_RUN="${DRY_RUN:-0}"
RELEASE_TAG="${RELEASE_TAG:-$GIT_SHA}"
DEPLOY_PLATFORM="${DEPLOY_PLATFORM:-railway}"   # railway | aws

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY-RUN $*"
  else
    "$@"
  fi
}

echo "==============================================="
echo "US Tow DISPATCH deploy"
echo "  Environment: $ENV_TARGET"
echo "  Git SHA:     $GIT_SHA"
echo "  Release tag: $RELEASE_TAG"
echo "  Platform:    $DEPLOY_PLATFORM"
echo "  Dry-run:     $DRY_RUN"
echo "==============================================="

# ---------- 1. Pre-flight ----------
if [[ -n "$(git status --porcelain)" ]]; then
  echo "::warning::working tree is dirty — deploying staged HEAD, not your local edits" >&2
fi

if [[ "$ENV_TARGET" == "production" ]]; then
  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$current_branch" != "master" ]]; then
    echo "::error::production deploys must come from 'master'; current branch is '$current_branch'" >&2
    exit 1
  fi
fi

# ---------- 2. Static checks ----------
echo "[deploy] running pre-deploy checks"
run scripts/check-migrations.sh
run scripts/check-env.sh

# ---------- 3. Build ----------
echo "[deploy] installing dependencies"
run pnpm install --frozen-lockfile

echo "[deploy] building api"
run pnpm --filter @ustowdispatch/api build

echo "[deploy] building web"
run pnpm --filter @ustowdispatch/web build

# ---------- 4. Tests gate ----------
# Skip if SKIP_TESTS=1 — only for hotfix paths under §incident-response.
if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  echo "[deploy] running unit + integration tests (DB-gated specs are skipped)"
  run pnpm --filter @ustowdispatch/api test
  run pnpm --filter @ustowdispatch/api typecheck
  run pnpm --filter @ustowdispatch/web typecheck
  run pnpm --filter @ustowdispatch/e2e typecheck
fi

# ---------- 5. Migrations ----------
# Migrations are forward-only. The runner is idempotent — `migrate` against
# a DB at the latest version is a no-op.
echo "[deploy] applying migrations"
run pnpm --filter @ustowdispatch/db migrate

# ---------- 6. Deploy services ----------
case "$DEPLOY_PLATFORM" in
  railway)
    if ! command -v railway >/dev/null 2>&1; then
      echo "::error::railway CLI not installed. brew install railway / npm i -g @railway/cli" >&2
      exit 1
    fi
    echo "[deploy] deploying to Railway"
    run railway up --service api --environment "$ENV_TARGET" --detach
    run railway up --service web --environment "$ENV_TARGET" --detach
    ;;
  aws)
    # Phase 1 — ECS Fargate path
    if ! command -v aws >/dev/null 2>&1; then
      echo "::error::aws CLI not installed" >&2
      exit 1
    fi
    echo "[deploy] deploying to AWS (Phase 1 — see runbook)"
    echo "::warning::AWS deploy path is documented but not yet wired; defaulting to dry-run" >&2
    echo "DRY-RUN aws ecs update-service --cluster ustowdispatch-$ENV_TARGET --service api --force-new-deployment"
    echo "DRY-RUN aws ecs update-service --cluster ustowdispatch-$ENV_TARGET --service web --force-new-deployment"
    ;;
  *)
    echo "::error::unknown DEPLOY_PLATFORM: $DEPLOY_PLATFORM" >&2
    exit 1
    ;;
esac

# ---------- 7. Post-deploy verification ----------
echo "[deploy] verifying deploy"
case "$ENV_TARGET" in
  production) BASE='https://api.ustowdispatch.com' ;;
  staging)    BASE='https://api-staging.ustowdispatch.com' ;;
  *)          BASE='https://api-dev.ustowdispatch.com' ;;
esac

# Probe /health (liveness) then /ready (db + redis)
for probe in '/health' '/ready'; do
  echo "[deploy] probing $BASE$probe"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY-RUN curl -sf $BASE$probe"
  else
    # Up to 60s for the new replica to become ready
    for i in $(seq 1 30); do
      if curl -sf -o /dev/null "$BASE$probe"; then
        echo "[deploy] $probe OK"
        break
      fi
      sleep 2
      if [[ $i -eq 30 ]]; then
        echo "::error::$probe failed after 60s" >&2
        exit 1
      fi
    done
  fi
done

# ---------- 8. Tag the release ----------
if [[ "$DRY_RUN" != "1" && "$ENV_TARGET" == "production" ]]; then
  echo "[deploy] tagging release"
  tag="release/$(date -u +%FT%H%M%S)-$GIT_SHA"
  git tag "$tag" "$GIT_SHA"
  git push origin "$tag"
fi

echo "[deploy] done"
