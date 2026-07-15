# corpus/ — the semantic intent registry

Two files, one rule: **the registry is the source, the index is a build artifact.**

| File | What it is | Rebuild reads it? |
|---|---|---|
| `recovered-raw.jsonl` | Immutable provenance — the untouched dump of the 13,555 seeded vectors. Reproduce with `scripts/vectorize-dump-registry.py`. | No |
| `intent-registry.jsonl` | The registry = raw rows **tagged** with `quarantine` / `audit_status`. This is the audit worklist and the eventual rebuild source. | Only rows where `audit_status=='clean' && !quarantine` |

**The recovered corpus is NOT safe to rebuild from as-is.** It carries P5 place/builder
tokens, unmapped intent_kinds that mask mapped intents, and hard-negatives the runtime
would bind as positives. So every recovered row is `audit_status: "unaudited"` and
quarantine-tagged; the rebuild-eligible set is **0 rows today, by design** (S1b gate).
Reviving the raw corpus at full throttle is a regression machine — this is the guard.

## Provenance

Recovered 2026-07-15 by dumping all 13,555 vectors of `naya-intent-phrasings-dev`
(`scripts/vectorize-dump-registry.py`). The corpus had been seeded out-of-band
(~2026-06-08→20, no seeder ever in git) and served zero queries until SIL Phase 0.
`scripts/tag-registry-quarantine.py` produces `intent-registry.jsonl` from the raw dump.

## Row shape

```json
{"id": "ph_…", "phrasing": "namaste, koi legal issue toh nahi",
 "intent_kind": "get_legal_info", "language": "hi-en",
 "is_negative": false, "hard_negative_for": "", "source": "corpus_v2",
 "quarantine": true, "quarantine_reasons": ["unmapped_kind"], "audit_status": "unaudited"}
```

## Census at recovery (audit 2026-07-15)

| Measure | Value |
|---|---|
| Rows | 13,555 (en 9,436 · hi-en 4,119 — 30.4% Hinglish) |
| Distinct `intent_kind` | 30 (Naya's legacy 30-intent taxonomy) |
| Kinds mapped by the runtime (`embedder-map.ts`) | 19 → 10,774 rows (79.5%) |
| Kinds INVISIBLE to routing | 11 → 2,781 rows (20.5%) — e.g. `confirm_action` 354, `request_callback` 334, `provide_qualification` 317, `express_objection` 315, `opt_out` 210 |
| P5 contamination (other-builder or locality tokens in phrasing) | 4,764 rows (35.1%) — builders 15.0%, localities 24.3% |
| `builder_scope` set | **0 rows** — the runtime's builder-scoped query always returns empty |
| Negative rows (`is_negative`) | 94 (with `hard_negative_for`) — the runtime does not read this field |
| Sources | corpus_v2 13,123 · retroactive_mined 244 · embedding_gap_batch_1 188 |
| **Quarantined** (unmapped_kind ∪ hard_negative ∪ P5 place/builder token) | **7,635 rows (56.3%)** — excluded from rebuild until audited |
| Rebuild-eligible today | **0** — no row is `audit_status=='clean'` yet |

## S1b exit gate (before always-on, LLD §4.2)

The rebuild source must reach: unmapped-kind share **< 2%**, P5 contamination **< 5%**
on kept rows, `builder_scope` strategy implemented (real scopes or global-only,
documented), `is_negative` read-or-stripped at runtime, per-kind precision audited
with floor `min(20, n)` and sub-floor kinds killed/relabeled. Until then the quarantine
holds and S2 (always-on) is blocked.

Known label defects (per-kind stratified audit pending, LLD §4.2): invisible kinds
win nearest-neighbor and mask mapped kinds (measured: "what return can I expect?"
→ `provide_qualification` by a 0.00008 margin over #2); `ask_about_builder` rows
name competitor builders.

## Registry v2 (2026-07-15, PR #88)

`scripts/registry-v2.py` regenerates the registry as a pure function of the S1a-tagged
file + `BOUNDARY_RULEBOOK.md` + `mask-vocab.json` (Desk D1 areas/projects ∪
`gazetteer-seed.json`). Fields added per row:

| Field | Meaning |
|---|---|
| `canonical` | masked embed text (`<builder>`/`<place>`/`<project>`, lowercased) — the ONLY text ever embedded; numbers/BHK kept (intent signal) |
| `pattern_key` / `pattern_id` | stricter mask (numbers → `<n>`) → dedup group; 13,555 rows ≈ 5.9k patterns |
| `eval_split` | `train` \| `holdout` — **pattern-level** stratified split (seed 42). Holdout rows are NEVER embedded; they are the frozen gate. |
| `routable` | mapped 19 kinds + founder-approved action kinds (`opt_out`, `escalate_to_human`, `request_callback`, `report_issue`, `status_check`) |
| `relabel_reason` | audit trail for every rulebook move (259 R1–R5 + 6 R7) |
| `audit_status` | `machine_v2` — **rebuild still requires `clean`**; eligibility flips only with the action-kind engine PR + a measured gate |

v2 census: quarantine 56.3% → **13.0%** (P5 token quarantine retired — canonicalization
owns entities; hard-negatives + still-unmapped kinds remain). Contradicted patterns among
servable rows: 33 → **0** (rulebook R1–R7; residuals are quarantined `boundary_contradiction`
and hand-queued — majority NEVER decides; see PR #88 review).

Held-out gate (remote bge-base + nn1 + canonical, frozen split): route accuracy
**83.2% all / 82.2 en / 85.6 hi** vs pre-v2 masked baseline 80.5/78.5/84.6.
This is an offline nearest-neighbor gate on the canonical train index — NOT a claim
about S2/live buyer quality (192-Q measures that, separately, at each engine stage).

## Rules

- Every change lands via PR — labels are buyer-routing decisions, they get eyes.
- Dedupe by `pattern_id` (and cosine ≥ 0.95) against existing rows before appending.
- No place/project facts in phrasings (P5) — the masker canonicalizes; new rows must still be generic.
- Fixes for misunderstood phrasings go HERE, never into understanding regexes (P7).
- Label boundaries are decided by `BOUNDARY_RULEBOOK.md` (where the Desk answer lives) — never by majority vote.
