# VIS multi-visit + misunderstand — use cases (teach vs policy)

**Dig teach status (2026-08-02):**  
See `PATTERNS.md` (natural + sabotage) and `upsert-items.jsonl` (~82 rows: ask-team, force, same/other day, choose-stops, book_visit, counter-intents).  
Upsert via `npx tsx scripts/upsert-intent-vectors.ts corpus/pending/visit-mv-teach/upsert-items.jsonl` → `upsert-result.json`.  
Working method: pattern bulk → append-only teach → ablation → then delete phrase holds.

---

## Lane split (golden rule)

| Job | Owner | Examples |
|-----|--------|----------|
| Understand open speech acts | **Embeddings / teach** | “ask sales if 6pm ok”, “cram all three Monday anyway” |
| Validate slots / hours / pack | **Deterministic visit.decide** | site hours, stagger math, origin placeability |
| Noise / smash / off-topic hold | **Placeability + contextual copy** | `asdfghjkl`, cricket smalltalk mid-origin |
| Prove | **VIS-MV** chat + Advisor | dig soak |

**Do not teach keyboard smash or cricket as intents** — that poisons nearest-neighbour. Hold + “I couldn’t make sense…” is policy/copy.

---

## A. Multi-visit scheduling (VIS-MV)

| ID | Use case (buyer job) | Critical phrasing | Teach kind? | Act (deterministic) | Prove |
|----|----------------------|-------------------|-------------|---------------------|-------|
| **MV-01** | 2-stop → book stop1 → **same day** stop2 stagger | `same day` | optional synonyms under itinerary / same-day choice (regex already strong) | stagger propose after booked | VIS-MV-01 |
| **MV-02** | Book stop1 → **different day** stop2 | `different day` | optional synonyms | clear day ask, no team | VIS-MV-02 |
| **MV-03** | 3 discussed → all → origin → **split-day offer** | `all of them` + origin | chooser deixis (existing) | split offer, not silent 3-book | VIS-MV-03 |
| **MV-04** | Split → **force same day** → firm + team overflow | `force all same day Monday` | **`visit_force_same_day`** ✅ candidates | `same_forced` pack + pending team | VIS-MV-04 |
| **MV-05** | Outside hours → reject / closest | `Monday 6pm` | no (clock + hours policy) | never firm-book 6pm | VIS-MV-05 |
| **MV-06** | Outside hours → **ask the team** | `ask the team for 6pm` | **`visit_ask_team`** ✅ candidates | pending team, not firm book | VIS-MV-06 |
| **MV-07** | Packed: projects+origin+day+time | one long utterance | no new kind (consume-before-ask) | bank slots, propose | VIS-MV-07 |
| **MV-08** | Mid-origin **noise** must not stamp place | `asdfghjkl qwerty`, cricket lol, `lmao ok fine` | **no teach** | placeability re-ask + contextual copy | VIS-MV-08 |
| **MV-09** | Digression → **same day for stop2** resume | `same day for Krishnaja` | optional `visit_same_day` synonyms; exit-hold is policy | stay in visit, stagger propose | VIS-MV-09 |
| **ADV-01** | After-hours → Hinglish ask-team | `sales se bol do after hours possible hai kya` | **`visit_ask_team`** | pending team, not firm | VIS-ADV-01 |
| **ADV-02** | Split → cram-force paraphrase | `cram all three into Monday anyway` | **`visit_force_same_day`** | same_forced pack + team | VIS-ADV-02 |
| **ADV-03** | Digression → usi-din resume | `usi din Krishnaja` | **`visit_same_day`** | stay in visit, stagger | VIS-ADV-03 |
| **ADV-04** | Chooser via dono | `dono` | **`visit_choose_stops`** / closed deixis | origin ask | VIS-ADV-04 |
| **ADV-05** | Discover smash sticky | `3dsfoisuardo` | **no teach** | clarify_intent sticky | VIS-ADV-05 |
| **ADV-06** | Origin + cricket smalltalk | cricket lol | **no teach** | placeability sticky | VIS-ADV-06 |
| **ADV-07** | Chooser via ye sab | `ye sab` | **`visit_choose_stops`** / closed deixis | origin ask | VIS-ADV-07 |
| **ADV-08** | Chooser via sab (3-stop) | `sab` | **`visit_choose_stops`** / closed deixis | origin ask | VIS-ADV-08 |

**V3 gate:** `tests/visit-mv-teach-gate.test.ts` — open kinds must have upsert rows + ablation.  
**V1:** same-day exit phrase hold removed; chooser closed set = both/dono/sab/ye sab/saare (+ Devanagari).

---

## B. Contextual misunderstand (new product ask)

When outstanding job is clear and buyer sends noise / off-topic, reply shape:

`I couldn't make sense of that` + **still helping with X** + concrete ask.

| Context | Outstanding job | Buyer noise | Expected re-anchor | Lane |
|---------|-----------------|-------------|--------------------|------|
| **B1 Visit · origin** | `lastAsk=origin` | smash / cricket | need starting area to sequence stops | placeability + copy (not teach) |
| **B2 Visit · day/time** | `lastAsk=day\|time` | filler | still picking day/time for *Project* | placeability-style gate + copy |
| **B3 Discover · requirements** | empty / asking budget·BHK·loc | `3dsfoisuardo` | help choose property — locality / budget / BHK | clarify copy keyed to missing slots (not generic rephrase) |
| **B4 Focused · facet** | last topic legal (or amenities, price, …) | smash | still on legal for *Project* — RERA/OC/… | topic-sticky clarify (not eject to unknown_request) |

---

## C. Teach batch to push next (after you approve this list)

**Batch A — must upsert (already drafted):**  
`corpus/pending/visit-mv-teach/upsert-items.jsonl` → kinds `visit_ask_team`, `visit_force_same_day`.

**Batch B — expand before upsert (recommended):** more open paraphrases for the same two kinds (Hinglish, “sales”, “host later”, “squeeze into one day”, …) — still those two `intent_kind`s only.

**Batch C — optional later:** richer same-day / different-day paraphrases if dig shows embed→commit drift; MV-09 fix is already policy (`shouldExitVisitForIntent` hold).

**Out of teach:** B1–B4 smash/smalltalk → copy work after teach A lands (or parallel).

---

## D. Upsert procedure (when approved)

```bash
# POST dig /internal/intent-vector  (secret = BOT_SHARED_SECRET)
# body: { "op": "upsert", "items": [ ... from upsert-items.jsonl ] }
# expect space like p256-… ; write result → upsert-result.json
# then re-soak VIS-MV-04 + VIS-MV-06 with embed path (not only regex fallback)
```

Single writer: ConverseSpine `upsertIntentVectors` (geometry + projection). Desk must not raw-upsert.
