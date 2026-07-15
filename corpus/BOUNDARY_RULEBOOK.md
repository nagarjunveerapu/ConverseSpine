# Intent Boundary Rulebook — v2 (2026-07-15)

The corpus study (artifact `corpus-study-v1`) found 33 masked patterns carrying 2+ labels —
sitting exactly on the model's measured confusion pairs. A boundary the labels disagree on is
unlearnable. Each contested boundary below is adjudicated ONCE, by a single principle:

> **A phrasing belongs to the intent whose Desk evidence answers it.**
> Labels follow where the answer lives, not where a grader guessed.

These rules are encoded mechanically in `scripts/registry-v2.py`; every relabel carries
`relabel_reason` so the change is auditable row by row.

## R1 — get_location_info vs get_amenities
**Evidence split:** `location_intel` arrays (schools/hospitals/connectivity/distance) vs the
project's own amenities list (gym/pool/clubhouse/security/parking).
- Proximity/surroundings asks → **get_location_info**: "schools near X", "hospitals near X",
  "distance from metro/airport/tech park", "how far", "kitna door", "well connected",
  "waterlogging/flooding", "which part of city".
- In-project facility asks → **get_amenities**: "is there a gym/pool/clubhouse/party hall",
  "jogging track", "24x7 security", "visitor parking", "play area", "open gym".
- Note: the corpus majority for "schools near <place>" was amenities (24 vs 5). The majority is
  WRONG — nearby schools are served from location_intel. Majority never decides; evidence does.

## R2 — get_location_info vs ask_investment_return
**Evidence split:** growth/investment answers vs locality facts.
- "appreciation in X", "rental yield in X", "ROI", "investment outlook", "property kitni badhegi"
  → **ask_investment_return** (even though a place is named — the place is a slot, not the ask).
- Connectivity, civic, flood, directions, "which part of city" → **get_location_info**.

## R3 — get_price vs find_projects
- Budget used as a **filter for discovery** → **find_projects**: "options under 80L",
  "50-60 lakhs mein kya milega", "show me what I can get for X".
- Price **of a specific thing** (named/focused project or config) → **get_price**:
  "3BHK ka rate", "price of 2BHK in X", "how much is …".

## R4 — get_project_info vs compare_projects
- Two+ named projects, or vs/or/"kaun better" framing → **compare_projects**.
- Single subject or generic "tell me about / details / USP" → **get_project_info**.

## R5 — get_payment_plan vs ask_delivery_timeline
- Payment schedule, milestones, CLP, subvention, booking amount, "construction ke saath payment"
  → **get_payment_plan** (construction words don't flip it — the money is the ask).
- Possession, ready-by, delay, construction *progress* (no money aspect) → **ask_delivery_timeline**.

## R6 — small_talk vs confirm_action vs other (negatives lane)
All three remain NON-routable (speech-act layer owns them; rows serve as negatives).
Consistency only: explicit affirmation of a prior bot offer → confirm_action; greetings/pleasantry
→ small_talk; process questions ("how does this work") → other.

## Routability decisions (founder, 2026-07-15)
`opt_out`, `escalate_to_human`, `request_callback`, `report_issue`, `status_check` are REAL
actions the bot must honor → marked `routable: true` in registry v2. Their embedder-map routing
lands in a separate engine PR (needs turn-contract routing targets). `small_talk`, `other`,
`confirm_action`, `provide_qualification`, `express_objection`, `commit`, `broker_inquiry`,
`acknowledge` stay non-routable (negatives / other layers own them).
