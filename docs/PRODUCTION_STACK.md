# ConverseSpine — Production Stack

**Status:** v0.2 — new bot project (replaces Naya conversational layer over time)  
**CRM:** NayaDesk (unchanged)  
**Runtime:** Cloudflare Workers  

---

## Architecture

```text
WhatsApp / HTTP POST /chat
         │
         ▼
┌────────────────────────────────────────────────────────────┐
│  ConverseSpine Worker (src/index.ts)                        │
│                                                             │
│  1. SNAPSHOT    buildMemory ← NayaDesk conversation-context │
│  2. UNDERSTAND  regex + Vectorize embedder + DeepSeek classify │
│  3. DECIDE      pure rules → ONE composer + tool_plan       │
│  4. ACT         tools → NayaDesk search/pricing/leads       │
│  5. COMPOSE     Handlebars OR LlmComposer (llm lane only)   │
│  6. VERIFY      grounding gate (₹L amounts vs tool evidence)  │
│  7. PERSIST     messages + turn_ledger + state-writes       │
│  8. TRACE       Langfuse (optional, waitUntil)                │
└────────────────────────────────────────────────────────────┘
         │
         ▼
    NayaDesk (D1) — leads, catalog, disclosure, ledger
```

---

## Stack map

| Layer | Technology | Notes |
|-------|------------|-------|
| **Runtime** | Cloudflare Workers | `wrangler.toml`, `nodejs_compat` for Handlebars |
| **CRM** | NayaDesk service binding | `NAYADESK` + `NAYADESK_URL` fallback |
| **Cache** | KV `TURN_CACHE` | Conversation bundle (future) |
| **Intent vectors** | Vectorize `INTENT_VECTORS` | Same index as Naya |
| **Embeddings** | Workers AI `@cf/baai/bge-base-en-v1.5` | Query-time embed |
| **Classifier** | DeepSeek JSON mode | Merges with regex intents |
| **Compose (structured)** | Handlebars templates | list, pricing, visit, legal, objection |
| **Compose (open)** | DeepSeek chat | Only when `composer: 'llm'` |
| **Subgraphs** | Plain TS (`src/graphs/`) | Visit + objection state machines |
| **Observability** | Langfuse HTTP ingest | Optional keys in secrets |
| **Tests** | Vitest | `tests/spine.test.ts` + scripted demo |

**Not in v0.2 (planned):** WhatsApp webhook, Queues, multi-stop visit plan engine, RAG brochure index.

---

## Project layout

```text
src/
  index.ts              Worker entry
  env.ts                Binding types
  worker/routes.ts      /health, /chat
  runtime/deps.ts       TurnRuntime wiring
  crm/                  NayaDesk client + repository
  nlu/                  extractors, classifier, embedder, pipeline
  turn/                 run-turn, decide
  tools/                NayaDesk-backed tool registry
  compose/              templates + grounding
  llm/                  LlmComposer (open turns)
  graphs/               visit + objection subgraphs
  observability/        Langfuse
  cli.ts                Local interactive demo
```

---

## Local development

**Terminal 1 — NayaDesk:**
```bash
cd ../NayaDesk && npx wrangler dev --port 8787
```

**Terminal 2 — ConverseSpine Worker:**
```bash
cp .dev.vars.example .dev.vars   # fill BOT_SHARED_SECRET + DEEPSEEK_API_KEY
npm install
npm run dev                      # http://localhost:8788 (wrangler picks port)
```

**Terminal 3 — CLI demo (Node, no Worker):**
```bash
npm run demo
npm run script
```

**HTTP chat:**
```bash
curl -s http://localhost:8788/chat -H 'content-type: application/json' -d '{
  "builder_id": "lokations",
  "buyer_phone": "+919990000099",
  "text": "hi"
}'
```

---

## Deploy

```bash
# Secrets (once per env)
wrangler secret put BOT_SHARED_SECRET --env prod
wrangler secret put DEEPSEEK_API_KEY --env prod
wrangler secret put LANGFUSE_PUBLIC_KEY --env prod   # optional
wrangler secret put LANGFUSE_SECRET_KEY --env prod   # optional

npm run deploy:prod
```

Point NayaDesk `NAYA_BOT_URL` (or service binding) at the new Worker when ready to cut over WhatsApp.

---

## Composer matrix

| Intent shape | Composer | Tool(s) |
|--------------|----------|---------|
| Greeting only | `template:greeting` | — |
| find_projects / enough slots | `template:list` | search_projects |
| get_price + project | `template:pricing` | give_pricing |
| book_visit | `template:visit_confirm` or `visit_ask_day` | propose_visit |
| confirm + pending visit | `template:visit_confirm` | confirm_visit |
| get_legal_info | `template:legal` | lookup_project |
| express_objection | `template:objection` | — |
| get_project_info | `llm` | lookup_project |
| other nuanced | `llm` | varies |

---

## Relation to legacy Naya

| Legacy Naya | ConverseSpine |
|-------------|---------------|
| orchestrator + kernel + machine pipeline | **single** `runTurn()` |
| Brain default composer | Templates default for structured turns |
| 26 trace layers | 8 explicit stages |
| Feature flags | No engine flags |

NayaDesk, D1 catalog, disclosure engine, and admin UI are **shared** — only the bot Worker is new.

---

## Phase roadmap

| Phase | Deliverable |
|-------|-------------|
| **0.2** | Worker + NLU + templates + Langfuse + **dynamic quality eval** |
| **0.3** | WhatsApp webhook + TurnDebouncer DO + BPE egress + KV cache |
| **0.4** | Quality eval in CI gate (not golden regression) |
| **0.5** | Cutover lokations prod traffic; retire Naya bot path |
| **1.0** | Multi-builder, BSP, full BPE parity |

---

## Quality evaluation (replaces golden regression)

No fixed scenario asserts. Each run generates fresh buyer personas and judges conversation quality:

```bash
EVAL_COUNT=5 npm run eval:quality
```

1. **Personas** — random goal, budget, BHK, location, communication style  
2. **Buyer sim** — DeepSeek plays the buyer (scripted fallback without API key)  
3. **Live engine** — real NayaDesk CRM, real tools, real templates  
4. **Judge** — LLM scores completeness, grounding, tone, journey progress + heuristic flags  
5. **Report** — `eval-reports/<timestamp>/quality-report.html`  

Ship when you read the transcripts and scores look good — not when a pass count hits 29/29.
