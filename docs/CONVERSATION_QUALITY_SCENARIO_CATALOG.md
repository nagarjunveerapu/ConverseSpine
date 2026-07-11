# Conversation quality — scenario catalog (visible checklist)

**Date:** 2026-07-11  
**Honest status:** Closed-beta **must-have script is green** on local `:8789` (MED/PIV/SW/VIS/STY/HIN-01). **HIN-02..06 + multi-visit seed pack** (BUYER-LOK-02, SA-G02/G02b, VIS-03/04) verified on this branch. Still **not** open-beta (advisor MED-02, full origin-route UAT depth).

This doc is the **list first**. Do not treat unchecked rows as green.

---

## What we actually verified recently (Dev)

| ID | Covered? | Notes |
|----|----------|--------|
| ADV-BAML-01, ADV-H01/H04, SA-G01, MEM-G01, RTI-G02, BUYER-LOK-02 | ✅ Ran | Green under shadow + promote |
| P7-G01 / P7-G02 (Advisor chips) | ✅ Ran | Starting prices; Vanam brochure stickiness |
| Named compare (Ayana vs Krishnaja) | ✅ Fixed + ran | Was Clarks; now correct |
| LOC-G01 North Bangalore list | ✅ Fixed + ran | Was silent Eldorado commit |
| ADV-H01 `haan` | ✅ Existing golden | Narrow Hinglish affirm only |
| **MED-01 / MED-03 / MED-04** | ✅ Ran 2026-07-11 | CDN brochure emit + honest floor_plan miss; `expect_media` wired in runner |
| **PIV-01 / PIV-02 / PIV-03** | ✅ Ran 2026-07-11 | Budget crash, Whitefield correction, 2BHK refine |
| **SW-01 / SW-02 / SW-03** | ✅ Ran 2026-07-11 | Named switch, A→B→C spam, paperwork stickiness |
| **VIS-01 / VIS-02** | ✅ Ran 2026-07-11 | Ayana visit (no Desire Spaces); price interrupt mid-visit |
| **STY-01 / STY-02** | ✅ Ran 2026-07-11 | Small talk; long dump North-only (no Meadows) |
| **HIN-01** | ✅ Ran 2026-07-11 | Whitefield mein 3BHK dikhao → recommend |
| **HIN-02..06** | ✅ Fixed + soak | price kitna / brochure bhejo / visit karna / dono compare / nahi chahiye |
| Multi-visit route by origin / sequencing | ✅ Seed green | BUYER-LOK-02, SA-G02/G02b, VIS-03/04 soak; deeper origin UAT optional |
| **FAQ-01 rental yield** | ✅ Live soak 2026-07-11 | FAQ key→`faqLookup`→compose; tools=`faqLookup` |
| **FAQ-02 possession / FAQ-03 payment / FAQ-04 loan** | ✅ Live soak | Desk FAQs; home-loan ≠ EMI calculator |
| Expert deep-probe vs novice minimal | ⚠️ Partial | ADV-F01 = expert-ish facets; no paired novice journey |
| MED-02 advisor brochure | ❌ Not verified | Advisor channel — next wave |

---

## Proposed scenario matrix (run next)

Status legend: **HAVE** = JSON/script exists · **NEED** = write then run · **CHANNEL** = chat / advisor / both

### A. Media emission

| ID | Channel | Scenario | Pass if | Status |
|----|---------|----------|---------|--------|
| **MED-01** | chat | Focus Ayana → `share brochure` / `Send brochure` | Reply mentions brochure **or** honest no-brochure; `whatsapp_actions` / media URL when asset exists; focus stays Ayana | NEED (extend P7-G02) |
| **MED-02** | advisor | Focus Cornerstone → `Send brochure` | Same; `nba` stays on project board | NEED |
| **MED-03** | chat | Focus project **with** brochure on file → ask brochure | Media action / CDN link present (not only copy) | NEED — catalog-dependent |
| **MED-04** | chat | Floor plan / layout ask while focused | Media or honest missing; no project switch | NEED |

### B. Sudden budget / location change

| ID | Channel | Scenario | Pass if | Status |
|----|---------|----------|---------|--------|
| **PIV-01** | chat | Shortlist North Bangalore → `actually my budget is only 50L` | Re-search / refine; does not invent focus; no Buena Vista noise | NEED (related: BUYER-BRG-02) |
| **PIV-02** | chat | Focused Eldorado → `wait I meant Whitefield not Devanahalli` | Location broaden / release or re-list; does not keep wrong micro-market as fact | NEED |
| **PIV-03** | chat | Discover → `change to 2BHK under 70L` mid-list | New shortlist scoped; not visit hijack | HAVE-ish UE-04 / BUYER-BRG-02 — re-run |
| **PIV-04** | advisor | Matches → chip `Adjust budget` / `Change area` | Brief refine path; board matches | NEED (pairs Advisor #13) |

### C. Rapid / many project switches

| ID | Channel | Scenario | Pass if | Status |
|----|---------|----------|---------|--------|
| **SW-01** | chat | A → B → C → A in 4 turns (`what about X`) | Each turn commits/answers correct project; discussed accumulates | NEED (extend V06) |
| **SW-02** | chat | Focused facet on A → `what about B pricing` | Switch + price on B (not A leftover) | NEED |
| **SW-03** | chat | 6 rapid switches then `compare both` | Compare uses **last two discussed**, not stale shortlist | NEED |
| **SW-04** | advisor | Board project hops via chips | `nba.board_project_id` tracks focus | NEED |

### D. Multi-visit planning (origin + sequencing)

| ID | Channel | Scenario | Pass if | Status |
|----|---------|----------|---------|--------|
| **VIS-01** | chat | Discuss A+B → `come for the visit` | Multi-stop seed; asks origin / day — not “which project?” | HAVE SA-G02 / BUYER-LOK-02 — **re-soak** |
| **VIS-02** | chat | After VIS-01 → `I'm coming from Whitefield` | Sequence nearer-first; names both stops | NEED (visit-route UAT partial) |
| **VIS-03** | chat | Book stop 1 → `add Eldorado same day` | Queue expands; no recall hijack | NEED (V02 backlog) |
| **VIS-04** | chat | `my visits` with nothing booked | Recall empty — not book flow | HAVE SA-G02b |
| **VIS-05** | advisor | Plan visit day from board | `visit_itinerary` / queue sync with chat | NEED |

### E. Interaction style — small talk / oversharing

| ID | Channel | Scenario | Pass if | Status |
|----|---------|----------|---------|--------|
| **STY-01** | chat | `hi how are you` then brief | Greet/smalltalk then orient — not no_fit | NEED |
| **STY-02** | chat | Long dump: family, school, WFH, budget, area in one message | Extracts slots; shortlist or probe — not ignore half | NEED |
| **STY-03** | chat | `ok thanks` / `hmm` mid-focused | Stays focused; no random project invent | NEED |
| **STY-04** | chat | Joke / off-topic then `anyway Eldorado price` | Recovers to price on Eldorado | NEED (soft: gibberish recovery was weak) |

### F. Expert vs novice buyer

| ID | Channel | Scenario | Pass if | Status |
|----|---------|----------|---------|--------|
| **EXP-01** | chat | Expert: RERA, EC, banks, BSP, floor rise, LTV in sequence | Facet answers; no visit hijack; stays on project | HAVE ADV-F01 / MEM-G01 — **re-soak** |
| **EXP-02** | chat | Expert: `per sqft` + `maintenance corpus` + `payment plan` | Price/honest defer — not invent payment_plan tool | NEED |
| **NOV-01** | chat | Novice: `something nice near airport under 1cr` | Soft shortlist or clarify — not empty no_fit | NEED |
| **NOV-02** | chat | Novice: only `Eldorado?` then `ok` then `visit?` | Gentle commit → visit ask | NEED |
| **NOV-03** | chat | Novice: `send pics` with no focus | Clarify which project — not random brochure | NEED |

### G. Hinglish / code-mix

| ID | Channel | Scenario | Pass if | Status |
|----|---------|----------|---------|--------|
| **HIN-01** | chat | CTA → `haan` | Stays on project pricing | HAVE |
| **HIN-02** | chat | CTA → `yeah sure` / `theek hai` | Same | HAVE |
| **HIN-03** | chat | `price batao` / `kitna padega` while focused | Price answer | HAVE (`price kitna hai`) |
| **HIN-04** | chat | `visit karna hai Saturday` | Visit book path | HAVE |
| **HIN-05** | chat | `dono compare karo` after A+B | Compare discussed pair | HAVE |
| **HIN-06** | chat | `nahi chahiye` after CTA | Stay focused — not no_fit apartment | HAVE |

### H. Regression anchors (keep green)

| ID | Status |
|----|--------|
| SA-G01…G03, SA-LEGAL, SA-CLARIFY-PICK | HAVE |
| ADV-F01, ADV-H01–H05, ADV-BAML-01 | HAVE |
| RTI-G02, MEM-G01, UE-01…05 | HAVE |
| V01, V04, V06 | HAVE |
| P7-G01, P7-G02 (Advisor) | HAVE (smoke script) |
| BUYER-LOK-01/02, BUYER-BRG-01/02 | HAVE |

---

## Suggested run order (when you say go)

1. **H** regression pack (existing JSON) — baseline score  
2. **A** media (MED-01…04) — you asked explicitly  
3. **B** pivots (PIV-01…04)  
4. **C** switch spam (SW-01…04)  
5. **D** multi-visit (VIS-01…05)  
6. **E + F + G** style / expertise / Hinglish  

Channel: run **chat** first (`/chat` on Dev), then **Advisor** for rows marked advisor / P7.

---

## Bottom line

- **Not** claiming top-notch overall today.  
- Claiming: **closed known breaks + goldens we re-ran are green**.  
- Gaps you listed (media emit, pivots, switch spam, multi-visit depth, styles, Hinglish breadth) are in the matrix above as **NEED** / re-soak.

Say **go** (or pick a section A–G) and we implement missing JSON + run against Dev.
