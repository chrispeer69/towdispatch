#!/usr/bin/env bash
# Consolidated 3.5 + corrections verification.
set -uo pipefail

API="http://localhost:3001"
WEB="http://localhost:3000"

slug() { date +%s | sha1sum | head -c 8; }
SUFFIX="vrf35-$(slug)"
EMAIL="owner-$SUFFIX@vrf35.test"
PW="CorrectHorse-Battery-9!"
JAR=$(mktemp)

emit() { echo "[35] $*"; }
fail() { echo "[35] FAIL: $*" >&2; exit 1; }

# Sign up + collect tokens.
SIGNUP=$(curl -sS -c "$JAR" -X POST "$WEB/api/auth/signup" \
  -H "content-type: application/json" \
  --data "{\"tenantName\":\"Verify $SUFFIX\",\"tenantSlug\":\"$SUFFIX\",\"ownerName\":\"Owner\",\"ownerEmail\":\"$EMAIL\",\"password\":\"$PW\"}")
emit "signup keys: $(echo "$SIGNUP" | python -c "import sys,json; print(list(json.load(sys.stdin).keys()))")"
ACCESS=$(curl -sS -X POST "$API/auth/login" -H "content-type: application/json" \
  --data "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# Create some seed data.
ACC_ID=$(curl -sS -X POST "$API/accounts" -H "authorization: Bearer $ACCESS" \
  -H "content-type: application/json" \
  --data '{"name":"Vrf35 Acme","billingTerms":"net_30"}' | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
CUST_ID=$(curl -sS -X POST "$API/customers" -H "authorization: Bearer $ACCESS" \
  -H "content-type: application/json" \
  --data "{\"type\":\"account\",\"name\":\"35 John\",\"phone\":\"+15555558800\",\"accountId\":\"$ACC_ID\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
VEH_ID=$(curl -sS -X POST "$API/vehicles" -H "authorization: Bearer $ACCESS" \
  -H "content-type: application/json" \
  --data '{"plate":"VRF35A","plateState":"OH","year":2021,"make":"Toyota","model":"RAV4","vin":"JTMRFREV0FD123456"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -sS -X POST "$API/customers/$CUST_ID/vehicles/$VEH_ID" \
  -H "authorization: Bearer $ACCESS" -H "content-type: application/json" \
  --data '{"relationship":"owner","isPrimary":true}' > /dev/null

# ---------- sidebar ----------
SIDE_HTML=$(curl -sS -L -b "$JAR" "$WEB/dashboard")
echo "$SIDE_HTML" | grep -q ">Dashboard<" && echo "SIDE_DASH=PASS" || echo "SIDE_DASH=FAIL"
echo "$SIDE_HTML" | grep -q ">Customers<" && echo "SIDE_CUST=PASS" || echo "SIDE_CUST=FAIL"
echo "$SIDE_HTML" | grep -q ">Accounts<" && echo "SIDE_ACC=PASS" || echo "SIDE_ACC=FAIL"
echo "$SIDE_HTML" | grep -q ">Motor Clubs<" && echo "SIDE_MC=PASS" || echo "SIDE_MC=FAIL"
# Vehicles must NOT appear as a nav item label inside the sidebar nav. We
# test the pattern <span ...>Vehicles</span> which is the nav-item label
# format. Inline markup like "Vehicles on file" must NOT trigger this.
if echo "$SIDE_HTML" | grep -q '<span class="text-sm font-medium">Vehicles</span>'; then
  echo "SIDE_NO_VEH=FAIL"
else
  echo "SIDE_NO_VEH=PASS"
fi

# ---------- /vehicles → 404 ----------
VEH_LIST_STATUS=$(curl -sS -L -o /dev/null -b "$JAR" -w "%{http_code}" "$WEB/vehicles")
emit "/vehicles → $VEH_LIST_STATUS"
[ "$VEH_LIST_STATUS" = "404" ] && echo "VEHICLES_LIST_404=PASS" || echo "VEHICLES_LIST_404=FAIL"

VEH_NEW_STATUS=$(curl -sS -L -o /dev/null -b "$JAR" -w "%{http_code}" "$WEB/vehicles/new")
emit "/vehicles/new → $VEH_NEW_STATUS"
[ "$VEH_NEW_STATUS" = "404" ] && echo "VEHICLES_NEW_404=PASS" || echo "VEHICLES_NEW_404=FAIL"

# ---------- /vehicles/[id] still works ----------
VEH_DETAIL_STATUS=$(curl -sS -L -o /dev/null -b "$JAR" -w "%{http_code}" "$WEB/vehicles/$VEH_ID")
emit "/vehicles/$VEH_ID → $VEH_DETAIL_STATUS"
[ "$VEH_DETAIL_STATUS" = "200" ] && echo "VEHICLES_DETAIL_OK=PASS" || echo "VEHICLES_DETAIL_OK=FAIL"

# ---------- customer detail shows vehicles inline ----------
CUST_HTML=$(curl -sS -L -b "$JAR" "$WEB/customers/$CUST_ID")
if echo "$CUST_HTML" | grep -q "Vehicles on file" && \
   echo "$CUST_HTML" | grep -q "RAV4" && \
   echo "$CUST_HTML" | grep -q "VRF35A"; then
  echo "CUST_DETAIL_VEHICLES=PASS"
else
  echo "CUST_DETAIL_VEHICLES=FAIL"
fi
# VIN last 6 — JTMRFREV0FD123456 → "123456"
echo "$CUST_HTML" | grep -q "123456" && echo "CUST_DETAIL_VIN6=PASS" || echo "CUST_DETAIL_VIN6=FAIL"
echo "$CUST_HTML" | grep -q "Add vehicle" && echo "CUST_DETAIL_ADD_BTN=PASS" || echo "CUST_DETAIL_ADD_BTN=FAIL"

# ---------- account detail shows linked customers ----------
ACC_HTML=$(curl -sS -L -b "$JAR" "$WEB/accounts/$ACC_ID")
if echo "$ACC_HTML" | grep -q "Customers under this account" && echo "$ACC_HTML" | grep -q "35 John"; then
  echo "ACC_DETAIL_CUSTS=PASS"
else
  echo "ACC_DETAIL_CUSTS=FAIL"
fi

# ---------- find-or-create-by-contact ----------
FOC=$(curl -sS -X POST "$API/customers/find-or-create-by-contact" \
  -H "authorization: Bearer $ACCESS" -H "content-type: application/json" \
  --data '{"name":"Auto Caller","phone":"+15555558899"}')
emit "find-or-create response: $FOC"
echo "$FOC" | grep -q "auto_intake" && echo "FOC_AUTO=PASS" || echo "FOC_AUTO=FAIL"
FOC2=$(curl -sS -X POST "$API/customers/find-or-create-by-contact" \
  -H "authorization: Bearer $ACCESS" -H "content-type: application/json" \
  --data '{"name":"Auto Caller (different name)","phone":"+15555558899"}')
echo "$FOC2" | grep -q '"created":false' && echo "FOC_IDEMPOTENT=PASS" || echo "FOC_IDEMPOTENT=FAIL"

# ---------- ecosystem interface file present ----------
[ -f /c/dev/ustowdispatch/apps/api/src/integrations/ecosystem/ecosystem-provider.interface.ts ] \
  && echo "ECOSYSTEM_FILE=PASS" || echo "ECOSYSTEM_FILE=FAIL"
grep -q "EcosystemPartner" /c/dev/ustowdispatch/apps/api/src/integrations/ecosystem/ecosystem-provider.interface.ts \
  && echo "ECOSYSTEM_IFACE=PASS" || echo "ECOSYSTEM_IFACE=FAIL"
grep -q "CONVINI" /c/dev/ustowdispatch/apps/api/src/integrations/ecosystem/ecosystem-provider.interface.ts \
  && echo "ECOSYSTEM_COMMENT=PASS" || echo "ECOSYSTEM_COMMENT=FAIL"

# ---------- no UI references motor_club_member as a customer type ----------
if grep -rn "motor_club_member" /c/dev/ustowdispatch/apps/web/src 2>/dev/null; then
  echo "UI_NO_MCM=FAIL"
else
  echo "UI_NO_MCM=PASS"
fi
echo "ALL DONE"
