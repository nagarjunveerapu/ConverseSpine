# Buyer scenarios (functional / recorded)

JSON definitions in `buyer/` are multi-turn scripts that mimic real buyers.

## Run

```bash
# Spine must be up (remote NayaDesk bindings recommended)
cd ConverseSpine && npm run dev   # :8789

npx tsx scripts/run-buyer-scenarios.ts
npx tsx scripts/run-buyer-scenarios.ts --only SA-G01,BUYER-LOK-01
```

Each run writes under `runs/<timestamp>/`:

- `README.md` — pass/fail index
- `<id>.md` — human-readable transcript
- `<id>.json` — machine record (asserts + replies)
- `summary.json` — aggregate

Use those transcripts as the functional baseline — not Vitest unit counts.
