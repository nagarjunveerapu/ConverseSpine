#!/usr/bin/env bash
# RTI-3 LLD §9.1 — visit vs explore routing UAT on converse-spine-dev.
set -euo pipefail

BASE="${CONVERSE_SPINE_URL:-https://converse-spine-dev.nagarjun-arjun.workers.dev}"
PREFS='{"purpose":"Self-use","budget":"₹1–1.5 Cr","property_type":"Apartment","bhk":"3 BHK","location":"Whitefield"}'

advisor_turn() {
  local sid=$1 text=$2 with_prefs=${3:-0}
  if [[ $with_prefs == 1 ]]; then
    curl -sS -X POST "$BASE/api/advisor/turn" \
      -H 'content-type: application/json' \
      -d "{\"session_id\":\"$sid\",\"text\":$(jq -Rn --arg t "$text" '$t'),\"preferences\":$PREFS}"
  else
    curl -sS -X POST "$BASE/api/advisor/turn" \
      -H 'content-type: application/json' \
      -d "{\"session_id\":\"$sid\",\"text\":$(jq -Rn --arg t "$text" '$t')}"
  fi
}

assert_not_visit_ask() {
  local resp=$1 label=$2
  local goal phase reply
  goal=$(echo "$resp" | jq -r '.goal_kind // .debug.goal.kind // empty')
  phase=$(echo "$resp" | jq -r '.phase // .debug.phase // empty')
  reply=$(echo "$resp" | jq -r '.reply // empty')
  if [[ "$goal" == "visit_ask" ]] || [[ "$phase" == "visit" && "$reply" == *"which day works"* ]]; then
    echo "FAIL $label: got visit hijack goal=$goal phase=$phase"
    echo "$reply" | head -c 400
    exit 1
  fi
  echo "PASS $label goal=$goal phase=$phase"
}

assert_visit_path() {
  local resp=$1 label=$2
  local goal phase
  goal=$(echo "$resp" | jq -r '.goal_kind // .debug.goal.kind // empty')
  phase=$(echo "$resp" | jq -r '.phase // .debug.phase // empty')
  if [[ "$phase" != "visit" ]] && [[ "$goal" != visit_* ]]; then
    echo "FAIL $label: expected visit path goal=$goal phase=$phase"
    exit 1
  fi
  echo "PASS $label goal=$goal phase=$phase"
}

TS=$(date +%s)
echo "Target: $BASE"

# V01 — configurations probe must not visit-ask
SID="rti3-v01-$TS"
echo ""
echo "========== V01: Eldorado configurations (no visit hijack) =========="
advisor_turn "$SID" "Whitefield" 1 >/dev/null
sleep 1
advisor_turn "$SID" "Cornerstone Utopia looks good" 0 >/dev/null
sleep 1
R=$(advisor_turn "$SID" "what about the unit configurations of Eldorado?" 0)
echo "$(echo "$R" | jq -r '.reply // empty')" | head -c 500
echo
assert_not_visit_ask "$R" "V01"

# V04 — pricing in discover
SID="rti3-v04-$TS"
echo ""
echo "========== V04: Eldorado pricing (discover, not visit) =========="
advisor_turn "$SID" "Whitefield" 1 >/dev/null
sleep 1
R=$(advisor_turn "$SID" "what about Eldorado pricing?" 0)
echo "$(echo "$R" | jq -r '.reply // empty')" | head -c 500
echo
assert_not_visit_ask "$R" "V04"

# V05 — explicit visit intent
SID="rti3-v05-$TS"
echo ""
echo "========== V05: visiting Eldorado (visit phase) =========="
advisor_turn "$SID" "Whitefield" 1 >/dev/null
sleep 1
R=$(advisor_turn "$SID" "what about visiting Eldorado?" 0)
echo "$(echo "$R" | jq -r '.reply // empty')" | head -c 500
echo
assert_visit_path "$R" "V05"

echo ""
echo "RTI-3 UAT smoke complete."
