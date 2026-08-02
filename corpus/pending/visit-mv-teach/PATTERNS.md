# Visit module — pattern catalog (natural + sabotage)

**Rule:** Bulk patterns → append-only teach → ablation → then policy/copy.  
**State token:** prefer `<visit_pending>` for state-dependent deixis / itinerary acts (Phase 2).  
**Not taught:** keyboard smash, cricket smalltalk — placeability + contextual clarify.

---

## Kind registry (visit open acts)

| `intent_kind` | Buyer job | Routes to | Deterministic consumer |
|---------------|-----------|-----------|------------------------|
| `book_visit` | Start / continue visit | `visit_schedule_stop` | enter/continue visit |
| `visit_choose_stops` | Which projects (both / all / 1 and 2) | `visit_schedule_stop` | chooser resolve |
| `visit_same_day` | Next stop same calendar day | `visit_schedule_stop` | stagger / same_day_choice |
| `visit_other_day` | Next stop another day | `visit_schedule_stop` | day ask / other hint |
| `visit_force_same_day` | Override split → pack one day | `visit_schedule_stop` | `same_forced` + pack |
| `visit_ask_team` | Outside hours → team request | `visit_schedule_stop` | pending team, not firm book |

**Counter-intents (sabotage labeled correctly):** `compare_projects`, `get_amenities`, `get_price`, `get_legal_info`, `find_projects`, `ask_next_step`.

**Multi-intent:** packed lines are catalogued as **atoms** — teach the primary visit act under `<visit_pending>`; secondary facets stay on their kinds. Producer multi-bind is Phase 3; do not invent a mega-kind.

---

## Family V1 — Enter visit / choose stops

### Natural (positive → `book_visit` or `visit_choose_stops`)

| ID | Lang | Phrasing | Kind |
|----|------|----------|------|
| V1-n01 | en | I want to visit | book_visit |
| V1-n02 | en | come for the visit | book_visit |
| V1-n03 | en | can we schedule a site visit | book_visit |
| V1-n04 | en | I want to tour Ayana | book_visit |
| V1-n05 | hi-en | visit karna hai | book_visit |
| V1-n06 | hi | साइट विजिट करना है | book_visit |
| V1-n07 | en | both | visit_choose_stops |
| V1-n08 | en | both of them | visit_choose_stops |
| V1-n09 | en | all of them | visit_choose_stops |
| V1-n10 | en | 1 and 2 | visit_choose_stops |
| V1-n11 | en | Ayana and Krishnaja | visit_choose_stops |
| V1-n12 | hi-en | dono | visit_choose_stops |
| V1-n13 | hi | दोनों | visit_choose_stops |
| V1-n14 | en | all three | visit_choose_stops |

### Sabotage / false-bind

| ID | Attack | Phrasing | Correct kind | Why |
|----|--------|----------|--------------|-----|
| V1-s01 | Compare hijack | compare both | compare_projects | Must not become visit_choose_stops |
| V1-s02 | Compare hijack | compare all three | compare_projects | |
| V1-s03 | Compare + visit | compare them then visit | compare_projects | Primary atom compare; visit later |
| V1-s04 | Search pivot | show more projects | find_projects | Exit visit OK |
| V1-s05 | Smash as chooser | asdfghjkl | *(no teach)* | Placeability / clarify |

---

## Family V2 — Origin / place

### Natural (closed slot — **not** new intent kinds; origin is text slot)

| ID | Lang | Phrasing | Notes |
|----|------|----------|-------|
| V2-n01 | en | Indiranagar | placeability accept |
| V2-n02 | en | from Whitefield | |
| V2-n03 | hi-en | Whitefield se aaunga | |
| V2-n04 | en | I'll come from Koramangala | |

### Sabotage (policy, not teach)

| ID | Attack | Phrasing | Expected act |
|----|--------|----------|--------------|
| V2-s01 | Smash | asdfghjkl qwerty | clarify + re-ask origin |
| V2-s02 | Smalltalk | why is cricket so popular in india lol | clarify + re-ask origin |
| V2-s03 | Filler | lmao ok fine | re-ask day/time if past origin |
| V2-s04 | Fake place | boarding a flight | reject as origin |
| V2-s05 | Long question as place | which project has the best clubhouse? | not origin stamp |

---

## Family V3 — Day / time / hours

### Natural

| ID | Lang | Phrasing | Kind / slot |
|----|------|----------|-------------|
| V3-n01 | en | Saturday morning | day+window (closed) |
| V3-n02 | en | Monday 11am | closed |
| V3-n03 | en | Monday 6pm | closed → hours reject |
| V3-n04 | hi-en | Saturday subah | closed |
| V3-n05 | en | tomorrow afternoon | closed |

### Sabotage

| ID | Attack | Phrasing | Correct |
|----|--------|----------|---------|
| V3-s01 | Force firm after-hours | book 6pm anyway | hours policy reject / offer closest — not silent book |
| V3-s02 | Ambiguous | evening | ask clarify window |
| V3-s03 | Multi | Saturday 11 and also price | book_visit/slot + get_price atoms |

---

## Family V4 — Ask the team (after hours)

### Natural → `visit_ask_team`

| ID | Lang | Phrasing |
|----|------|----------|
| V4-n01 | en | ask the team for 6pm |
| V4-n02 | en | ask the team if they can host later |
| V4-n03 | en | request the team for Monday 6pm |
| V4-n04 | en | see if the team can do after hours |
| V4-n05 | en | can you ask sales for 6 pm visit |
| V4-n06 | en | tell sales I need 7pm |
| V4-n07 | en | check with the team for late evening |
| V4-n08 | hi-en | team se pooch lo 6 baje possible hai kya |
| V4-n09 | hi-en | sales se bol do after hours |
| V4-n10 | hi | टीम से पूछो 6 बजे |

### Sabotage

| ID | Attack | Phrasing | Correct |
|----|--------|----------|---------|
| V4-s01 | Firm insist | just book 6pm | hours reject, not team unless ask-team |
| V4-s02 | Unrelated team | ask the team about discount | negotiate/discount — not visit_ask_team |
| V4-s03 | Multi | ask team for 6pm and send brochure | visit_ask_team + media atom |

---

## Family V5 — Force same day / pack

### Natural → `visit_force_same_day`

| ID | Lang | Phrasing |
|----|------|----------|
| V5-n01 | en | force all same day Monday |
| V5-n02 | en | all three same day anyway |
| V5-n03 | en | force same day for all stops |
| V5-n04 | en | pack all visits into one day Monday |
| V5-n05 | en | same day all three force it |
| V5-n06 | en | cram all three into Monday |
| V5-n07 | en | squeeze everything into one day |
| V5-n08 | en | I don't care about the drive — same day |
| V5-n09 | hi-en | ek hi din mein sab force karo |
| V5-n10 | hi | एक ही दिन में तीनों |

### Sabotage

| ID | Attack | Phrasing | Correct |
|----|--------|----------|---------|
| V5-s01 | Soft same (not force) | same day | visit_same_day — not force |
| V5-s02 | Accept split | OK split is fine | split accept (affirm) — not force |
| V5-s03 | Other day | different day | visit_other_day |

---

## Family V6 — Itinerary anaphora (after stop1 booked / digression)

### Natural → `visit_same_day` / `visit_other_day`

| ID | Lang | Phrasing | Kind |
|----|------|----------|------|
| V6-n01 | en | same day | visit_same_day |
| V6-n02 | en | same day for Krishnaja | visit_same_day |
| V6-n03 | en | that day for the second one | visit_same_day |
| V6-n04 | en | back to back same day | visit_same_day |
| V6-n05 | en | after that same day | visit_same_day |
| V6-n06 | hi-en | usi din Krishnaja | visit_same_day |
| V6-n07 | hi | उसी दिन | visit_same_day |
| V6-n08 | en | different day | visit_other_day |
| V6-n09 | en | another day for Krishnaja | visit_other_day |
| V6-n10 | en | next day for the second stop | visit_other_day |
| V6-n11 | hi-en | alag din | visit_other_day |
| V6-n12 | hi | दूसरे दिन | visit_other_day |

### Sabotage

| ID | Attack | Phrasing | Correct |
|----|--------|----------|---------|
| V6-s01 | Focus steal | Great choice path / bare project name mid-itinerary | stay visit if anaphora; else commit only if no draft |
| V6-s02 | Compare stamp | same day for Krishnaja with false compare | visit_same_day must win under visit_pending |
| V6-s03 | Facet digression | wait what amenities does Ayana have? | get_amenities — keep draft |
| V6-s04 | Legal digression | is it RERA approved? | get_legal_info — keep draft |
| V6-s05 | Price digression | what's the price again | get_price — keep draft |
| V6-s06 | Resume after digression | same day for Krishnaja | visit_same_day (not commit) |

---

## Family V7 — Packed multi-intent

| ID | Phrasing | Atoms (order) |
|----|----------|---------------|
| V7-n01 | visit Ayana and Krishnaja Saturday 11am from Whitefield | visit_choose_stops + origin + slot |
| V7-n02 | both Saturday morning from Indiranagar | visit_choose_stops + slot + origin |
| V7-n03 | same day and also send brochure | visit_same_day + share_media |
| V7-n04 | Monday 6pm ask the team | slot + visit_ask_team |
| V7-s01 | compare both and visit Saturday | compare_projects then book_visit |

Teach: prefer **one primary vector** under visit_pending for the visit atom; do not merge into a single mega-kind.

---

## Family V8 — Contextual misunderstand (copy only)

| Context | Noise | Copy shape |
|---------|-------|------------|
| Origin outstanding | smash / cricket | couldn’t make sense + need starting area |
| Day/time outstanding | filler | still picking day/time for *Project* |
| Discover requirements | smash | help choose property — locality/budget/BHK |
| Focused legal | smash | still on legal for *Project* |

No INTENT_VECTORS rows for smash.

---

## Teach batch mapping

| Families | Upsert kinds |
|----------|----------------|
| V4 | `visit_ask_team` |
| V5 | `visit_force_same_day` |
| V6 natural | `visit_same_day`, `visit_other_day` |
| V1 chooser natural | `visit_choose_stops` |
| V1/V5/V6 sabotage | counter-intent rows (`compare_projects`, `get_amenities`, …) |
| V2/V8 | no upsert |

Source tag: `visit_mv_patterns_2026_08_02`.
