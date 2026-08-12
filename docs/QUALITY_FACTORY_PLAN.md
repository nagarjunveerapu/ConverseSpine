# Quality factory — chat → ~9/10

**Started:** 2026-08-12  
**Scope:** Chat-first, dig goldens; Advisor smoke only until chat exit.  
**No architecture rewrite.** Rails: extract → decide → evidence → compose → verify.

Full stage book: Cursor plan `chat_quality_to_nine`. This file is the living ops log.

## North-star (11 params)

| Parameter | Baseline 2026-08-12 | Week 8 |
|-----------|---------------------|--------|
| First impression | 6 | 8 |
| Understanding intent | 5 | 8 |
| Recommendations / search | 6.5 | 9 |
| Geo / market honesty | 3.5 | 8 |
| Pricing & catalog grounding | 6 | 9 |
| Trust questions | 5 | 8 |
| Objection handling | 4 | 7 |
| Escalation / handoff | 5 | 7 |
| Conversation memory | 4.5 | 8 |
| Tone & naturalness | 7 | 8 |
| Adversarial robustness | 3.5 | 7 |
| **Overall** | **~5.5** | **~8.5** |

## Dual gate (every dialogue PR)

1. Structural: `npm run test:scenarios` / `run-buyer-scenarios.ts --only <ids>`
2. Quality: no `assert✓ quality✗` on exercised params
3. See [`docs/reports/quality-factory-2026-08-12/DUAL_GATE.md`](./reports/quality-factory-2026-08-12/DUAL_GATE.md) and [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## Stage log

| Stage | Status | Artifacts / evidence |
|-------|--------|----------------------|
| 0 Baseline | ✅ | `baseline-scorecard.json` + HTML |
| 1 Fact parity | ✅ | `answerability.json/html`; possession atom over FAQ miss; charges-on-file header |
| 2 Probe UX | ✅ | `briefAckPrefix` / `firstMissingProbeSlot`; DISC-01…06 |
| 3 Compose completeness | ✅ | `compose-completeness.md`; PACKED-01/02 |
| 4 Focus memory | ✅ | CHAOS-02 + SW/PIV/NAME sample green |
| 5 Chaos teach | ✅ | `CHAOS-pack.json` dual-gate |
| 6 Geo honesty | ✅ | outside-served distance gate; GEO-01/02 |
| 7 Objection/handoff | ✅ | playbook alias match; handoff phone latch; OBJ-01/02 |
| 8 Ops + Advisor smoke | ✅ | week-8 scorecard; `run-advisor-smoke.ts`; CONTRIBUTING dual-gate |

## Dig goldens (scope freeze)

Eldorado, Orchards, Buena Vista, Meadows, Cornerstone Utopia, Oasis, Ayana, Krishnaja + thin controls Earth Aroma, Hillside.

## Latest dual-gate pack

`scenarios/runs/2026-08-12T08-04-07-556Z` — 21/21 structural (DISC/CHAOS/GEO/OBJ/PACKED/SW/PIV/NAME).
