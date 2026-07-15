"""Tag recovered rows for the S1b audit gate (SEMANTIC_INTENT_LAYER_LLD §4.2, P5).

The recovered corpus is NOT safe to rebuild from — it carries place/builder tokens
(P5), unmapped intent_kinds that mask mapped intents, and hard-negatives the runtime
would bind as positives. This tags every row so the rebuild consumes ONLY audited,
non-quarantined rows. Until S1b audit sets audit_status='clean', that set is empty
by design: reviving the raw corpus at full throttle is a regression machine.

    python3 scripts/tag-registry-quarantine.py corpus/recovered-raw.jsonl corpus/intent-registry.jsonl
"""
import json, re, sys

# the 19 intent_kinds embedder-map.ts can actually route
MAPPED = {
    "get_price","get_legal_info","get_availability","get_unit_configs","get_brochure",
    "get_media","get_amenities","get_location_info","ask_delivery_timeline","get_project_info",
    "ask_about_builder","compute_emi","get_payment_plan","negotiate_price","ask_investment_return",
    "book_visit","compare_projects","find_projects","recommend",
}
# P5 — the corpus must carry phrasings, never place/builder facts. These tokens
# steer nearest-neighbour toward wrong-locality / wrong-builder intents.
BUILDERS = re.compile(r"\b(prestige|sobha|embassy|provident|mantri|salarpuria|godrej|puravankara|shriram|casagrand|lodha|dlf|tata|birla|adarsh|rohan|purva|brigade|century|sattva)\b", re.I)
PLACES = re.compile(r"\b(whitefield|sarjapur|hennur|yelahanka|marathahalli|jp nagar|budigere|bagalur|electronic city|hebbal|jakkur|kanakapura|devanahalli|hsr|koramangala|indiranagar|bellandur|varthur|hoskote|mysore|mysuru|banashankari|kondapur|gunjur|coorg|sakleshpur)\b", re.I)

def quarantine_reasons(r):
    reasons = []
    ph = r.get("phrasing", "")
    if r.get("intent_kind") not in MAPPED:
        reasons.append("unmapped_kind")
    if r.get("is_negative"):
        reasons.append("hard_negative")
    if BUILDERS.search(ph):
        reasons.append("p5_builder_token")
    if PLACES.search(ph):
        reasons.append("p5_place_token")
    return reasons

def main():
    src, out = sys.argv[1], sys.argv[2]
    rows = [json.loads(l) for l in open(src)]
    q = 0
    with open(out, "w") as f:
        for r in rows:
            reasons = quarantine_reasons(r)
            r["quarantine"] = bool(reasons)
            r["quarantine_reasons"] = reasons
            r["audit_status"] = "unaudited"  # S1b hand-audit flips clean rows to 'clean'
            if reasons:
                q += 1
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    clean_now = sum(1 for r in rows if not quarantine_reasons(r))
    print(f"{len(rows)} rows -> {out}")
    print(f"quarantined: {q} ({100*q/len(rows):.1f}%) | not-quarantined but still unaudited: {clean_now}")
    print("rebuild-eligible today (audit_status=='clean' && !quarantine): 0 — S1b gate")

if __name__ == "__main__":
    main()
