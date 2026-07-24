# Naya-Advisor — System Design (LLD)

**Status:** Living document · v0.2 · 2026-07-24
**Scope:** The end-to-end design of the Naya-Advisor bot — the ConverseSpine (CS) Worker and everything around it — built for a **marketplace at scale**: thousands of projects, many builders, channel partners, and cities, serving buyers on both the web SPA and WhatsApp, without letting answer quality drop.
**Companion docs:** `FAILURE_AS_A_VALUE_LLD.md` (the reply contract), `CHANNEL_POLICY_KERNEL_LLD.md` (channel policy / advisor soft-rank), `docs/designs/perceived-latency-architecture.png`.
**v0.2 changelog:** replaced the "small catalog" assumption with the marketplace domain model (§2) and the geography-first scale model (§11); added quality-at-scale (§12) and extension points (§15).

> **Naming.** "Naya-Advisor" = the buyer-facing advisor product. "ConverseSpine" (CS) = the Worker that runs the bot. "NayaDesk" (Desk) = the CRM + catalog + education truth store. This doc lives in the CS repo because CS is the runtime spine; the domain it serves is shared with Desk.

---

## 1. Purpose, north star & design principles

Naya-Advisor is a **grounded** real-estate advisor: it answers buyer questions and narrows a shortlist from a real catalog, and it never invents a fact it cannot ground. Five principles shape every decision:

1. **Honesty over fluency.** A missing fact is *declined by a fixed speaker*, never hallucinated (`FAILURE_AS_A_VALUE_LLD.md`). Everything the buyer sees is grounded in Desk truth or explicitly marked absent.
2. **Embeddings-first understanding.** Intent is resolved by a learned embedding metric; deterministic rules gate state, regex is only the fallback. Misses are fixed by teaching the corpus, never by adding regex.
3. **Perceived immediacy.** We cannot stream a fabricated grounded answer, so we make the *known* parts appear instantly and reserve the LLM for genuinely novel free text. Target: first paint ~200 ms.
4. **Scope early, stay bounded.** The global catalog is huge, but any one conversation is scoped to a small **segment**; resolve that segment up front and everything downstream (search, cache, ranking, metrics) stays bounded.
5. **Fluid by construction.** The requirement is an *open constraint set*, composition is a *dispatch table*, visibility is a *pluggable filter*, geography is a *registry*, the LLM is *provider-abstracted*, and channels are *adapters*. New dimensions, property types, tenants, or channels extend the system; they don't fork it (§15).

**Non-goals.** CS holds no dialogue *policy* that belongs to Desk (catalog truth, education content, intent labels) and no long-term buyer record (Desk's CRM). CS owns the deterministic *turn* and the *geometry* (embedding space, ranking, compose).

---

## 2. Domain model — the marketplace

The single most important shift from v0.1: **"the catalog" is not one small table — it is a marketplace graph.** But it stays tractable because of one fact about buyers.

### 2.1 The buyer enters through geography

**A buyer invests in a city or an area, never all of India.** Geography is the buyer's entry and therefore the **primary partition**: `City → Corridor/Zone → Micro-market (Area)`. Everything scopes to the area first. This is the load-bearing simplification — it bounds every conversation.

The buyer's requirement is a **bundle** that accretes over the conversation:

```
requirement = { geo(city/area set), property_type, config, budget, purpose, …soft prefs }
```

Two of these **define the market segment**; the rest **narrow and rank within it**:

| Role | Fields | Why |
|---|---|---|
| **Segment-definers** (pick the candidate SET) | **geography + property_type** | "Apartment in Whitefield" and "plot in Whitefield" are *different markets* — different inventory, buyers, economics, and facts. Buyers commit to a property_type early. So property_type is a **near-partition** beside geo. |
| **Narrowers** (rank within the set) | config (BHK / plot size), budget, purpose, soft prefs | These order and trim the segment; they don't define it. |

Entry granularity is fluid: some buyers land city-broad ("looking in Bangalore") and narrow; others arrive with the bundle ready ("3BHK apartment in Whitefield under 1.5 Cr"). Same pipeline — extract whatever is given, probe for the missing **segment-definers (area + property_type)** before any meaningful search.

### 2.2 The entities

```
City 1─* Corridor 1─* Area(micro-market)          Area ─ State  (⇒ RERA/legal jurisdiction)
                              │
Builder 1─────* Project *─────┘   Project ─1 property_type (apartment|plot|villa|…)
   (spans cities, derived)        Project ─1 Builder, ─1 Area
                              ▲
ChannelPartner *──authorizes──┘   (CP *─* Builder, CP operates in *─* Territory)

Buyer 1─* Conversation ─1 AdvisorContext ∈ { neutral marketplace | builder-branded | CP-branded }
```

- **Builder ⊥ City.** A builder spans many cities *through its projects*; multi-city footprint is derived, never a builder attribute.
- **Project** belongs to exactly one Builder, sits in exactly one Area, and is exactly one property_type. It carries configs/units (apartment → BHK; plot → sizes/dimensions), FAQs, cost sheets, possession, and a RERA number **from its area's state**.
- **Channel Partner** represents many builders and is authorized for a *subset* of projects within its territories (many-to-many). When a CP is in the loop, lead attribution is a first-class concern.
- **Advisor Context** (per conversation) selects the **Visibility** filter.

### 2.3 The scoped catalog view (what the bot actually queries)

The catalog the bot searches is never the global table — it is a **computed, scoped view**:

```
scoped_view = Visibility(context) ∩ Geography(buyer areas) ∩ property_type
```

- **Visibility** is a project-set predicate driven by the advisor context: neutral = all builders; builder-branded = `builder_id = X`; CP-branded = `project_id ∈ authorized(CP)`. It is a *filter within* the geography, not the entry point.
- **Geography** is the buyer's active area(s) — usually one, sometimes several (relocation / investor).
- **property_type** completes the segment.

### 2.4 Segment & working set (why scale stays bounded)

- **Segment = `(area, property_type)`** — the coherent inventory unit ("apartments in Whitefield"). It is the **cache key and the search key**, and it is *shared across all buyers in that segment*.
- **Working set (per conversation)** = the segment's visible projects + the buyer's focus/shortlist — **tens of projects, regardless of global catalog size.** A builder with 500 projects across 10 cities still yields a ~10–30-project working set for any one buyer.

This is the whole trick: **global catalog explodes, conversation working set stays small** — so the turn architecture (§4) never has to change as the marketplace grows; only the scoping query and the indexes do (§11).

---

## 3. System context & boundary

```
   Buyer (web) ─► NayaAdvisor SPA (Pages) ─POST /api/advisor/turn─┐
                                                                  ▼
   Buyer (WA) ─► WhatsApp Graph ─POST /webhook─► ┌───────────────────────────┐ ─svc binding─► NayaDesk
                                                 │  ConverseSpine Worker      │ ◄────────────  (CRM · catalog ·
                                                 │  (deterministic turn spine)│                education · holds ·
                                                 └──┬────────┬───────┬────────┘                geography · CP graph;
                                          Workers AI  Vectorize×3   DeepSeek                    D1 lives here)
                                          (embed)     (intent/proj/edu) (LLM) · Langfuse
```

**The boundary rule (load-bearing).** Desk owns **truth**: catalog, per-project facts/FAQs, education content, the geography/area registry, the CP authorization graph, the CRM dossier, and the intent **labels**. CS owns the **turn**: the deterministic pipeline, the embedding **geometry** (model + learned projection + index membership), ranking, and composition. When these blur, things break silently — Desk once embedded-and-upserted intent vectors directly and stopped reaching the bot the moment the vector space changed, which is why the single writer to the intent index is now a CS route (§8). Trace consumers before changing any response shape.

---

## 4. Infrastructure topology

### 4.1 Runtime & environments
Single Cloudflare Worker, `main = src/index.ts`, `compatibility_date = 2026-05-01`, `nodejs_compat`, observability on. Environments off one `wrangler.toml`:

| Env | Worker | Purpose |
|---|---|---|
| `prod` | `converse-spine` | Production — **deferred pre-MVP** (no users; empty is intentional). |
| `dev` | `converse-spine-dev` | The working env; `remote=true`, all bindings hit real Cloudflare. |
| `ctrldev` / `projdev` | `…-ctrldev` / `…-projdev` | A/B arms for the learned intent metric (raw baseline vs projection), probed side-by-side. |

### 4.2 Bindings

| Binding | Kind | Role |
|---|---|---|
| `NAYADESK` | Service binding → `nayadesk[-dev]` | The only path to Desk (worker→worker; avoids CF 1042; Desk URL never in a client). |
| `TURN_CACHE` | KV | Session state, rate-limit counter, cache invalidation, **segment/area warm cache** (§5). |
| `TURN_DEBOUNCER` | Durable Object | Debounces rapid turns per buyer. The seed for the per-conversation actor (§11). |
| `INTENT_VECTORS` | Vectorize | Intent phrasings → intent/facet (learned-projection index on dev). |
| `PROJECT_VECTORS` | Vectorize | Project-name resolution — **geo/tenant-filtered** at scale (§8, §11). |
| `EDUCATION_VECTORS` | Vectorize | Buyer-education retrieval — **jurisdiction-scoped** (§8). |
| `AI` | Workers AI | Embeddings (`@cf/baai/bge-base-en-v1.5`). |

**External (network, not bindings):** DeepSeek (`deepseek-chat`) for LLM extract + compose; Langfuse traces; WhatsApp Graph outbound.

**Deliberately absent today (greenfield for §11):** no `[[queues]]`, no `[[analytics_engine_datasets]]`, **no D1 in CS** (all relational truth is Desk's). The telemetry/CRM offload seam is net-new infra.

### 4.3 Cron & configuration
`scheduled()` (both `ctx.waitUntil`-wrapped): weekly (Mon 03:30 UTC) SIL intent + education index rebuild; nightly (22:30 UTC) gated auto-teach. Flag-dense by design — every risky lane ships dark and is measured before flipping (`FAILURE_*`, `SIL_EMBED_FIRST`, `SIL_INTENT_PROJECTION`, `SIL_CANONICAL_EMBED`, `UNDERSTANDING_CAPTURE/AUTO_TEACH`, `BAML_EXTRACT_MODE`). Dev soaks; prod adopts a flag only after its data dependency exists there.

---

## 5. Data, state & the segment cache

**Three stores, three lifetimes:**

1. **KV (`TURN_CACHE`) — hot, machine-read.** (a) Per-conversation `ConversationState` (stage 2/9). (b) The rate-limit counter. (c) **The segment/area warm cache** — see below.
2. **Vectorize ×3 — corpus geometry.** Intent, project-name, education. Rebuilt by cron / the single intent writer; never written by a buyer turn.
3. **Desk (D1 over the binding) — warm, human-read, the truth.** Catalog, project detail/FAQs, education, geography registry, CP graph, CRM dossier. CS *reads* at stage 6, *writes* at stage 10.

**The segment cache is area-scoped and *shared*, not per-conversation.** The projects of a segment `(area, property_type)` are one small hot set served to **every** buyer in that segment — a million Bangalore buyers share a handful of area caches. Hot segments stay warm (high hit rate); cold ones evict (LRU/TTL). Built as a **bounded, keyed working-set cache from day one** — at 21 projects its degenerate case holds everything (the MVP win for free), and the *shape* never has to change at thousands of projects.

**Freshness contract (or the cache becomes a lie).** A stale card served confidently is a grounding violation that *looks* grounded. So: cache the **stable** fields warm (name, builder, area, property_type), and keep **price/inventory on a short leash** — short TTL or live fetch, with **push-invalidation on Desk publish** (event-driven, not periodic; §11). "Warm data, compose on tap" is only safe for the stable half.

**Keep the state blob lean.** `ConversationState` holds *ids and pointers* (focus/shortlist project ids, the resolved segment, the requirement bundle) — never full project payloads. Detail comes from the shared segment cache by id, so the per-turn KV read/write stays small even as catalogs grow.

**Consistency note (→ §11).** The next turn reads KV; today KV is eventually consistent, which at scale reads as the bot "forgetting" the last turn. The scale answer is a per-conversation Durable Object.

---

## 6. The turn pipeline

One message → one reply, `runEngineTurn` in `src/engine/turn.ts`, fed by `createWorkerRuntime` (`{ llm, crm, store, clock, embed, vectors }`). Stages, with the **two-path** overlay:

| # | Stage | Cost | Notes |
|---|---|---|---|
| 0 | Door + auth + rate-limit | ~0 | `/api/advisor/turn`, `/chat`, `/webhook`. |
| 1 | Debounce (DO) | ~0 | Collapses bursts. |
| 2 | Load state (KV) | ~5–20 ms | **What the next turn reads.** |
| **2.5** | **Resolve scope** | ~0 | Visibility(context) + buyer area(s) + property_type ⇒ the **scoped view** and the `(area, property_type)` **segment key** ⇒ segment-cache lookup. |
| 3 | **Understand** — extract (BAML/DeepSeek) **+** embed route (AI+Vectorize) | **~2–3 s** | Two model round-trips, sequential today. Dominant cost. **Fast path skips this** (chip intent is explicit). |
| 4 | Apply + route | ~0 | Merge into the requirement bundle; classify routing. |
| 5 | Decide | ~0 | Deterministic goal within the scoped view. |
| 6 | Fetch | ~0.3–1 s | From the **segment cache** first; Desk on miss. No-match may fan out. |
| 7 | **Compose** — slot family (template) or LLM leaf | **~1–2 s** | §9. |
| 8 | Ground / repair | ~0–1 s | One recompose, else the failure-speaker. **Runs on both paths.** |
| 9 | Save state (KV) | ~5–20 ms | Awaited — turn N+1's input. |
| 10 | **Async tail** | **~0.7–1.4 s** | `syncFacts`/`syncTelemetry`/`logTurn`/`appendMessage`, all `.catch()`. Read by an agent *later*, never by the next turn ⇒ deferrable. |

**Two paths, one engine.** The fast path (chip taps / known asks) short-circuits stage 3 and serves 6–7 from the warm segment cache → < 200 ms. The LLM path runs the full pipeline only for novel free text. Same `runEngineTurn`, not a second engine.

**Measured split (live):** total ≈ 5 s; tail ≈ 0.7–1.4 s; buyer-work (3–8) ≈ 3.5–5.4 s. **Async-tail prerequisite:** an egress `waitUntil` seam already exists (`src/turn/egress.ts:66`) and `handleChat` receives `ctx` — but `handleAdvisorTurn` does **not** (index.ts:170 vs :221). Threading `ctx` into the advisor door is the one concrete change to move stage 10 off the SPA critical path.

---

## 7. The door (routing)

Routes in `index.ts`; internal routes secret-gated (`BOT_SHARED_SECRET`), buyer door per-buyer KV rate-limited.

| Route | Method | Purpose |
|---|---|---|
| `/api/advisor/turn` | POST | SPA turn → `handleAdvisorTurn` → `runEngineTurn`. |
| `/api/advisor/preview` | POST | Stateless narrowing preview (thinking strip) — cached by constraint set. |
| `/api/advisor/project`, `/brief-facets` | GET | Focused detail, brief facets. |
| `/chat` | POST | Buyer-shaped ingress (WhatsApp/api/playground); rate-limited unless `x-bot-secret`. |
| `/webhook` | GET/POST | WhatsApp verify + inbound. |
| `/internal/agent-send`, `/intent-vector`, `/education-rebuild` | POST | Human takeover; the single intent-vector writer; education rebuild. |
| `/api/sil/probe`, `/embed` | POST | Dev-gated embedding measurement. |

**Channels** (`advisor_web`, `whatsapp`, `api`) are labelled at the door and drive channel-adaptive behaviour (format-once at the adapter; SPA-only streaming/chips vs WhatsApp one-shot — §11).

---

## 8. Understanding (SIL + the flywheel)

Embeddings-first, inverted ladder (`SIL_EMBED_FIRST`): state rules → **embedding** (`INTENT_VECTORS`, a learned 256×768 projection `p256-f6665e0b79`) → regex fallback. ~96.9% accurate when confident on holdout; the bottleneck was wiring the verdict into goal selection, not quality.

- **`PROJECT_VECTORS` is geo/tenant-filtered.** At scale a name like "Eldorado" recurs across cities/builders; the lookup filters by the resolved **segment** metadata, so scoping-by-area disambiguates names for free.
- **`EDUCATION_VECTORS` is jurisdiction-scoped.** RERA/legal is state-level, derived from the *project's* area→state — so a builder spanning states has *different* legal answers per project. Never cache legal at the builder level.
- **Flywheel:** every turn (capture) → Desk clusters unresolved asks → human/LLM teacher labels → Desk sends to `/internal/intent-vector` (the single writer, embeds in current geometry) → nightly gated auto-teach. **Misses fixed via corpus/labels, never regex.**

---

## 9. Composition (the reply)

**Not one template — a family of per-intent schemas, and they branch by property_type.** `compose.ts` dispatches by **goal kind** (`answer`, `shortlist_answer`, `no_fit`, `visit_booked`, `ack_reject_recommend`, education, greet/orient); the *shape* differs per intent, and again per property_type. What is uniform is the discipline:

- slots filled deterministically from evidence / the segment cache;
- a missing **required** fact is spoken by the **one** failure-speaker (`evidence.notices`/`faqMiss`), never invented;
- rendered **fastest-first** (warm/known before slow);
- the LLM fills a slot only where prose synthesis is genuinely needed.

| Intent | Identity slot? | LLM? |
|---|---|---|
| Greeting / orient | no | no |
| Discovery / shortlist | no (a *set*) | no (template-locked) |
| Focused answer | yes | leaf only |
| Legal / RERA facet | yes | no |
| Education | **no project** | maybe |
| Compare | two+ | no |
| No-match / recovery | no | no |
| Visit booked | — | no |
| **Novel open question** | — | **full LLM (fallback)** |

**`goal_kind × property_type`.** A plot's "units" slot is plot sizes / dimensions / DTCP approval — no BHK, no under-construction possession, different legal facts. Apartment-shaped templates *will* answer plot questions wrong if this isn't modelled — exactly the quality drop to avoid.

**Current vs target.** Today the primary composer is the freeform LLM (`renderComposePrompt`) with honesty rules as prompt sentences; the deterministic slot composer (`fallbackReply`, `componentsForAsk`) is the fallback. The plan promotes the slot composer to primary behind `COMPOSE_SLOTS`, LLM to the novel leaf. Structural guardrails (over-answer, anchor-which-project) then hold **by construction**; the *semantic* guardrails (decline-what-we-don't-have) still require understanding the ask — templating the output never removes the need to understand the input. **Confidence-floor rule:** if the ask doesn't clearly map to a schema, fall to the LLM leaf — slower-and-right beats fast-and-wrong (§12).

---

## 10. Perceived-latency architecture

Mechanism, mapped from "why ChatGPT feels instant": it streams (perceived = time-to-first-token), one forward pass, deferred side-effects. We can't stream a fabricated grounded answer, so our substitute is **progressive assembly from warm/known → specific**. Diagram: `docs/designs/perceived-latency-architecture.{png,svg}`.

Levers, impact order: **(1)** fast path (chips/known asks, no LLM, < 200 ms); **(2)** the **area-scoped shared segment cache** (identity/units with zero fetch; at scale the speculative chip-prefetch keeps the working set warm ahead of the tap); **(3)** parallelize extract + embed-route; **(4)** async tail (`waitUntil`, ~1 s); **(5)** progressive paint (thinking strip shipped for discovery); **(6)** streaming leaf (SSE) only for the novel-question path.

**Open calibration (measure first):** the per-stage split (extract vs route vs compose) is unmeasured. If understand dominates, the compose rewrite is a *quality* play, not a latency lever, and the latency budget belongs on stage 3.

**Channel split:** chip-prefetch + streaming are SPA-only; WhatsApp = reveal-early one-shot.

---

## 11. Scaling — a marketplace of millions

The catalog is *not* small; the saving grace is that **each conversation is bounded to a segment (§2.4).** Global scale lives in Desk (indexed truth); CS holds only the conversation's working set hot.

**Read side (catalog):**
- **Geography is the shard/partition key** — `(city, area)`, with property_type completing the segment. A Bangalore buyer never touches Pune inventory. Desk indexes composite `(builder_id, city)` *and* `(city)` (a builder-branded query spans cities, so city alone is not enough).
- **Search is geo-first indexed retrieval, not a scan.** Resolve segment → candidate set (visibility-filtered) → rank. Ranking becomes the product at 200 matches/area — the soft-rank/tradeoff advisor carries it. Constraint-set caching (already in the preview endpoint) extends to all search.
- **Ingestion is event-driven.** Thousands of churning projects break the weekly full rebuild; Desk publishes `project vN` → push-invalidate the segment card + re-embed *that* project's vectors.

**Write side (conversations/telemetry) — the real explosion:**
- **KV → per-conversation Durable Object.** Eventually-consistent KV reads as "the bot forgot the last turn" at scale. A `ConversationDO` (evolving the existing `TurnDebouncer`) gives strong consistency, serialized turns, and in-memory hot state.
- **Telemetry offload seam (greenfield):** `turn_ledger` (unbounded, machine-read) → **Analytics Engine** (no 10 GB wall, ~20× cheaper writes); CRM (facts/transcript, bounded) → **D1 via a queue consumer**. The **queue is the seam**; batch (queue timeout or 5-min cron) — the agent reads the dossier later, not on the next turn. Consumers idempotent on `(convId, turn)`. Phase 1 is just `waitUntil` (same stores, ~1 s, no new infra).

**The LLM is the real ceiling** (cost + throughput + provider + residency): every fast-path turn is a DeepSeek call *saved*, so the perceived-latency work is also a **cost and throughput lever**. Needs backpressure + circuit-breaker (shed to template/warm when saturated), provider failover (`makeEngineLlm` already abstracts), and a call on Indian-PII residency before a million.

**Multi-tenant isolation:** tenant/segment-keyed caches and vector filters, per-tenant rate limits, and **per-(tenant, city) quality metrics** so one thin new-city catalog or noisy tenant can't drag another's rating.

**WhatsApp is a different system, not "the SPA without a screen":** the 24-hour service window (alerts must be pre-approved templates), at-least-once/out-of-order webhooks (idempotency on inbound message id), Meta messaging tiers gated on quality (§12), outbound throughput caps (send queue, multi-number), and no streaming/chips (more template-driven, reveal-early one-shot).

---

## 12. Quality at scale (protecting the bot as it grows)

Scale threatens quality, and on WhatsApp **quality is the throttle valve on scale**: users block/report a bad bot → Meta lowers the tier → you cannot reach a million. So quality is a hard prerequisite, not a nicety. Counter-intuitively, the latency work mostly *helps* quality — a deterministic slot that prints a Desk fact cannot hallucinate, so templating **shrinks the hallucination surface.** The risk is not the templates; it is the **classifier that picks the template.** Guardrails:

1. **Confidence-floor routing** — ambiguous ask ⇒ LLM leaf, not a forced template.
2. **Shadow-compare the composer** — new vs old on the same inputs; flag any answer that flipped grounded→ungrounded or gained a fact (the chip shadow pattern, applied to compose).
3. **Grounding-pass-rate as a live SLO** — plus failure-speaker rate, repair rate, "did the answer contain the asked fact." A drop is a *quality incident* with an alert, per (tenant, city, channel). This is the production form of the persona-family HTML report, which doesn't scale to a million transcripts by hand.
4. **Cache freshness = grounding correctness** (§5) — stale price served confidently is a grounding bug; stable fields warm, price/inventory on a short leash.
5. **Grounding runs on both paths** — the fast path skips *understanding*, never *grounding*.
6. **Load + quality harness together** — synthetic load replays the persona families at volume; the grounding SLO is the pass/fail, not just latency.

---

## 13. Security, privacy & the reveal gate

- **Secrets:** `BOT_SHARED_SECRET` gates `/internal/*` and trusted `/chat`; Desk URL never in a client; DeepSeek/Graph keys are Worker secrets.
- **Rate-limit:** per-buyer KV counter on `/chat`; staff/CI exempt via `x-bot-secret`.
- **The reveal gate:** contact/number revealed **only on visit** — shortlist/answers may appear early, buyer contact never does. With a CP in the loop, **lead attribution** (who owns the captured lead) is explicit.
- **Buyer identity:** OTP-based, a *key* not a lead; prod needs a real OTP provider.
- **PII residency:** Indian buyer PII crossing to a foreign LLM is a compliance call to make before scale.
- **Grounding as safety:** the engine emits only grounded facts or explicit absences — the same discipline that bounds hallucination bounds what the bot can be steered to say.

---

## 14. Failure modes & resilience

| Dependency down | Behaviour |
|---|---|
| Desk (binding) | `crm.*` `.catch(emptyCatalog/null)` → honest "can't reach data", no crash. |
| DeepSeek | Compose → deterministic `fallbackReply`; extract → rules+embedding. |
| Workers AI / Vectorize | Ladder → regex fallback. |
| Burst / duplicate / out-of-order | `TurnDebouncer` + `/chat` dedupe + rate-limit; idempotency on message id (WhatsApp). |
| Tail write fails | Already `.catch()`; once deferred, never delays the reply. |
| LLM saturated (scale) | Circuit-breaker sheds to the template/warm lane; WhatsApp may go async ("let me get back to you"). |

---

## 15. Extension points ("keep it fluid")

Designed seams so growth extends rather than forks the system:

- **Requirement = open constraint set.** New dimensions (e.g. "gated community", "metro distance") are new keys in the bundle; segment-definers vs narrowers is a classification, not a schema change.
- **Composition = dispatch table** keyed by `goal_kind × property_type`. A new property type or intent adds a branch; it doesn't touch the others.
- **Visibility = pluggable filter.** neutral / builder / CP today; a new context (e.g. a portal partner) is a new predicate.
- **Geography = registry**, not hardcoded places (Desk area registry + serviceability). New cities/areas are data.
- **LLM = provider-abstracted** (`makeEngineLlm`) — failover or a self-hosted model is config.
- **Channels = adapters** (format-once at the boundary) — a new channel implements the adapter contract.
- **Everything risky = a flag** measured before flip.

---

## 16. Environments, release & CI
`npm run deploy:dev` / `deploy:prod`; dev is `remote=true`. CI gate: `tsc --noEmit` + `vitest run` on every change; `intent-projection-space.test.ts` enforces geometry/flag agreement. **Prod deferred pre-MVP** — no prod pushes without sign-off; Desk dev migrates first, prod after soak. The NayaDesk checkout is written by Cursor — use a worktree; avoid `channel_partners.ts` / `cp_staffing` / `cp_whatsapp`.

---

## 17. Roadmap & open questions

Sequenced to bank cheap/safe wins before the risky rewrite, and to build the quality guardrails *before* they're needed:
1. **[measure]** Per-stage latency split → decides if compose is a latency or quality play.
2. **[P0, safe]** Thread `ctx` into `handleAdvisorTurn`; tail → `waitUntil`; parallelize extract+route.
3. **[foundation]** Segment cache as a bounded, area-scoped shared working-set cache (degenerate = warm-all at 21).
4. **[quality]** Confidence-floor routing + composer shadow-compare + grounding-pass-rate SLO — before the compose rewrite.
5. **[core, flagged]** Slot composer primary (`COMPOSE_SLOTS`), `goal_kind × property_type`, LLM leaf.
6. **[SPA]** Chip fast path + streaming leaf.
7. **[scale]** `ConversationDO` state; `TELEMETRY_OFFLOAD_LLD` (queue + Analytics Engine); event-driven ingestion; speculative segment prefetch.

**Open questions:** (a) per-stage latency split (unmeasured); (b) how far compose-standardisation goes before the semantic decline-floor forces an LLM leaf; (c) the segment-cache freshness contract (TTL vs push-invalidate boundary for price/inventory); (d) the CP lead-attribution model; (e) LLM PII-residency decision.

---

*Cross-references: `FAILURE_AS_A_VALUE_LLD.md`, `CHANNEL_POLICY_KERNEL_LLD.md`, `docs/designs/perceived-latency-architecture.png`, the perceived-latency plan.*
