# ConverseSpine architecture map

Visual reference for layers, classes, and turn flow. Complements [`CONVERSE_ENGINE.md`](./CONVERSE_ENGINE.md) (design invariants) and [`PRODUCTION_STACK.md`](./PRODUCTION_STACK.md) (deploy/bindings).

**Last updated:** 2026-07-08

---

## Authority model (regex vs embeddings vs LLM)

| Layer | Advisor web (`/api/advisor/turn`) | Free text (`/chat`, WhatsApp) |
|-------|-----------------------------------|-------------------------------|
| **Structured UI** | `preferences`, `project_id`, `action_id` — authority | N/A |
| **Regex / rules** | Wins when slots are filled | First pass — budget, BHK, topics, location, transition |
| **Embeddings** | Skip if `askTopics` / location already set | Gap-fill: intent Vectorize (≥0.72), location cosine (≥0.78) |
| **LLM signals** | Rare | `extractSignals` only for unfilled location/type/purpose/transition |
| **LLM compose** | Polish reply from evidence | Same — `fallbackReply` when deterministic or no API key |

**Conflict rule:** regex wins when confident. Embeddings/LLM fill gaps or break ties — they do not override gated regex hits (e.g. `isDetailAskTurn` blocking focus release).

---

## 1. Repo layers (bird's-eye)

```mermaid
mindmap
  root((ConverseSpine))
    Ingress
      index.ts
      worker/routes handleChat
      webhook/whatsapp
      advisor/handle-turn
      advisor/handle-brief-facets
      advisor/handle-project-detail
      chat-repl.ts CLI
    Runtime
      runtime/deps ConverseRuntime
      engine/ports EngineDeps
    Turn spine
      turn/run-turn
      engine/turn runEngineTurn
    Engine kernel
      facts extractFacts
      semantic-nlu enrich
      turn-routing classify
      turn-intent classify
      state applyExtracted
      phases discover focused visit handoff
      compose buildComposeRequest
      grounding checkGrounding
    Adapters
      adapters/nayadesk data+crm
      adapters/llm DeepSeek
      adapters/semantic-nlu AI+Vectorize
      store-kv TURN_CACHE
    Advisor adapter
      apply-preferences
      session sessionToConvId
      map-response
      map-visit-queue
      map-visit-itinerary
    External
      NayaDesk CRM+tools
      Workers AI embeddings
      Vectorize INTENT_VECTORS
      DeepSeek compose+signals
```

---

## 2. Channel ingress → same kernel

All channels converge on `runEngineTurn` in `src/engine/turn.ts`.

```mermaid
flowchart TB
  subgraph clients["Clients"]
    WA[WhatsApp Meta]
    WEB[NayaAdvisor React]
    CLI["npm run chat / curl"]
  end

  subgraph ingress["Ingress layer"]
    IDX["index.ts fetch()"]
    WH["webhook/whatsapp.ts"]
    HT["advisor/handle-turn.ts"]
    HC["worker/routes handleChat"]
    BF["advisor/handle-brief-facets"]
    PD["advisor/handle-project-detail"]
  end

  subgraph runtime["Runtime wiring"]
    RT["ConverseRuntime deps.ts"]
    ED["EngineDeps ports.ts"]
  end

  subgraph spine["Turn spine"]
    RUN["turn/run-turn.ts"]
    ENG["engine/turn.ts runEngineTurn"]
  end

  WA --> WH --> IDX
  WEB -->|"POST /api/advisor/turn"| HT
  WEB -->|"GET brief-facets / project"| BF
  WEB --> PD
  CLI -->|"POST /chat"| HC

  HT -->|"merge prefs, commit focus"| ENG
  HC --> RUN --> ENG
  WH --> RUN

  IDX --> RT
  RT --> ED
  ED --> ENG

  ENG --> MAP["advisor/map-response.ts"]
  MAP --> WEB
  ENG --> RUN
  RUN --> WA
  RUN --> CLI
```

### HTTP routes (`src/index.ts`)

| Route | Handler | Channel |
|-------|---------|---------|
| `POST /chat` | `worker/routes.handleChat` → `runTurn` | Dev REPL, curl, playground |
| `POST /api/advisor/turn` | `advisor/handle-turn` | NayaAdvisor web |
| `GET /api/advisor/brief-facets` | `advisor/handle-brief-facets` | Onboarding chips |
| `GET /api/advisor/project` | `advisor/handle-project-detail` | Project detail panel |
| `POST /webhook` | `webhook/whatsapp` → `runTurn` | WhatsApp |
| `GET /health` | `worker/routes.health` | Ops |

---

## 3. One turn inside `runEngineTurn` (layer stack)

```mermaid
flowchart TD
  START(["runEngineTurn input"]) --> LOAD["store.load → ConversationState"]
  LOAD --> BOOT["data.bootstrapContext returning buyer, transcript"]
  BOOT --> RTI{"turn-intent shouldRun?"}

  RTI -->|yes| RTI_C["turn-intent/classify.ts<br/>rules → llm-classifier"]
  RTI_C --> RTI_A["applyTurnIntentResult state.ts"]
  RTI_A -->|probe / chip / focus commit| EARLY["Early return compose probe"]
  RTI_A -->|continue| EX

  RTI -->|no| EX

  EX["facts.ts extractFacts<br/>REGEX authority"]
  EX --> LLM_SIG["adapters/llm extractSignals<br/>gaps only"]
  LLM_SIG --> SEM["semantic-nlu enrich<br/>embeddings backfill"]
  SEM --> APPLY["state applyExtracted"]
  APPLY --> GUARD["isDetailAskTurn veto locationBroaden"]
  GUARD --> ROUTE["turn-routing/classify<br/>rules → embedder RTI-3B"]

  ROUTE --> PIVOT["focus release / visit phase transitions"]
  PIVOT --> GOAL["decideGoalAsync"]
  GOAL --> PH["phases/* decide<br/>discover | focused | visit | handoff"]

  PH --> FETCH["fetchAnswer / fetchRecommend / fetchEvidence<br/>via adapters/nayadesk"]
  FETCH --> REQ["compose buildComposeRequest"]

  REQ --> DET{"deterministic template?"}
  DET -->|visit, compare, multi-topic...| FB["compose fallbackReply"]
  DET -->|single price/legal/overview| CMP["adapters/llm compose DeepSeek"]

  FB --> GRD["grounding checkGrounding"]
  CMP --> GRD
  GRD --> SAVE["store.save + crm.appendMessage"]
  SAVE --> OUT(["reply + state + debug"])
```

---

## 4. Class / module interaction

```mermaid
flowchart LR
  subgraph ports["EngineDeps — ports.ts"]
    DATA[EngineData]
    LLM[EngineLlm]
    SEM[SemanticNluPort]
    CRM[EngineCrm]
    STORE[EngineStore]
    TI[turnIntent.classify]
    RENV[routingEnv]
  end

  subgraph adapters["Adapters"]
    ND["adapters/nayadesk.ts"]
    LLMA["adapters/llm.ts"]
    SNLU["adapters/semantic-nlu.ts"]
    KV["store-kv.ts"]
  end

  subgraph kernel["Engine kernel"]
    TURN["turn.ts"]
    FACTS["facts.ts"]
    STATE["state.ts"]
    COMP["compose.ts"]
    GRND["grounding.ts"]
    DISC["phases/discover.ts"]
    FOC["phases/focused.ts"]
    VIS["phases/visit.ts"]
    RTIC["turn-intent/classify.ts"]
    RTIR["turn-routing/classify.ts"]
    REC["recovery-planner.ts"]
  end

  subgraph advisor_pkg["advisor/ — web adapter only"]
    HT["handle-turn.ts"]
    AP["apply-preferences.ts"]
    MR["map-response.ts"]
    SES["session.ts"]
  end

  ND --> DATA
  ND --> CRM
  LLMA --> LLM
  SNLU --> SEM
  KV --> STORE

  HT --> AP
  HT --> SES
  HT --> TURN
  TURN --> MR

  TURN --> FACTS
  TURN --> STATE
  TURN --> SEM
  TURN --> RTIC
  TURN --> RTIR
  TURN --> DISC
  TURN --> FOC
  TURN --> VIS
  TURN --> COMP
  TURN --> GRND
  TURN --> REC
  TURN --> DATA
  TURN --> LLM
  TURN --> CRM
  TURN --> STORE

  FACTS --> LLM
  RTIC --> LLMA
  RTIR --> SNLU
  RTIR --> RENV
  AP --> FACTS
```

### `advisor/` folder (not the React app)

| File | Role |
|------|------|
| `handle-turn.ts` | Web ingress: prefs, sticky focus, then `runEngineTurn` |
| `apply-preferences.ts` | Brief chips → `constraints` |
| `session.ts` | `session_id` → `advisor:{id}` KV key + synthetic phone |
| `map-response.ts` | Engine output → `AdvisorTurnResponse` (cards, visit queue, ui_mode) |
| `map-visit-queue.ts` / `map-visit-itinerary.ts` | Visit board DTOs |
| `handle-brief-facets.ts` / `brief-facets.ts` | Catalog-backed onboarding options |
| `handle-project-detail.ts` / `map-project-detail.ts` | Focused project panel |

NayaAdvisor UI components live in the **NayaAdvisor** repo. This folder is the API contract.

---

## 5. Extraction authority decision tree

```mermaid
flowchart TD
  MSG["Buyer message"] --> CH{"Channel?"}

  CH -->|advisor_web| STRUCT["preferences + project_id + action_id<br/>apply-preferences.ts"]
  STRUCT --> REGEX

  CH -->|whatsapp / chat| REGEX["facts.ts regex<br/>budget, bhk, topics, location, transition"]

  REGEX --> TOPICS{"askTopics filled?"}
  TOPICS -->|yes| SKIP_EMB["Skip intent Vectorize"]
  TOPICS -->|no| EMB["semantic-nlu INTENT_VECTORS<br/>threshold 0.72"]

  REGEX --> LOC{"location filled?"}
  LOC -->|no + discover| LLM_LOC["llm extractSignals location"]
  LOC -->|still empty| EMB_LOC["semantic-nlu cosine vs microMarkets<br/>threshold 0.78"]
  LOC -->|yes| SKIP_LOC["Skip location embed"]

  SKIP_EMB --> DETAIL{"isDetailAskTurn?"}
  EMB --> DETAIL
  SKIP_LOC --> DETAIL
  EMB_LOC --> DETAIL

  DETAIL -->|true| KEEP["Keep focused phase<br/>no locationBroaden"]
  DETAIL -->|false| BROADEN["May release focus on area pivot"]

  KEEP --> GOAL["phases/focused.decide → answer goal"]
  BROADEN --> GOAL2["phases/discover.decide → recommend etc."]

  GOAL --> EVID["nayadesk pricing / detail / legal"]
  GOAL2 --> EVID

  EVID --> COMPOSE["compose.ts fallbackReply OR llm.compose"]
```

### `isDetailAskTurn` (focus guard)

Used once in `turn.ts` to veto `locationBroaden` on focused phase:

- Any non-compare `askTopic` / `askTopics` → detail ask
- Or `transition === 'want_details'`
- Or `implicitProjectPick`

Does **not** compose the reply — only prevents erroneous focus release.

---

## 6. Phase goal tables

| Phase | Module | Typical goals |
|-------|--------|---------------|
| `discover` | `phases/discover.ts` | `greet`, `orient`, `probe`, `recommend`, `no_fit`, `commit` |
| `focused` | `phases/focused.ts` | `answer` (price, legal, location, …), `objection`, `propose_visit` |
| `visit` | `phases/visit.ts` | `visit_ask`, `visit_propose`, `visit_booked`, route expand |
| `handoff` | `phases/handoff.ts` | Post-visit wrap, `warm_ack` |

`decideGoalAsync` in `turn.ts` may intercept focused project switch before phase `decide`.

---

## 7. Compose path

```text
buildComposeRequest(goal, evidence, context)
  → deterministic? → fallbackReply(req)     [visit, compare, multi-topic, shortlist, …]
  → else             → llm.compose(req)       [DeepSeek — single-topic price/legal/overview]
  → stripBanned + checkGrounding
  → if ungrounded    → fallbackReply (repair)
```

Evidence is fetched **before** compose (`fetchAnswer`, `fetchRecommend`, …) via `adapters/nayadesk.ts` — pricing, landed cost, compare matrix, media, units, objection playbooks.

---

## 8. Debug breakpoint cheat sheet

| Order | File | Symbol | What to watch |
|-------|------|--------|---------------|
| 1 | `engine/turn.ts:86` | `runEngineTurn` | Single brain entry (all channels) |
| 2 | `engine/turn.ts:198` | RTI classify | Recovery chip / probe fast path |
| 3 | `engine/facts.ts` | `extractFacts` | Regex + LLM signal output |
| 4 | `engine/adapters/semantic-nlu.ts:49` | `enrich` | Embeddings (intent + location) |
| 5 | `engine/turn.ts:310` | `isDetailAskTurn` | Focus guard vs locationBroaden |
| 6 | `engine/phases/focused.ts:11` | `decide` | Goal = answer / visit / objection |
| 7 | `engine/turn.ts:1039` | `fetchAnswer` | NayaDesk tool evidence |
| 8 | `engine/turn.ts:483` | `buildComposeRequest` | Compose input bundle |
| 9 | `engine/turn.ts:524` | `deps.llm.compose` | Final reply draft |

**Local dev:** Terminal 1 `npm run dev` (port 8789) · Terminal 2 `npm run chat` · F5 `CS: Wrangler dev + attach`.

---

## 9. Key file index

```text
src/
  index.ts                      HTTP router
  runtime/deps.ts               ConverseRuntime wires EngineDeps
  turn/run-turn.ts              /chat + WhatsApp wrapper
  worker/routes.ts              handleChat, health
  webhook/whatsapp.ts           Meta ingress
  advisor/                      NayaAdvisor web adapter (see §4)
  engine/
    turn.ts                     Main loop
    facts.ts                    Regex + LLM signals
    state.ts                    ConversationState, applyExtracted, commitTo
    compose.ts                  Prompt + fallbackReply
    grounding.ts                Verifier
    phases/                     Phase goal tables
    turn-intent/                RTI recovery, chip taps, focused pivot
    turn-routing/               RTI-3B visit vs answer (telemetry gate)
    adapters/
      nayadesk.ts               EngineData + EngineCrm
      llm.ts                    DeepSeek compose + extractSignals
      semantic-nlu.ts           Workers AI + Vectorize enrich
    store-kv.ts                 TURN_CACHE persistence
  crm/nayadesk-client.ts        NayaDesk service binding client
  chat-repl.ts                  Interactive terminal client
```

---

## Related docs

- [`CONVERSE_ENGINE.md`](./CONVERSE_ENGINE.md) — design loop and invariants
- [`CONVERSESPINE_LAYER_GUIDE.md`](./CONVERSESPINE_LAYER_GUIDE.md) — per-layer when/why/examples
- [`PRODUCTION_STACK.md`](./PRODUCTION_STACK.md) — wrangler bindings, dev/prod
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — test and PR discipline
