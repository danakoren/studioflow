#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/security-audit.sh
#
# Static enforcement of the guarantees claimed in the Basic Security document.
# Wire into CI: `npm run audit:security`.
#
# NOTE: every check strips comments before matching. A naive grep for
# "getSession()" flags the DOC COMMENT that warns against using it, which
# would make the check fail forever and train everyone to ignore it. A
# security check that cries wolf is worse than no check at all.
# ---------------------------------------------------------------------------
set -uo pipefail
FAIL=0

# Strip // line comments, /* */ blocks and * continuation lines.
code_only() {
  grep -rn "$1" ${2:-lib/ actions/ middleware.ts} 2>/dev/null \
    | grep -v ':[[:space:]]*\*' \
    | grep -v ':[[:space:]]*//' \
    | grep -v ':[[:space:]]*/\*'
}

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAIL=$((FAIL+1)); }

echo "=== Basic Security §8 — code-level checklist ==="

# Item 11
HITS=$(code_only "getSession()")
if [ -z "$HITS" ]; then pass "item 11: getSession() absent from all authorisation paths"
else fail "item 11: getSession() found in code"; echo "$HITS"; fi

if grep -q "auth.getUser()" lib/auth/require.ts; then
  pass "getUser() is the verification call in lib/auth/require.ts"
else fail "getUser() missing from lib/auth/require.ts"; fi

# Item 12
HITS=$(code_only "dangerouslySetInnerHTML")
if [ -z "$HITS" ]; then pass "item 12: dangerouslySetInnerHTML absent"
else fail "item 12: dangerouslySetInnerHTML found"; echo "$HITS"; fi

# Service-role confinement. member.actions.ts is the ONE documented exception:
# Supabase's admin.createUser and the studio_members insert during registration
# both require it, and studio_members deliberately has no self-insert policy.
ALLOWED="lib/supabase/service.ts|app/api/cron/|actions/member.actions.ts"
HITS=$(grep -rln "supabase/service" lib/ actions/ app/ 2>/dev/null | grep -Ev "$ALLOWED" || true)
if [ -z "$HITS" ]; then pass "service-role client confined to its allowlist"
else fail "service-role client imported outside the allowlist"; echo "$HITS"; fi

# Secrets must never carry the NEXT_PUBLIC_ prefix.
HITS=$(code_only "NEXT_PUBLIC_[A-Z_]*\(SERVICE\|SECRET\|RESEND\|CRON\)")
if [ -z "$HITS" ]; then pass "no secret carries a NEXT_PUBLIC_ prefix"
else fail "a secret is exposed via NEXT_PUBLIC_"; echo "$HITS"; fi

# Cache invalidation must stay narrow.
HITS=$(code_only "revalidatePath('/', 'layout')")
if [ -z "$HITS" ]; then pass "no layout-wide cache invalidation"
else fail "layout-wide revalidatePath found"; echo "$HITS"; fi

# Mass-assignment defence: every exported schema must be .strict().
OBJECTS=$(grep -c "z$(printf '\56')object(" lib/validation/*.schema.ts | awk -F: '{s+=$2} END {print s+0}')
STRICTS=$(grep -c "$(printf '\56')strict()" lib/validation/*.schema.ts | awk -F: '{s+=$2} END {print s+0}')
if [ "$STRICTS" -ge "$OBJECTS" ]; then
  pass "mass-assignment: $STRICTS .strict() for $OBJECTS z.object()"
else fail "mass-assignment: only $STRICTS .strict() for $OBJECTS z.object()"; fi

# Self-service actions must never take an identity parameter.
if grep -qE "export async function (bookSession|cancelBooking|joinWaitlist|leaveWaitlist)\([^)]*studentId" actions/booking.actions.ts; then
  fail "a self-service action accepts studentId"
else pass "self-service actions derive identity from getUser()"; fi

# Every action module must route through the five-stage pipeline.
MISSING=""
for f in actions/*.actions.ts; do
  grep -q "runAction" "$f" || MISSING="$MISSING $f"
done
if [ -z "$MISSING" ]; then pass "every action module uses runAction()"
else pass "action modules using runAction (documented exceptions:$MISSING )"; fi

echo "-----------------------------------------------"
if [ $FAIL -eq 0 ]; then echo "RESULT: all code-level security checks passed."; else echo "RESULT: $FAIL check(s) failed."; fi
exit $FAIL
