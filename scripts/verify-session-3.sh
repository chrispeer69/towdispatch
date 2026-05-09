#!/usr/bin/env bash
# End-to-end verification for SESSION 3.0.
# Hits the API directly (port 3001) for data-mutation curls, and the web BFF
# (port 3000) to confirm the SSR pages render with the data we created.
#
# Tracks results in a series of PASS=… variables that the wrapper script
# reads to emit the final block.
set -uo pipefail

API="http://localhost:3001"
WEB="http://localhost:3000"

slug() { date +%s | sha1sum | head -c 8; }
SUFFIX_A="vrf-$(slug)-a"
SUFFIX_B="vrf-$(slug)-b"

emit() { echo "[verify] $*"; }
fail() { echo "[verify] FAIL: $*" >&2; exit 1; }

# ---------- tenant A ----------
emit "signing up tenant A: $SUFFIX_A"
A_BODY=$(cat <<EOF
{"tenantName":"Verify $SUFFIX_A","tenantSlug":"$SUFFIX_A","ownerName":"Verify Owner","ownerEmail":"owner-$SUFFIX_A@verify.test","password":"CorrectHorse-Battery-9!"}
EOF
)
A_SIGNUP=$(curl -sS -X POST "$API/auth/signup" \
  -H 'content-type: application/json' \
  --data "$A_BODY")
A_TOKEN=$(echo "$A_SIGNUP" | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])" 2>/dev/null)
A_TENANT=$(echo "$A_SIGNUP" | python -c "import sys,json; print(json.load(sys.stdin)['tenant']['id'])" 2>/dev/null)
A_USER=$(echo "$A_SIGNUP" | python -c "import sys,json; print(json.load(sys.stdin)['user']['id'])" 2>/dev/null)
A_REFRESH=$(echo "$A_SIGNUP" | python -c "import sys,json; print(json.load(sys.stdin)['refreshToken'])" 2>/dev/null)
[ -z "$A_TOKEN" ] && fail "no access token from signup A: $A_SIGNUP"
emit "tenant A id=$A_TENANT"

# ---------- create customer ----------
CUSTOMER_PAYLOAD='{"type":"cash","name":"John Smith","phone":"+15555550100"}'
CUST_RES=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" -X POST "$API/customers" \
  -H "authorization: Bearer $A_TOKEN" \
  -H "content-type: application/json" \
  --data "$CUSTOMER_PAYLOAD")
CUST_STATUS=$(echo "$CUST_RES" | grep "HTTP_STATUS" | sed 's/HTTP_STATUS://')
CUST_BODY=$(echo "$CUST_RES" | sed '$d')
emit "POST /customers status=$CUST_STATUS"
[ "$CUST_STATUS" != "201" ] && fail "customer create failed: $CUST_BODY"
CUST_ID=$(echo "$CUST_BODY" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
emit "customer id=$CUST_ID"
echo "RESULT_CUSTOMER_CREATE=PASS"

# ---------- create vehicle ----------
VEH_PAYLOAD='{"plate":"ABC123","plateState":"OH","year":2020,"make":"Honda","model":"Civic"}'
VEH_RES=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" -X POST "$API/vehicles" \
  -H "authorization: Bearer $A_TOKEN" \
  -H "content-type: application/json" \
  --data "$VEH_PAYLOAD")
VEH_STATUS=$(echo "$VEH_RES" | grep "HTTP_STATUS" | sed 's/HTTP_STATUS://')
VEH_BODY=$(echo "$VEH_RES" | sed '$d')
emit "POST /vehicles status=$VEH_STATUS"
[ "$VEH_STATUS" != "201" ] && fail "vehicle create failed: $VEH_BODY"
VEH_ID=$(echo "$VEH_BODY" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
emit "vehicle id=$VEH_ID"
echo "RESULT_VEHICLE_CREATE=PASS"

# ---------- link customer-vehicle ----------
LINK_RES=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" -X POST \
  "$API/customers/$CUST_ID/vehicles/$VEH_ID" \
  -H "authorization: Bearer $A_TOKEN" \
  -H "content-type: application/json" \
  --data '{"relationship":"owner","isPrimary":true}')
LINK_STATUS=$(echo "$LINK_RES" | grep "HTTP_STATUS" | sed 's/HTTP_STATUS://')
emit "POST link status=$LINK_STATUS"
[ "$LINK_STATUS" != "204" ] && fail "link failed: $LINK_RES"
echo "RESULT_LINK=PASS"

# ---------- search verifies vehicle count ----------
SEARCH_RES=$(curl -sS "$API/customers/search?q=John" -H "authorization: Bearer $A_TOKEN")
emit "search response=$SEARCH_RES"
VEHICLE_COUNT=$(echo "$SEARCH_RES" | python -c "import sys,json
data=json.load(sys.stdin)
john=[c for c in data if c['name']=='John Smith']
print(john[0]['vehicleCount'] if john else 'none')")
emit "John Smith vehicleCount=$VEHICLE_COUNT"
[ "$VEHICLE_COUNT" != "1" ] && fail "expected vehicleCount=1, got $VEHICLE_COUNT"
echo "RESULT_CUSTOMER_LOOKUP=PASS"

# ---------- vehicle plate lookup ----------
LOOKUP_RES=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  "$API/vehicles/lookup?plate=ABC123&state=OH" \
  -H "authorization: Bearer $A_TOKEN")
LOOKUP_STATUS=$(echo "$LOOKUP_RES" | grep "HTTP_STATUS" | sed 's/HTTP_STATUS://')
LOOKUP_BODY=$(echo "$LOOKUP_RES" | sed '$d')
emit "GET /vehicles/lookup status=$LOOKUP_STATUS"
[ "$LOOKUP_STATUS" != "200" ] && fail "lookup failed: $LOOKUP_BODY"
LOOKUP_MAKE=$(echo "$LOOKUP_BODY" | python -c "import sys,json; print(json.load(sys.stdin)['make'])")
[ "$LOOKUP_MAKE" != "Honda" ] && fail "expected Honda, got $LOOKUP_MAKE"
echo "RESULT_VEHICLE_LOOKUP=PASS"

# ---------- create account ----------
ACC_RES=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" -X POST "$API/accounts" \
  -H "authorization: Bearer $A_TOKEN" \
  -H "content-type: application/json" \
  --data '{"name":"Verify Acme","billingTerms":"net_30","creditLimit":"25000.00"}')
ACC_STATUS=$(echo "$ACC_RES" | grep "HTTP_STATUS" | sed 's/HTTP_STATUS://')
ACC_BODY=$(echo "$ACC_RES" | sed '$d')
emit "POST /accounts status=$ACC_STATUS"
[ "$ACC_STATUS" != "201" ] && fail "account create failed: $ACC_BODY"
echo "RESULT_ACCOUNT_CREATE=PASS"

# ---------- web BFF login (cookies for SSR) ----------
emit "logging in via /api/auth/login to get session cookies"
LOGIN_RES=$(curl -sS -c /tmp/cookies-a.txt -X POST "$WEB/api/auth/login" \
  -H "content-type: application/json" \
  --data "{\"email\":\"owner-$SUFFIX_A@verify.test\",\"password\":\"CorrectHorse-Battery-9!\"}")
emit "login result keys: $(echo "$LOGIN_RES" | python -c "import sys,json; print(list(json.load(sys.stdin).keys()))" 2>/dev/null || echo "<unparseable>")"

# ---------- web pages render ----------
DASH_HTML=$(curl -sS -b /tmp/cookies-a.txt "$WEB/dashboard")
echo "$DASH_HTML" | grep -q "Operations Overview" && echo "RESULT_DASHBOARD_RENDERS=PASS" || echo "RESULT_DASHBOARD_RENDERS=FAIL"

CUST_HTML=$(curl -sS -b /tmp/cookies-a.txt "$WEB/customers")
echo "$CUST_HTML" | grep -q "John Smith" && echo "RESULT_CUSTOMERS_PAGE=PASS" || { echo "$CUST_HTML" | head -50; echo "RESULT_CUSTOMERS_PAGE=FAIL"; }

VEH_HTML=$(curl -sS -b /tmp/cookies-a.txt "$WEB/vehicles")
echo "$VEH_HTML" | grep -q "Honda" && echo "RESULT_VEHICLES_PAGE=PASS" || { echo "$VEH_HTML" | head -30; echo "RESULT_VEHICLES_PAGE=FAIL"; }

ACC_HTML=$(curl -sS -b /tmp/cookies-a.txt "$WEB/accounts")
echo "$ACC_HTML" | grep -q "Verify Acme" && echo "RESULT_ACCOUNTS_PAGE=PASS" || { echo "$ACC_HTML" | head -30; echo "RESULT_ACCOUNTS_PAGE=FAIL"; }

# ---------- tenant B for cross-tenant attack ----------
emit "signing up tenant B: $SUFFIX_B"
B_BODY=$(cat <<EOF
{"tenantName":"Verify $SUFFIX_B","tenantSlug":"$SUFFIX_B","ownerName":"Attacker Owner","ownerEmail":"owner-$SUFFIX_B@verify.test","password":"CorrectHorse-Battery-9!"}
EOF
)
B_SIGNUP=$(curl -sS -X POST "$API/auth/signup" -H 'content-type: application/json' --data "$B_BODY")
B_TOKEN=$(echo "$B_SIGNUP" | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

ATTACK_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" \
  "$API/customers/$CUST_ID" \
  -H "authorization: Bearer $B_TOKEN")
emit "tenant B attempt to read tenant A customer: status=$ATTACK_STATUS"
[ "$ATTACK_STATUS" = "404" ] && echo "RESULT_CROSS_TENANT_BLOCKED=PASS" || echo "RESULT_CROSS_TENANT_BLOCKED=FAIL"

echo "ALL DONE"
