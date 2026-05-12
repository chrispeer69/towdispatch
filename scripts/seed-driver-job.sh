#!/usr/bin/env bash
# Seed a single driver job against a running TowCommand backend so the iOS /
# Android driver apps can exercise the full lifecycle.
#
# Prereqs:
#   - Backend running on $API_URL (default http://localhost:3001)
#   - A driver user exists; pass DRIVER_EMAIL / DRIVER_PASSWORD env vars
#   - Backend has the test tenant seeded (see apps/api docs)
#
# Usage:
#   DRIVER_EMAIL=driver@demo.test DRIVER_PASSWORD=password ./scripts/seed-driver-job.sh

set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
DRIVER_EMAIL="${DRIVER_EMAIL:-driver@demo.test}"
DRIVER_PASSWORD="${DRIVER_PASSWORD:-password}"

echo "→ Logging in as $DRIVER_EMAIL on $API_URL"
LOGIN_RESPONSE=$(curl -fsS -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DRIVER_EMAIL\",\"password\":\"$DRIVER_PASSWORD\"}")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c 'import sys, json; print(json.load(sys.stdin)["accessToken"])')
echo "  ✓ got access token"

echo "→ Creating a test job"
# The dispatch creation endpoint, schema, and tenant requirements vary by
# build. This script POSTs the most permissive shape the backend currently
# accepts. If the route returns 4xx, adjust the payload to match your
# `apps/api/src/modules/dispatch/...` controllers.
JOB_PAYLOAD=$(cat <<'JSON'
{
  "serviceType": "tow_light_duty",
  "pickupAddress": "123 Main St, Sample City",
  "pickupLat": 30.2672,
  "pickupLng": -97.7431,
  "dropoffAddress": "555 Industrial Way, Sample City",
  "dropoffLat": 30.2820,
  "dropoffLng": -97.7510,
  "authorizedBy": "test-script",
  "rateQuotedCents": 12500
}
JSON
)

CREATE_RESPONSE=$(curl -fsS -X POST "$API_URL/dispatch/jobs" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$JOB_PAYLOAD")

echo "  ✓ created"
echo "$CREATE_RESPONSE" | python3 -m json.tool

echo "→ Done. Open the iOS driver app and pull-to-refresh the Queue tab."
