#!/usr/bin/env bash
# Verify the new ECOSYSTEM section + 3 placeholder pages.
set -uo pipefail

WEB="http://localhost:3000"
JAR=$(mktemp)
slug() { date +%s | sha1sum | head -c 8; }
SUFFIX="eco-$(slug)"
EMAIL="owner-$SUFFIX@eco.test"
PW="CorrectHorse-Battery-9!"

emit() { echo "[eco] $*"; }

# Sign up + collect cookies.
curl -sS -c "$JAR" -X POST "$WEB/api/auth/signup" \
  -H "content-type: application/json" \
  --data "{\"tenantName\":\"Eco $SUFFIX\",\"tenantSlug\":\"$SUFFIX\",\"ownerName\":\"Owner\",\"ownerEmail\":\"$EMAIL\",\"password\":\"$PW\"}" \
  > /dev/null

# Sidebar must show Ecosystem section + the three brand tabs.
DASH=$(curl -sS -L -b "$JAR" "$WEB/dashboard")
echo "$DASH" | grep -q ">Ecosystem<" && echo "ECO_SECTION=PASS" || echo "ECO_SECTION=FAIL"
echo "$DASH" | grep -q ">CONVINI<" && echo "ECO_TAB_CONVINI=PASS" || echo "ECO_TAB_CONVINI=FAIL"
echo "$DASH" | grep -q ">FleetCommand<" && echo "ECO_TAB_FC=PASS" || echo "ECO_TAB_FC=FAIL"
echo "$DASH" | grep -q ">FleetGuard Pro<" && echo "ECO_TAB_FG=PASS" || echo "ECO_TAB_FG=FAIL"
echo "$DASH" | grep -q '/ecosystem/convini' && echo "ECO_HREF_CONVINI=PASS" || echo "ECO_HREF_CONVINI=FAIL"
echo "$DASH" | grep -q '/ecosystem/fleetcommand' && echo "ECO_HREF_FC=PASS" || echo "ECO_HREF_FC=FAIL"
echo "$DASH" | grep -q '/ecosystem/fleetguard' && echo "ECO_HREF_FG=PASS" || echo "ECO_HREF_FG=FAIL"

# Each placeholder page renders.
for slug in convini fleetcommand fleetguard; do
  STATUS=$(curl -sS -L -o /tmp/eco-$slug.html -b "$JAR" -w "%{http_code}" "$WEB/ecosystem/$slug")
  emit "/ecosystem/$slug → $STATUS"
done

# Page-content checks.
grep -q "CONVINI is the consumer-facing platform" /tmp/eco-convini.html && \
  echo "CONVINI_TEXT=PASS" || echo "CONVINI_TEXT=FAIL"
grep -q "Blue Collar AI ecosystem product" /tmp/eco-convini.html && \
  echo "CONVINI_SUB=PASS" || echo "CONVINI_SUB=FAIL"
grep -q "color:#0F9D58" /tmp/eco-convini.html && \
  echo "CONVINI_ACCENT=PASS" || echo "CONVINI_ACCENT=FAIL"

grep -q "FleetCommand is the GPS, telematics, and AI dashcam" /tmp/eco-fleetcommand.html && \
  echo "FC_TEXT=PASS" || echo "FC_TEXT=FAIL"
grep -q "color:#1E88E5" /tmp/eco-fleetcommand.html && \
  echo "FC_ACCENT=PASS" || echo "FC_ACCENT=FAIL"

grep -q "FleetGuard Pro is the insurance and risk-management" /tmp/eco-fleetguard.html && \
  echo "FG_TEXT=PASS" || echo "FG_TEXT=FAIL"
grep -q "color:#F59E0B" /tmp/eco-fleetguard.html && \
  echo "FG_ACCENT=PASS" || echo "FG_ACCENT=FAIL"

# Active-state highlight when on the convini page should use the brand color.
grep -q "background-color:#0F9D5826" /tmp/eco-convini.html && \
  echo "CONVINI_ACTIVE_BG=PASS" || echo "CONVINI_ACTIVE_BG=FAIL"

# Dashboard remains intact (regression guard).
echo "$DASH" | grep -q "Operations Overview" && echo "DASH_INTACT=PASS" || echo "DASH_INTACT=FAIL"

echo "ALL DONE"
