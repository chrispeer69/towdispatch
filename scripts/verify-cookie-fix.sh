#!/usr/bin/env bash
# Browser-like end-to-end check for the cookie-write-in-server-render fix.
#
# Simulates what a real browser does:
#   1. POST /api/auth/signup  → cookies arrive in jar
#   2. GET  /dashboard, /customers, /vehicles, /accounts (cookies forwarded by jar)
#      Confirm each returns 200 + the expected on-page markers, NOT a runtime
#      error overlay.
#   3. Tamper the access cookie to simulate expiry, then GET /dashboard:
#      - apiServer in session.ts must NOT crash with "Cookies can only be modified..."
#      - it should redirect to /login (status 307) since the access token is bad
#        and we no longer refresh in the render path.
#   4. POST /api/auth/refresh-if-needed → confirms the dedicated endpoint can
#      mint a new access cookie when a refresh token is still present.
set -uo pipefail

API="http://localhost:3001"
WEB="http://localhost:3000"
JAR=$(mktemp)
JAR2=$(mktemp)

slug() { date +%s | sha1sum | head -c 8; }
SUFFIX="cf-$(slug)"
EMAIL="owner-$SUFFIX@cookiefix.test"
PW="CorrectHorse-Battery-9!"

emit() { echo "[cf] $*"; }
fail() { echo "[cf] FAIL: $*" >&2; exit 1; }

emit "signup via /api/auth/signup (BFF route)"
SIGNUP=$(curl -sS -c "$JAR" -X POST "$WEB/api/auth/signup" \
  -H "content-type: application/json" \
  --data "{\"tenantName\":\"Cookie Fix $SUFFIX\",\"tenantSlug\":\"$SUFFIX\",\"ownerName\":\"Owner\",\"ownerEmail\":\"$EMAIL\",\"password\":\"$PW\"}")
emit "signup response keys: $(echo "$SIGNUP" | python -c "import sys,json; print(list(json.load(sys.stdin).keys()))" 2>/dev/null)"

# Cookie jar should now have tc_at + tc_rt.
emit "cookie jar contents:"
grep -E 'tc_at|tc_rt' "$JAR" | awk '{print "  " $6}'

# Create some data so the list pages have content.
ACCESS_TOKEN_FROM_API=$(curl -sS -X POST "$API/auth/login" \
  -H "content-type: application/json" \
  --data "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
curl -sS -X POST "$API/customers" \
  -H "authorization: Bearer $ACCESS_TOKEN_FROM_API" -H "content-type: application/json" \
  --data '{"type":"cash","name":"CookieFix John","phone":"+15555550700"}' > /dev/null
curl -sS -X POST "$API/vehicles" \
  -H "authorization: Bearer $ACCESS_TOKEN_FROM_API" -H "content-type: application/json" \
  --data '{"plate":"COKFIX","plateState":"OH","year":2022,"make":"Toyota","model":"Camry"}' > /dev/null
curl -sS -X POST "$API/accounts" \
  -H "authorization: Bearer $ACCESS_TOKEN_FROM_API" -H "content-type: application/json" \
  --data '{"name":"CookieFix Inc","billingTerms":"net_30"}' > /dev/null

# ---------- step 2: SSR pages render ----------
for path in "/dashboard" "/customers" "/vehicles" "/accounts"; do
  HTML=$(curl -sS -L -b "$JAR" -c "$JAR" "$WEB$path")
  STATUS=$(curl -sS -L -o /dev/null -b "$JAR" -c "$JAR" -w "%{http_code}" "$WEB$path")
  if echo "$HTML" | grep -qi "cookies can only be modified"; then
    fail "SSR error overlay still present at $path"
  fi
  emit "GET $path → $STATUS, error-overlay=NO"
done

# Look for expected page markers
DASH=$(curl -sS -L -b "$JAR" "$WEB/dashboard")
echo "$DASH" | grep -q "Operations Overview" && echo "MARK_DASHBOARD=PASS" || echo "MARK_DASHBOARD=FAIL"
CUST=$(curl -sS -L -b "$JAR" "$WEB/customers")
echo "$CUST" | grep -q "CookieFix John" && echo "MARK_CUSTOMERS=PASS" || echo "MARK_CUSTOMERS=FAIL"
VEH=$(curl -sS -L -b "$JAR" "$WEB/vehicles")
echo "$VEH" | grep -q "Toyota" && echo "MARK_VEHICLES=PASS" || echo "MARK_VEHICLES=FAIL"
ACC=$(curl -sS -L -b "$JAR" "$WEB/accounts")
echo "$ACC" | grep -q "CookieFix Inc" && echo "MARK_ACCOUNTS=PASS" || echo "MARK_ACCOUNTS=FAIL"

# ---------- step 3: simulate expired access token ----------
emit "simulating expired access token (overwriting tc_at with garbage)"
# Build a new jar with the refresh cookie intact, but tc_at replaced with garbage.
grep -v 'tc_at' "$JAR" > "$JAR2"
echo -e "#HttpOnly_localhost\tFALSE\t/\tFALSE\t0\ttc_at\teyJhbGciOiJIUzI1NiJ9.expired.fake" >> "$JAR2"

# GET /dashboard with expired access token + valid refresh.
# Expectation: server component reads cookie, calls /auth/me, gets 401,
# returns null, requireUser() redirects to /login. NO crash, NO cookie write.
EXP_STATUS=$(curl -sS -o /tmp/exp-body.html -w "%{http_code}" -b "$JAR2" "$WEB/dashboard")
emit "GET /dashboard with expired access token → $EXP_STATUS"
if grep -qi "cookies can only be modified" /tmp/exp-body.html; then
  fail "still hitting the cookie-write error in server render"
fi
echo "MARK_NO_CRASH_ON_EXPIRED_ACCESS=PASS"

# Should be a redirect (307) when followed; without -L, it's the redirect.
REDIR_LOCATION=$(curl -sS -o /dev/null -D - -b "$JAR2" "$WEB/dashboard" | grep -i '^location:' | head -1)
emit "redirect target: $REDIR_LOCATION"
echo "$REDIR_LOCATION" | grep -qi "/login" && echo "MARK_REDIRECT_TO_LOGIN=PASS" || echo "MARK_REDIRECT_TO_LOGIN=FAIL"

# ---------- step 4: dedicated refresh-if-needed endpoint ----------
emit "POST /api/auth/refresh-if-needed (refresh token still valid)"
RIN_STATUS=$(curl -sS -o /tmp/rin-body.json -w "%{http_code}" -b "$JAR2" -c "$JAR2" -X POST \
  "$WEB/api/auth/refresh-if-needed")
emit "refresh-if-needed response: $RIN_STATUS $(cat /tmp/rin-body.json)"
[ "$RIN_STATUS" = "200" ] && echo "MARK_REFRESH_ENDPOINT=PASS" || echo "MARK_REFRESH_ENDPOINT=FAIL"

# After refresh, /dashboard with the freshened jar should now be a 200.
POST_RIN_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -b "$JAR2" "$WEB/dashboard")
emit "GET /dashboard after refresh → $POST_RIN_STATUS"
[ "$POST_RIN_STATUS" = "200" ] && echo "MARK_REFRESHED_NAV=PASS" || echo "MARK_REFRESHED_NAV=FAIL"

echo "ALL DONE"
