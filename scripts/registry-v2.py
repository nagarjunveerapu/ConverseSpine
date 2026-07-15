"""Registry v2 — relabel (BOUNDARY_RULEBOOK.md), canonicalize, split.

Transforms corpus/intent-registry.jsonl in place (v2 fields added, raw phrasing
untouched — provenance preserved):

  canonical        masked embed text: builders/places/projects -> <builder>/<place>/<project>,
                   lowercased, whitespace-normalized. NUMBERS/BHK KEPT (intent signal —
                   the masked config that won bake-off v4 kept them).
  pattern_key      stricter mask for dedup grouping (numbers also -> <n>)
  pattern_id       stable hash of (intent_kind, pattern_key)
  eval_split       'train' | 'holdout' — stratified per intent_kind at PATTERN level
                   (all rows of a held-out pattern go to holdout; clones can never
                   leak across the split). Seed=42, frozen. Holdout is NEVER embedded.
  routable         founder 2026-07-15: action kinds are routable
  relabel_reason   set when a rulebook rule moved the row (auditable)
  audit_status     'machine_v2' for rule-passed rows (pipeline eligibility still
                   requires 'clean' — flipping that gate is a separate, measured step)

Quarantine recompute: p5 entity-token reasons are DROPPED (canonicalization now
handles entities — that was the quarantine's job); hard_negative and (still-)
unmapped_kind remain.

    python3 scripts/registry-v2.py
"""
import json, random, re, hashlib
from collections import defaultdict
from pathlib import Path

REG = Path("corpus/intent-registry.jsonl")
VOCAB = Path("corpus/mask-vocab.json")

ROUTABLE_ACTION_KINDS = {"opt_out", "escalate_to_human", "request_callback", "report_issue", "status_check"}
MAPPED = {
    "get_price","get_legal_info","get_availability","get_unit_configs","get_brochure",
    "get_media","get_amenities","get_location_info","ask_delivery_timeline","get_project_info",
    "ask_about_builder","compute_emi","get_payment_plan","negotiate_price","ask_investment_return",
    "book_visit","compare_projects","find_projects","recommend",
}
HOLDOUT_FRAC = 0.15
SEED = 42

# ── masking ──────────────────────────────────────────────────────────────────
vocab = json.load(open(VOCAB))
def _rx(terms):
    # longest-first so "sarjapur road" wins over "sarjapur"
    parts = sorted((re.escape(t) for t in terms if t), key=len, reverse=True)
    return re.compile(r"\b(" + "|".join(parts) + r")\b", re.I) if parts else None

RX_PROJECT = _rx(vocab["projects"])
RX_BUILDER = _rx(vocab["builders"])
RX_PLACE = _rx(vocab["places"])
RX_NUM = re.compile(r"\b\d+(\.\d+)?\b")
RX_WS = re.compile(r"\s+")

def canonical(text: str) -> str:
    t = text
    if RX_PROJECT: t = RX_PROJECT.sub("<project>", t)
    if RX_BUILDER: t = RX_BUILDER.sub("<builder>", t)
    if RX_PLACE: t = RX_PLACE.sub("<place>", t)
    return RX_WS.sub(" ", t).strip().lower()

def pattern_key(canon: str) -> str:
    return RX_WS.sub(" ", RX_NUM.sub("<n>", canon)).strip()

def pattern_id(kind: str, pkey: str) -> str:
    return "pt_" + hashlib.sha1(f"{kind}\x00{pkey}".encode()).hexdigest()[:12]

# ── rulebook (mechanical form of BOUNDARY_RULEBOOK.md) ──────────────────────
# Plural-tolerant: review of PR #88 caught "schools near X" slipping past a
# singular-only regex, after which a majority fallback flipped labels AGAINST
# R1. Rules must cover the morphology; residuals go to the hand queue.
PROXIMITY = re.compile(r"\b(schools?|hospitals?|colleges?|universit(?:y|ies)|metro|airports?|stations?|tech parks?|it parks?|distance|how far|kitna door|se door|se project|well connected|connectivity|waterlog\w*|flood\w*|which part|directions?|reach|commute)\b", re.I)
IN_PROJECT = re.compile(r"\b(gyms?|pools?|swimming|clubhouses?|club house|party halls?|jogging|play areas?|security|cctv|parking|lifts?|power backup|gated|amphitheatres?|badminton|tennis|sports)\b", re.I)
INVEST = re.compile(r"\b(appreciation|rental yields?|rental income|roi|investments?|returns?|resale values?|badhegi|grow)\b", re.I)
DISCOVER_BUDGET = re.compile(r"\b(options?|what .*can i get|kya milega|show me|milega kya|anything|projects?)\b.*\b(under|below|within|budget|lakh|crore|l\b|cr\b)|\b(under|below|within|tak)\b.*\b(lakh|crore)\b.*\b(options?|kya milega|milega)\b|\b(lakh|crore)\b.*\btak\b.*\bmilega\b", re.I)
VS = re.compile(r"\b(vs|versus)\b|\bor\b.{0,24}\b(better|which|recommend|kaun|konsa)\b|\b(better|kaun|konsa)\b.{0,24}\bya\b|\bcompare\b|\bfark\b|\bdifference between\b", re.I)
PAYMENT = re.compile(r"\b(payments?|milestones?|clp|subvention|booking amount|upfront|instal?lments?|pre-?emi|schedule of payments?|paise kab|kitna dena)\b", re.I)

def apply_rules(kind: str, text: str):
    """Return (new_kind, reason) or None."""
    # R2 before R1: investment words win over place mentions
    if kind in ("get_location_info", "get_amenities") and INVEST.search(text):
        return "ask_investment_return", "R2_invest_over_location"
    # R1: evidence split location vs amenities
    if kind == "get_amenities" and PROXIMITY.search(text) and not IN_PROJECT.search(text):
        return "get_location_info", "R1_proximity_is_location"
    if kind == "get_location_info" and IN_PROJECT.search(text) and not PROXIMITY.search(text):
        return "get_amenities", "R1_facility_is_amenities"
    # R3: budget-filter discovery
    if kind == "get_price" and DISCOVER_BUDGET.search(text):
        return "find_projects", "R3_budget_filter_is_discovery"
    # R4: comparison framing
    if kind == "get_project_info" and VS.search(text):
        return "compare_projects", "R4_vs_is_compare"
    # R5: money wins over construction words
    if kind == "ask_delivery_timeline" and PAYMENT.search(text):
        return "get_payment_plan", "R5_payment_over_timeline"
    return None

# ── run ──────────────────────────────────────────────────────────────────────
rows = [json.loads(l) for l in open(REG)]
relabeled = defaultdict(int)
for r in rows:
    ph = r.get("phrasing", "")
    hit = apply_rules(r.get("intent_kind", ""), ph)
    if hit and not r.get("is_negative"):
        new_kind, reason = hit
        r["relabel_reason"] = f"{reason}:{r['intent_kind']}->{new_kind}"
        relabeled[reason] += 1
        r["intent_kind"] = new_kind

    r["canonical"] = canonical(ph)
    pk = pattern_key(r["canonical"])
    r["pattern_key"] = pk
    r["pattern_id"] = pattern_id(r["intent_kind"], pk)
    r["routable"] = r["intent_kind"] in MAPPED or r["intent_kind"] in ROUTABLE_ACTION_KINDS

    # quarantine recompute — canonicalization replaces the p5 token quarantine
    reasons = [x for x in r.get("quarantine_reasons", []) if not x.startswith("p5_")]
    if r["intent_kind"] in ROUTABLE_ACTION_KINDS:
        reasons = [x for x in reasons if x != "unmapped_kind"]
    elif r["intent_kind"] not in MAPPED and "unmapped_kind" not in reasons:
        reasons.append("unmapped_kind")
    r["quarantine_reasons"] = reasons
    r["quarantine"] = bool(reasons)
    r["audit_status"] = "machine_v2"

# R7 — pattern-level adjudications (BOUNDARY_RULEBOOK R7: evidence-cited
# rulings for patterns R1-R6 can't reach; applied by pattern_key, auditable).
R7 = {
    "floor rise charges": "get_price",
    "gated community details": "get_amenities",
    "is there a clubhouse": "get_amenities",
    "location pin share karo": "get_location_info",
    "rera registration number": "get_legal_info",
    "what configurations are available": "get_availability",
}
r7_hits = 0
for r in rows:
    ruled = R7.get(r.get("pattern_key", ""))
    if ruled and not r.get("is_negative") and r["intent_kind"] != ruled:
        r["relabel_reason"] = f"R7_pattern_adjudication:{r['intent_kind']}->{ruled}"
        r["intent_kind"] = ruled
        r["pattern_id"] = pattern_id(ruled, r["pattern_key"])
        r7_hits += 1

# contradiction check AFTER relabel (gate: must be 0 among SERVABLE rows).
# Residual contradictions mean the rules were silent and the evidence is
# ambiguous — BOUNDARY_RULEBOOK: majority never decides. They go to the hand
# queue (quarantined), never silently overwritten. (PR #88 review blocker:
# a majority fallback here flipped "schools near <place>" AGAINST R1.)
pat_kinds = defaultdict(set)
for r in rows:
    if not r.get("is_negative") and r["routable"]:
        pat_kinds[r["pattern_key"]].add(r["intent_kind"])
contra = {p: k for p, k in pat_kinds.items() if len(k) > 1}
leftover_quarantined = 0
for r in rows:
    pk = r.get("pattern_key")
    if not r.get("is_negative") and r["routable"] and pk in contra:
        if "boundary_contradiction" not in r.get("quarantine_reasons", []):
            r.setdefault("quarantine_reasons", []).append("boundary_contradiction")
        r["quarantine"] = True
        leftover_quarantined += 1

# eval split — pattern-level, stratified per kind, frozen seed
random.seed(SEED)
by_kind_patterns = defaultdict(set)
for r in rows:
    if not r.get("is_negative"):
        by_kind_patterns[r["intent_kind"]].add(r["pattern_key"])
holdout_patterns = set()
for k, pats in by_kind_patterns.items():
    pats = sorted(pats)
    random.shuffle(pats)
    n_hold = max(3, int(len(pats) * HOLDOUT_FRAC)) if len(pats) >= 10 else max(1, len(pats) // 5)
    holdout_patterns |= {(k, p) for p in pats[:n_hold]}
for r in rows:
    r["eval_split"] = "holdout" if (r["intent_kind"], r.get("pattern_key")) in holdout_patterns else "train"

Path(REG).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")

# report
n_hold = sum(1 for r in rows if r["eval_split"] == "holdout")
n_q = sum(1 for r in rows if r["quarantine"])
print(f"rows: {len(rows)}  relabeled: {sum(relabeled.values())}  R7 adjudicated: {r7_hits}  hand-queue quarantined: {leftover_quarantined}")
for reason, n in sorted(relabeled.items(), key=lambda x: -x[1]):
    print(f"  {reason}: {n}")
print(f"holdout rows: {n_hold} ({100*n_hold/len(rows):.1f}%)  quarantined now: {n_q} ({100*n_q/len(rows):.1f}%)")
if contra:
    print(f"HAND QUEUE — {len(contra)} patterns where rules are silent (adjudicate in BOUNDARY_RULEBOOK, then re-run):")
    for p, kinds in sorted(contra.items()):
        print(f"  '{p[:64]}' kinds={sorted(kinds)}")
# gate: contradictions among SERVABLE (routable, non-quarantined) rows must be 0
pat_kinds2 = defaultdict(set)
for r in rows:
    if not r.get("is_negative") and r["routable"] and not r["quarantine"]:
        pat_kinds2[r["pattern_key"]].add(r["intent_kind"])
c2 = sum(1 for k in pat_kinds2.values() if len(k) > 1)
print(f"servable contradictions after v2: {c2} (gate: 0)")
