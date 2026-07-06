#!/usr/bin/env bash
# LLD §11 visit-route UAT against converse-spine-dev (advisor + WA /chat).
set -euo pipefail

BASE="${CONVERSE_SPINE_URL:-https://converse-spine-dev.nagarjun-arjun.workers.dev}"
PREFS='{"purpose":"Self-use","budget":"₹40–50L","property_type":"Apartment","bhk":"2 BHK","location":"Aerospace Park / Devanahalli Corridor"}'

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

wa_turn() {
  local phone=$1 text=$2 conv=${3:-}
  local body
  if [[ -n $conv ]]; then
    body=$(jq -n --arg b "naya-advisor" --arg p "$phone" --arg t "$text" --arg c "$conv" \
      '{builder_id:$b,buyer_phone:$p,text:$t,conversation_id:$c}')
  else
    body=$(jq -n --arg b "naya-advisor" --arg p "$phone" --arg t "$text" \
      '{builder_id:$b,buyer_phone:$p,text:$t}')
  fi
  curl -sS -X POST "$BASE/chat" -H 'content-type: application/json' -d "$body"
}

print_reply() {
  jq -r '.reply // .error // .' | head -c 500
  echo
}

run_scenario() {
  local name=$1 sid=$2
  shift 2
  echo ""
  echo "========== $name (session: $sid) =========="
  echo ">>> Aerospace Park / Devanahalli Corridor (brief)"
  resp=$(advisor_turn "$sid" "Aerospace Park / Devanahalli Corridor" 1)
  echo "$(echo "$resp" | jq -r '.reply // .error // .detail // empty')"
  sleep 1
  for msg in "$@"; do
    echo ">>> $msg"
    resp=$(advisor_turn "$sid" "$msg" 0)
    echo "$(echo "$resp" | jq -r '.reply // .error // .detail // empty')"
    phase=$(echo "$resp" | jq -r '.phase // empty')
    goal=$(echo "$resp" | jq -r '.goal_kind // empty')
    [[ -n $phase ]] && echo "    phase=$phase goal=$goal"
    if echo "$resp" | jq -e '.visit_itinerary' >/dev/null 2>&1; then
      echo "$resp" | jq -c '.visit_itinerary'
    fi
    if echo "$resp" | jq -e '.visit_queue' >/dev/null 2>&1; then
      echo "$resp" | jq -c '.visit_queue'
    fi
    sleep 1
  done
}

TS=$(date +%s)

echo "Target: $BASE"

# Scenario A: 2-stop + 3 PM override on stop 2
run_scenario "A: 2-stop + 3 PM override" "uat-a-$TS" \
  "I want to visit Cornerstone and Eldorado" \
  "I come from Yelahanka" \
  "Thursday 10 AM" \
  "yes" \
  "same day" \
  "3 PM"

# Scenario B: graze-add third stop after booking 2
run_scenario "B: graze-add Orchards" "uat-b-$TS" \
  "I want to visit Cornerstone and Eldorado" \
  "I come from Yelahanka" \
  "Thursday 10 AM" \
  "yes" \
  "same day 2 PM" \
  "yes" \
  "I also want to visit Orchards"

# Scenario C: WhatsApp /chat parity (2-stop same day)
echo ""
echo "========== C: WA /chat parity (phone uat-wa-$TS) =========="
PHONE="+9198765${TS: -5}"
CONV=""
BRIEF="2 BHK apartment in Aerospace Park Devanahalli corridor, budget 40-50 lakh, self use"
echo ">>> $BRIEF"
resp=$(wa_turn "$PHONE" "$BRIEF" "$CONV")
CONV=$(echo "$resp" | jq -r '.conversation_id // empty')
echo "$(echo "$resp" | jq -r '.reply_text // .reply // .error // empty')"
sleep 1
for msg in \
  "I want to visit Cornerstone and Eldorado" \
  "I come from Yelahanka" \
  "Thursday 10 AM" \
  "yes" \
  "same day" \
  "yes"; do
  echo ">>> $msg"
  resp=$(wa_turn "$PHONE" "$msg" "$CONV")
  CONV=$(echo "$resp" | jq -r '.conversation_id // empty')
  echo "$(echo "$resp" | jq -r '.reply_text // .reply // .error // empty')"
  sleep 1
done

echo ""
echo "Done."
