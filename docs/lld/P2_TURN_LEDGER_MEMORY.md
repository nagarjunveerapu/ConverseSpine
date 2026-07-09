# P2 — Turn ledger memory loop

Companion to [`CONSOLIDATED_ROADMAP.md`](../CONSOLIDATED_ROADMAP.md) §P2.

## Status

| Slice | Deliverable | Status |
|-------|-------------|--------|
| **P2a** | Write full ledger row (`speech_act`, snapshot, action_plan) | ✅ `ledger-write.ts` |
| **P2b** | Read `prior` → `TurnFeedForward` (gap-fill) | ✅ `ledger-read.ts` + Desk `/context` widen |
| **P2c** | Compose consumes prior + `disclosed_facts` | ✅ this doc |

## Data flow

```text
turn N end:
  extractDisclosedFacts(goal, evidence)
  → appendTurnLedger(disclosed_facts, …)
  → state.disclosedFacts accum (KV)

turn N+1 start:
  bootstrapContext → ledger.prior
  → mapLedgerPrior → TurnFeedForward
  → hydrate rti / focus (gap-only)
  → merge disclosed into state.disclosedFacts

compose:
  PRIOR CONTEXT block (topics, excerpt, disclosed)
  legal templates: skip RERA if already disclosed; banks/EC facet from buyerText
```

## Invariants

1. **Live KV wins** over ledger for `pendingPrompt` / focus.
2. **Disclosed facts** come from structured evidence, not reply regex.
3. **MEM-G01**: after a legal answer, `"what banks approved?"` must not re-open as a generic project snapshot.

## Not in P2c

- `stamp_prior` (accepted/rejected loop-closure)
- P3 facet extractors / evidence slicing
- Early-exit ledger rows
