#!/usr/bin/env bash
# End-to-end smoke tests for the critical journeys (feature 15).
# Usage: BASE=http://localhost:8001/api bash scripts/smoke_test.sh
# Requires: curl, node (for JSON parsing). Exits non-zero on the first failure.
set -uo pipefail

BASE="${BASE:-http://localhost:8001/api}"
PASS=0; FAIL=0

jqget() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const v=$1;console.log(v==null?'':v)}catch(e){console.log('')}})"; }
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 (got '$2', want '$3')"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
login() { curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jqget "o.access_token"; }

echo "== Health & readiness =="
check "liveness"  "$(code $BASE/health)" "200"
check "readiness" "$(code $BASE/health/ready)" "200"

echo "== Auth (all roles) =="
ST=$(login student@smartai.com student123);       check "student login" "$([ -n "$ST" ] && echo ok)" "ok"
PT=$(login parent@smartai.com parent123);          check "parent login"  "$([ -n "$PT" ] && echo ok)" "ok"
TT=$(login teacher@smartai.com teacher123);        check "teacher login" "$([ -n "$TT" ] && echo ok)" "ok"
AT=$(login admin@smartai.com admin123);            check "admin login"   "$([ -n "$AT" ] && echo ok)" "ok"
GT=$(login administrator@smartai.com administrator123); check "administrator login" "$([ -n "$GT" ] && echo ok)" "ok"

echo "== Student: progress + mastery engine =="
check "mastery-engine 200" "$(code $BASE/gamification/mastery-engine -H "Authorization: Bearer $ST")" "200"

echo "== Parent: linked-child progress + authorization boundary =="
CID=$(curl -s $BASE/parent/students -H "Authorization: Bearer $PT" | jqget "(o[0]||{}).id")
check "child overview 200" "$(code $BASE/parent/students/$CID/overview -H "Authorization: Bearer $PT")" "200"
check "unlinked child 403" "$(code $BASE/parent/students/999999/mastery -H "Authorization: Bearer $PT")" "403"

echo "== Teacher: class progress (school-scoped) =="
check "class overview 200" "$(code $BASE/teacher/class/overview -H "Authorization: Bearer $TT")" "200"

echo "== Billing: subscribe -> webhook -> credit (mock) =="
BEFORE=$(curl -s $BASE/billing/me -H "Authorization: Bearer $PT" | jqget "o.balance")
curl -s -X POST $BASE/billing/dev/complete -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d '{"kind":"topup","slug":"topup_small"}' >/dev/null 2>&1 || true
AFTER=$(curl -s $BASE/billing/me -H "Authorization: Bearer $PT" | jqget "o.balance")
check "credits increased after paid event" "$([ "$(node -e "console.log(Number('$AFTER')>Number('$BEFORE'))")" = "true" ] && echo ok)" "ok"

echo "== Notifications =="
check "notifications list 200" "$(code $BASE/notifications -H "Authorization: Bearer $PT")" "200"

echo "== Admin: settings + observability =="
check "settings schema 200"  "$(code $BASE/admin/settings -H "Authorization: Bearer $GT")" "200"
check "observability 200"    "$(code $BASE/admin/observability -H "Authorization: Bearer $GT")" "200"
check "student blocked from admin settings" "$(code $BASE/admin/observability -H "Authorization: Bearer $ST")" "403"

echo ""
echo "==== $PASS passed, $FAIL failed ===="
[ "$FAIL" -eq 0 ]
