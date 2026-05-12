#!/usr/bin/env bash
# Warns if required env vars are missing from the current shell environment.
# Source of truth: .env.example at repo root.
#
# Run: scripts/check-env.sh
# Exit codes:
#   0 — every required key is set (or has a default in .env.example)
#   1 — at least one required key is missing AND lacks a default

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_EXAMPLE="$REPO_ROOT/.env.example"

if [[ ! -f "$ENV_EXAMPLE" ]]; then
  echo "::error::$ENV_EXAMPLE not found" >&2
  exit 1
fi

# Keys that are REQUIRED in production (no safe placeholder default).
# Everything else is optional or has a development default that's fine.
required_in_prod=(
  DATABASE_URL
  DATABASE_ADMIN_URL
  REDIS_URL
  JWT_ACCESS_SECRET
  JWT_REFRESH_SECRET
  JWT_MFA_SECRET
  TOTP_ENCRYPTION_KEY
  API_PORT
  API_HOST
  API_PUBLIC_URL
  WEB_PUBLIC_URL
  CORS_ORIGINS
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
)

# Keys that, if missing, *should* fall through to safe defaults but are worth
# warning about so production isn't accidentally running with dev placeholders.
warn_if_dev_default=(
  JWT_ACCESS_SECRET
  JWT_REFRESH_SECRET
  JWT_MFA_SECRET
  TOTP_ENCRYPTION_KEY
  SENTRY_DSN
)

errors=0
warnings=0

is_set() {
  local key="$1"
  local val="${!key:-}"
  [[ -n "$val" ]]
}

is_dev_default() {
  local key="$1"
  local val="${!key:-}"
  case "$val" in
    *change-me-*|*test-*|*placeholder*|*dev_pw|*localhost*) return 0 ;;
    *) return 1 ;;
  esac
}

env_target="${NODE_ENV:-development}"
echo "[check-env] target environment: $env_target"

# Pull the set of keys defined in .env.example (lines like KEY=value;
# ignore comments + blank lines).
declare -a example_keys
while IFS='=' read -r key _rest; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  example_keys+=("$key")
done < "$ENV_EXAMPLE"
echo "[check-env] .env.example defines ${#example_keys[@]} keys"

# 1. Every required-in-prod key must appear in .env.example AND be set in prod.
for key in "${required_in_prod[@]}"; do
  if ! printf '%s\n' "${example_keys[@]}" | grep -qx "$key"; then
    echo "::error::$key is required but missing from .env.example" >&2
    errors=$((errors + 1))
    continue
  fi
  if [[ "$env_target" == "production" ]]; then
    if ! is_set "$key"; then
      echo "::error::$key not set in environment (required in production)" >&2
      errors=$((errors + 1))
    fi
  fi
done

# 2. Warn if a secret is set to its dev default in production.
if [[ "$env_target" == "production" ]]; then
  for key in "${warn_if_dev_default[@]}"; do
    if is_set "$key" && is_dev_default "$key"; then
      echo "::warning::$key looks like a dev/placeholder value — rotate before production traffic" >&2
      warnings=$((warnings + 1))
    fi
  done
fi

# 3. Every key referenced in apps/api/src/config/config.schema.ts should be in .env.example.
if [[ -f "$REPO_ROOT/apps/api/src/config/config.schema.ts" ]]; then
  config_keys="$(grep -oE '^[[:space:]]+([A-Z][A-Z0-9_]+):' "$REPO_ROOT/apps/api/src/config/config.schema.ts" | awk -F: '{gsub(/[[:space:]]/, ""); print $1}' | sort -u)"
  while IFS= read -r ck; do
    [[ -z "$ck" ]] && continue
    if ! printf '%s\n' "${example_keys[@]}" | grep -qx "$ck"; then
      echo "::warning::config.schema.ts references $ck but .env.example does not document it" >&2
      warnings=$((warnings + 1))
    fi
  done <<< "$config_keys"
fi

echo "[check-env] $warnings warning(s), $errors error(s)"
exit $(( errors > 0 ? 1 : 0 ))
