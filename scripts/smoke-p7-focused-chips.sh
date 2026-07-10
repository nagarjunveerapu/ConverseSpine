#!/usr/bin/env bash
# P7 focused-chip smoke — Starting prices + Send brochure stickiness on Dev/local.
# Usage:
#   ./scripts/smoke-p7-focused-chips.sh
#   CONVERSE_SPINE_URL=http://127.0.0.1:8789 ./scripts/smoke-p7-focused-chips.sh
set -euo pipefail

BASE="${CONVERSE_SPINE_URL:-https://converse-spine-dev.nagarjun-arjun.workers.dev}"
PREFS='{"purpose":"Self-use","budget":"₹1–1.5 Cr","property_type":"Apartment","bhk":"3 BHK","location":"Whitefield"}'

advisor_turn() {
  local sid=$1 text=$2 with_prefs=${3:-0} project_id=${4:-}
  local payload
  payload=$(jq -n \
    --arg sid "$sid" \
    --arg text "$text" \
    --argjson prefs "$PREFS" \
    --arg pid "$project_id" \
    --argjson with_prefs "$with_prefs" \
    '{
      session_id: $sid,
      text: $text
    }
    + (if $with_prefs == 1 then {preferences: $prefs} else {} end)
    + (if $pid != "" then {project_id: $pid} else {} end)')
  curl -sS -X POST "$BASE/api/advisor/turn" \
    -H 'content-type: application/json' \
    -d "$payload"
}

focus_id() {
  echo "$1" | jq -r '.focused_project.project_id // .nba.focus_project_id // .debug.focus.projectId // empty'
}

focus_name() {
  echo "$1" | jq -r '.focused_project.name // .nba.focus_project_name // .debug.focus.projectName // empty'
}

assert_focus_contains() {
  local resp=$1 needle=$2 label=$3
  local id name haystack needle_lc
  id=$(focus_id "$resp")
  name=$(focus_name "$resp")
  haystack=$(printf '%s %s' "$id" "$name" | tr '[:upper:]' '[:lower:]')
  needle_lc=$(printf '%s' "$needle" | tr '[:upper:]' '[:lower:]')
  if [[ "$haystack" != *"$needle_lc"* ]]; then
    echo "FAIL $label: expected focus to contain '$needle' got id='$id' name='$name'"
    echo "$resp" | jq '{phase, goal_kind, reply: (.reply|.[0:240]), focused_project, nba}' 2>/dev/null || echo "$resp" | head -c 800
    exit 1
  fi
  echo "PASS $label focus=$name ($id)"
}

assert_reply_not_no_fit() {
  local resp=$1 label=$2
  local reply goal
  reply=$(echo "$resp" | jq -r '.reply // empty')
  goal=$(echo "$resp" | jq -r '.goal_kind // .debug.goal.kind // empty')
  if [[ "$goal" == "no_fit" ]] || [[ "$reply" == *"couldn't find"* ]] || [[ "$reply" == *"no projects"* ]]; then
    echo "FAIL $label: unexpected no_fit path goal=$goal"
    echo "$reply" | head -c 400
    exit 1
  fi
  echo "PASS $label goal=$goal"
}

assert_not_focus() {
  local resp=$1 bad=$2 label=$3
  local id name haystack bad_lc
  id=$(focus_id "$resp")
  name=$(focus_name "$resp")
  haystack=$(printf '%s %s' "$id" "$name" | tr '[:upper:]' '[:lower:]')
  bad_lc=$(printf '%s' "$bad" | tr '[:upper:]' '[:lower:]')
  if [[ "$haystack" == *"$bad_lc"* ]]; then
    echo "FAIL $label: focus wrongly switched to '$bad' (id='$id' name='$name')"
    exit 1
  fi
  echo "PASS $label not-$bad"
}

TS=$(date +%s)
echo "Target: $BASE"
echo ""

# ── P7-G01: Cornerstone → Starting prices stays focused + answers price ──
SID="p7-prices-$TS"
echo "========== P7-G01: Cornerstone → Starting prices =========="
advisor_turn "$SID" "Whitefield" 1 >/dev/null
sleep 1
R=$(advisor_turn "$SID" "Cornerstone Utopia looks good" 0)
assert_focus_contains "$R" "cornerstone" "P7-G01 focus after pick"
sleep 1
R=$(advisor_turn "$SID" "Starting prices" 0)
echo "$(echo "$R" | jq -r '.reply // empty')" | head -c 500
echo
assert_focus_contains "$R" "cornerstone" "P7-G01 focus after Starting prices"
assert_reply_not_no_fit "$R" "P7-G01 not no_fit"
assert_not_focus "$R" "buena" "P7-G01 not Buena Vista"

# ── P7-G02: Vanam → Send brochure stays Vanam (no Buena Vista switch) ──
SID="p7-brochure-$TS"
echo ""
echo "========== P7-G02: Vanam → Send brochure stickiness =========="
advisor_turn "$SID" "Whitefield" 1 >/dev/null
sleep 1
R=$(advisor_turn "$SID" "Vanam looks good" 0)
assert_focus_contains "$R" "vanam" "P7-G02 focus after pick"
sleep 1
R=$(advisor_turn "$SID" "Send brochure" 0)
echo "$(echo "$R" | jq -r '.reply // empty')" | head -c 500
echo
assert_focus_contains "$R" "vanam" "P7-G02 focus after Send brochure"
assert_not_focus "$R" "buena" "P7-G02 not Buena Vista"

echo ""
echo "P7 focused-chip smoke complete."
