import type { ComposeRequest, LocationPoiCategories, ProjectDetail } from './types.js';
import type { EmiFacts } from './emi.js';

/**
 * Phase 0b — discriminate catalog absence from transport failure on measured ports.
 * Desk empty / 404 → absent; thrown / network → transport; success carries latency_ms.
 */
export type DataResultReason = 'absent' | 'transport';
export type DataResult<T> =
  | { ok: true; value: T; latency_ms: number }
  | { ok: false; reason: DataResultReason; latency_ms: number };

export function dataOk<T>(value: T, latency_ms: number): DataResult<T> {
  return { ok: true, value, latency_ms };
}
export function dataAbsent(latency_ms: number): DataResult<never> {
  return { ok: false, reason: 'absent', latency_ms };
}
export function dataTransport(latency_ms: number): DataResult<never> {
  return { ok: false, reason: 'transport', latency_ms };
}

/**
 * The record Desk already holds about this buyer, as it comes off the wire.
 *
 * Deliberately raw: `budget` is whatever string a person or a form put in the
 * column ("80 lakh", "₹1.2 Cr", ""), not a parsed number. Parsing belongs to
 * the one place that already knows how — `parseBudgetToInr` — and a shape that
 * pretended this was clean would be the third opinion on what a budget is.
 *
 * Everything is optional and everything can be empty. An empty brief is the
 * normal state of a buyer who has said nothing yet, and must never be spoken
 * as knowledge.
 */
export interface DeskBrief {
  buyerName?: string;
  bhk?: string;
  /** Free text from the Desk column — parse before use, never render raw as a claim. */
  budget?: string;
  location?: string;
  purpose?: string;
  /**
   * The project this lead is ON, and the name to say it by.
   *
   * Set together or not at all. `/api/v1/thread-context` returns the
   * project row only when Desk's own `has_project` gate passes —
   * `project_id !== '' && project_state === 'focused'` — and it re-reads the
   * row `AND builder_id = ?`, so a name arriving here has already been
   * checked for focus and for tenancy. A lead still browsing sends no name,
   * and this side must not invent one: an id spoken as a name
   * ("about proj_8f21c —") is not an answer to anybody.
   */
  projectId?: string;
  projectName?: string;
  /** Desk's durable board. Spine writes this and had never read it back. */
  shortlistProjectIds: string[];
  /**
   * The buyer filled Desk's own registration form — `source_detail` is
   * `'self_registered'`. They have already told us things, in a different
   * room, minutes ago; a greeting that asks for those things again tells them
   * the form was a waste of their time.
   */
  selfRegistered: boolean;
}

export type SignalKind = 'location' | 'property_type' | 'purpose' | 'transition';

export interface ExtractSignal {
  kind: SignalKind;
  value: string;
}

export interface EngineLlm {
  compose(req: ComposeRequest): Promise<string>;
  extractSignals(text: string, need: readonly SignalKind[]): Promise<readonly ExtractSignal[]>;
}

export interface StoredVisit {
  projectId: string;
  projectName: string;
  iso: string;
  label: string;
  confirmed: boolean;
}

export interface ProjectFaq {
  questionKey: string;
  question: string;
  answer: string;
}

export interface UnitConfig {
  unitType: string;
  priceDisplay: string;
  priceMinInr: number;
  /** Band high end — the overview card renders one low–high band from configs. */
  priceMaxInr?: number;
  /** Buyer-facing size band, e.g. "595-624 sqft" or "1200 sqft". */
  sizeDisplay?: string;
  sizeMinSqft?: number;
  sizeMaxSqft?: number;
  /** W7 — live count of holdable physical units of this type (Desk #203); absent = unknown. */
  holdableUnits?: number;
  /** What stands behind "available" (NayaDesk availability_basis): counted | stated | unsupported | unknown. Absent on an older Desk. */
  availabilityBasis?: 'counted' | 'stated' | 'unsupported' | 'unknown';
}

/** S1 — structured POI categories (schools/hospitals/metro/…) ride alongside the legacy display strings. */
export interface LocationIntel extends LocationPoiCategories {
  connectivitySummary?: string;
  microMarketOverview?: string;
  nearbyPois?: string[];
  driveTimes?: string[];
}

export interface LandedCostFacts {
  projectName: string;
  unitType: string;
  baseDisplay: string;
  oneTime: Array<{ label: string; display: string }>;
  recurring: Array<{ label: string; display: string }>;
  totalDisplay: string;
  disclaimer?: string;
}

export interface MediaShareResult {
  allowed: boolean;
  title?: string;
  cdnUrl?: string;
  assetKind?: string;
  mimeType?: string;
  reason?: string;
  redirectHint?: string;
}

export interface EngineData {
  search(builderId: string, filters: import('./types.js').SearchFilters): Promise<{
    matches: Array<{
      project_id: string;
      name: string;
      micro_market: string;
      starting_price_inr: number;
      starting_price_display: string;
      match_reasons?: string[];
      project_type?: string;
      /** Desk trade-off narration (advisor preference re-rank; optional). */
      tradeoff_note?: string;
      /** Typed rank receipts + structured absence (Desk advisor re-rank). */
      dimension_fit?: Array<{ dimension: string; score: number; weight: number; evidence: string; good: boolean }>;
      dimension_gap?: { dimension: string; weight: number; label: string };
    }>;
    expandedLocations?: string[];
    /** Provisional-locality contract: subset of the sent locations the Desk
     *  recognizes as real places (registry / catalog / geocoder). Absent on
     *  older Desk deploys — absence must mean "no drop", never "unrecognized". */
    recognizedLocations?: string[];
    noMatchReasoning?: string;
  }>;
  catalog(builderId: string): Promise<{
    priceMinInr: number;
    priceMaxInr: number;
    projectTypes: string[];
    microMarkets: string[];
    /** Full builder name set — the resolvers' distinctiveness source. */
    projectNames?: Array<{ projectId: string; name: string }>;
    servedCities?: string[];
    total: number;
    sample: Array<{ name: string; startingPriceDisplay: string }>;
  }>;
  /**
   * AB-6 / W8 — the full builder name index, so a project NAMED from a cold start
   * ("is Brigade Oasis plotted?") resolves against the whole catalog, not just the
   * session shortlist. Type-only: no prices/facts.
   */
  projectNames(builderId: string): Promise<Array<{ projectId: string; name: string }>>;
  /** thread-context when focused; getProject fallback otherwise. */
  projectDetail(
    builderId: string,
    ndThreadId: string,
    projectId: string,
  ): Promise<DataResult<ProjectDetail>>;
  /** Desk location_intelligence POIs for a project (engine door). */
  locationIntel(projectId: string): Promise<LocationIntel | undefined>;
  pricing(builderId: string, ndThreadId: string, projectId: string, unitType?: string): Promise<DataResult<{
    projectName: string;
    startingDisplay?: string;
    components: Array<{ label: string; value: string }>;
    withheld?: Array<{ label: string; redirectHint: string }>;
  }>>;
  landedCost(
    builderId: string,
    ndThreadId: string,
    projectId: string,
    unitType: string,
  ): Promise<DataResult<LandedCostFacts>>;
  compare(ndThreadId: string, projectIds: string[]): Promise<{
    tableText: string;
    projects: Array<Record<string, unknown>>;
    matrix?: import('./types.js').CompareMatrixPayload;
  } | null>;
  priceBasis(
    builderId: string,
    ndThreadId: string,
    projectId: string,
    unitType?: string,
  ): Promise<DataResult<{
    priceInr: number;
    display: string;
  }>>;
  listUnits(projectId: string): Promise<UnitConfig[]>;
  mediaShare(
    ndThreadId: string,
    projectId: string,
    assetKind: string,
    unitType?: string,
    phaseId?: string,
  ): Promise<MediaShareResult | null>;
  threadContext(ndThreadId: string): Promise<import('../crm/nayadesk-client.js').NdContextBundle | null>;
  /** Approved corridor value intel for a micro-market string; null = honest absence. */
  marketIntel(microMarket: string): Promise<import('../crm/nayadesk-client.js').NdMarketIntel | null>;
  objectionContext(ndThreadId: string): Promise<{
    playbooks: Array<{ topic: string; reframeAngles: string[]; escalateAfter: number }>;
    escalationPhone?: string;
  } | null>;
  siteVisitsItinerary(ndThreadId: string): Promise<readonly StoredVisit[]>;
  /**
   * Cancel every site visit still standing for this thread, and answer
   * how many. "I've removed your details" was a promise the bot could not keep
   * — the visits lived in Desk, so the very next turn read them back. Erasure
   * has to reach the records the buyer can still see.
   */
  cancelSiteVisits(ndThreadId: string): Promise<number>;
  builder(builderId: string): Promise<{ siteVisitHours: string; name?: string; escalationPhone?: string } | null>;
  recordVisit(
    ids: { ndThreadId: string; buyerPhone: string; builderId: string },
    visit: { projectId: string; projectName: string; iso: string; label: string },
  ): Promise<boolean>;
  /**
   * Place a launch-ops hold on a unit of the given TYPE — Desk auto-picks the
   * cheapest available unit atomically (one-active-hold enforced by its DB),
   * so unit numbers never cross this port. reason 'none_available' = the type
   * sold out (surface it honestly); 'error' = transport/unknown (also honest).
   * Prefer requestHold for buyer "yes" — this remains for waitlist queue:true.
   */
  placeHold(
    ids: { ndThreadId: string; builderId: string },
    hold: { projectId: string; unitType: string; buyerName?: string; ttlMinutes?: number; queue?: boolean },
  ): Promise<{
    ok: boolean;
    expiresAt?: number;
    unitNumber?: string;
    /** W7 — queue:true joined the waitlist instead of holding (202). */
    waiting?: boolean;
    position?: number;
    reason?: 'none_available' | 'error';
  }>;
  /**
   * Buyer asked to hold — open a Desk hold_request. Never mints unit_holds.
   */
  requestHold(
    ids: { ndThreadId: string; builderId: string },
    hold: { projectId: string; unitType: string; buyerName?: string },
  ): Promise<{
    ok: boolean;
    requestId?: string;
    alreadyOpen?: boolean;
    reason?: 'none_available' | 'error';
  }>;
  /** Turn-start bundle — returning buyer, builder persona, recent messages, ledger prior. */
  bootstrapContext(ndThreadId: string): Promise<{
    returningBuyer?: { buyerName: string; daysSinceLastSeen: number; lastProjectId?: string };
    builderPersona?: { botName?: string; preferredTone?: string };
    recentMessages: Array<{ role: 'buyer' | 'bot'; text: string; atMs: number }>;
    rejectedProjectIds: string[];
    turnIndex: number;
    /** P2b — raw Desk prior row (mapped in turn bootstrap). */
    ledgerPrior?: import('./ledger-read.js').LedgerPriorRow | null;
    /**
     * WHAT DESK ALREADY HOLDS ABOUT THIS BUYER.
     *
     * This adapter has always fetched the whole CRM row — one call,
     * `SELECT *` on the Desk side — and then mapped three things out of the
     * bundle and dropped the row. So `bhk_preference`, `budget_inr`,
     * `location_pref`, `purpose` and `shortlist_project_ids` arrived on every
     * cold turn and reached nothing.
     *
     * The engine WRITES all of those back to Desk (turn.ts ~6201/6467,
     * adapters/nayadesk.ts ~1150). It has never read one of them. Which is why
     * a buyer who filled Desk's registration form at the gate and then opened
     * WhatsApp was met by a bot that knew nothing about them, and why
     * "what's my budget" answered "I don't have your brief on file yet" while
     * the brief sat in the row this function had already fetched.
     */
    deskBrief?: DeskBrief;
  }>;
  geoAreasInRegion(region: string, builderId: string): Promise<Array<{ name: string; distanceKm: number }>>;
  /** Desk-owned durable-locality boundary. Transport failure is not evidence
   * that a buyer's place is invalid, so it remains a distinct third state. */
  resolveLocation(text: string): Promise<
    | { status: 'resolved'; canonical: string; lat: number; lng: number }
    | { status: 'unresolved' }
    | { status: 'unavailable' }
  >;
  resolveGeo(text: string): Promise<{
    lat: number;
    lng: number;
    /**
     * How Desk arrived at the answer. `area_registry` is the authority — the
     * Desk registry holds this label as an area. The other sources are a
     * geocoder, which answers ANY string: "immediately" and "floor is
     * available" both resolve, to the centroid of India.
     */
    source?: 'area_registry' | 'cache' | 'geocoder' | 'gazetteer';
    areaId?: string;
    /** Bounding-box radius. The scale is what betrays a geocoder shrug. */
    radiusKm?: number;
  } | null>;
  projectCoords(builderId: string): Promise<
    ReadonlyArray<{ projectId: string; lat: number; lng: number; microMarket?: string }>
  >;
  faqLookup(
    projectId: string,
    questionKey: string,
  ): Promise<DataResult<{ question: string; answer: string }>>;
  /**
   * Platform buyer-education KB (definition asks). Dedicated education index /
   * Desk corpus — never project FAQs. Null = miss (speakable no_data + queue).
   */
  educationSearch(
    text: string,
    opts?: { jurisdiction?: 'india' | 'karnataka' },
  ): Promise<import('./education.js').EducationEvidence | null>;
  /** Fire-and-forget miss → Desk curation queue. */
  enqueueEducationMiss(input: {
    buyerText: string;
    threadId?: string;
    suggestedTopic?: string;
    source?: 'education_miss' | 'unknown' | 'understanding' | 'manual';
  }): Promise<void>;
  getProfile(builderId: string, buyerPhone: string): Promise<Record<string, unknown>>;
}

/** Per-table proof of an erasure run. See NayaDesk `src/lib/erasure.ts`. */
export interface ErasureReceipt {
  scope: 'all' | 'contact_only';
  deleted: Record<string, number>;
  redacted: Record<string, number>;
  /** table → the stated reason it was kept. A buyer is owed this out loud. */
  retained: Record<string, string>;
  /**
   * table → how many of THIS buyer's rows actually survived.
   *
   * `retained` is policy: it names bookings for every buyer alive, including
   * the ones who never booked. Composing a reply from it tells a buyer we kept
   * a signed agreement they never signed. Counts are the fact; use these.
   *
   * Optional because a Desk deployed before this shipped does not send it —
   * Desk and Spine deploy separately. Absent reads as "we cannot show that
   * anything was kept", which understates rather than invents.
   */
  retained_counts?: Record<string, number>;
  /** Non-empty means partial. Never claim a clean sweep over a non-empty list. */
  failed: string[];
  /** CRM keys swept (builder x buyer x PROJECT). Was `conversation_ids`. */
  lead_ids: string[];
  /** Messaging keys swept (builder x buyer x CHANNEL). New at the 0220 cutover. */
  thread_ids: string[];
  unteach_phrasing_ids: string[];
  tombstone_written: boolean;
  erased_at: number;
}

export interface EngineCrm {
  /**
   * Desk's `PUT /api/v1/leads` with no project named answers a THREAD id and
   * no lead id — a pursuit does not exist until a project does. This is the
   * only id Spine carries, which is why the seam translates for lead-only
   * doors instead of the engine guessing (see adapters/nayadesk.ts).
   */
  ensureLead(builderId: string, buyerPhone: string, channel?: string): Promise<{ threadId: string } | null>;
  appendMessage(threadId: string, direction: 'inbound' | 'outbound', content: string, meta?: { replyKey?: string }): Promise<void>;
  updateFacts(threadId: string, facts: Record<string, string | undefined>): Promise<void>;
  /** Mirror Spine visit awaiting-window (or clear) into Desk pending_action. */
  setPendingAction(
    threadId: string,
    pending: { kind: string; payload: Record<string, unknown> } | null,
  ): Promise<void>;
  commitProject(threadId: string, projectId: string): Promise<void>;
  releaseProject(threadId: string): Promise<void>;
  syncShortlist(threadId: string, projectIds: string[]): Promise<void>;
  syncMatching(threadId: string, projectIds: string[]): Promise<void>;
  setStage(
    threadId: string,
    stage: 'new' | 'engaged' | 'qualified' | 'visit_booked' | 'escalated' | 'cold' | 'dropped',
    /** W5 — onlyForward: Desk skips the write if the lead is already at/past the rung. */
    opts?: { onlyForward?: boolean },
  ): Promise<void>;
  appendSharedFact(threadId: string, factKind: string, projectId: string, turnIndex: number): Promise<void>;
  appendTurnLedger(entry: {
    threadId: string;
    turnIndex: number;
    builderId: string;
    buyerPhone: string;
    buyerText: string;
    reply: string;
    goal: string;
    tools: string[];
    offeredProjectIds?: string[];
    phase: string;
    /** P2a / SA-5 — full column payloads when present. */
    snapshotIn?: Record<string, unknown>;
    resolvedIntent?: Record<string, unknown>;
    actionPlan?: Record<string, unknown>;
    verify?: Record<string, unknown>;
    composer?: string;
    /** `produced_evidence` is OBSERVED (did the call fill its evidence slot);
     *  the adapter maps it onto Desk's `success` wire field. It is not yet a
     *  claim about transport success — see Phase 0b. */
    toolRuns?: Array<{
      name: string;
      args_summary: string;
      produced_evidence: boolean;
      latency_ms: number;
      failure_reason?: 'absent' | 'transport';
    }>;
    /** P2c — claims made this turn (Desk DisclosedFactSchema). */
    disclosedFacts?: Array<{
      kind: string;
      project_id: string | null;
      statement: string;
      source_tool: string;
    }>;
  }): Promise<void>;
  postJourneySignals(
    builderId: string,
    buyerPhone: string,
    threadId: string,
    signals: Record<string, unknown>,
    extras?: { shortlistAdd?: string[]; rejectedAdd?: string[] },
  ): Promise<void>;
  postJourneyTurnSnapshot(
    builderId: string,
    buyerPhone: string,
    threadId: string,
    goal: string,
    phase: string,
  ): Promise<void>;
  postProfileObservations(
    builderId: string,
    buyerPhone: string,
    threadId: string,
    observations: Array<{ fact_key: string; value: unknown; provenance: string }>,
  ): Promise<void>;
  postChoiceEvent(
    builderId: string,
    buyerPhone: string,
    threadId: string,
    matches: Array<{ projectId: string; name: string }>,
    constraints: Record<string, unknown>,
    /** Phase 0a — observed engine status; never hardcode `"ok"`. */
    engineStatus?: string,
  ): Promise<void>;
  postChoiceResponse(threadId: string, responseText: string, responseIntent?: string): Promise<void>;
  /**
   * DPDP erasure. Returns the receipt so the reply is composed from what
   * actually happened — null when Desk could not be reached or is too old to
   * report, which is itself information the caller must not paper over.
   *
   * Replaces `deleteBuyerMemory`, which returned void: the bot could not know
   * whether anything had been erased, so both stop branches said
   * "I've removed your details from our system. You won't hear from us again."
   * unconditionally. It cleared one table out of thirty-odd, cancelled nothing
   * on the delete-confirm branch, and the next bot turn wrote the row back.
   */
  eraseBuyer(
    threadId: string,
    scope: 'all' | 'contact_only',
  ): Promise<ErasureReceipt | null>;
  mirrorMemory(threadId: string): Promise<void>;
  /**
   * Understanding Flywheel Wave A — capture this turn into Desk's intent
   * review queue (feeds the /operations/understanding board + T1 grading).
   * Optional: wired only when UNDERSTANDING_CAPTURE is on. Deliberately does
   * NOT set the legacy embedder/llm voter fields, so the old retroactive
   * miner can never auto-promote from the bot's own confidence.
   */
  enqueueIntentReview?(payload: {
    builderId: string;
    threadId: string;
    buyerPhone: string;
    turnIndex: number;
    buyerText: string;
    botReply: string;
    recentMessages: Array<{ role: 'user' | 'bot'; text: string }>;
    silIntent: string;
    silScore: number;
    silBindSource: string;
    speechAct: string;
    language: string;
    /** Desk project_id the buyer was focused on at ask time ('' = none) —
     *  lets Desk probe taught lessons where the demand actually is. */
    projectFocus: string;
  }): Promise<void>;
  /**
   * Catalog Onboarding Watching — live ask grade for Desk catalog_watch.
   * Optional so eval/CLI without Desk stay green.
   */
  reportCatalogWatchAsk?(payload: {
    builderId: string;
    projectId: string;
    slotId?: string;
    facetKey?: string;
    phrase?: string;
    reviewedIntent?: string;
    threadId?: string;
    answerOk: boolean;
    truthPresent: boolean;
    failReason?: string;
  }): Promise<void>;
}

export interface EngineStore {
  load(threadId: string): Promise<import('./types.js').ThreadState | null>;
  save(state: import('./types.js').ThreadState): Promise<void>;
  /**
   * DPDP erasure — destroy every copy of this thread's state.
   *
   * `freshSession()` was standing in for this and could not do the job: it
   * returns a blank state object, which `save()` then WRITES to the DO and to
   * KV. The record is not gone, it is overwritten with an empty one, and the
   * KV key lives its full 30 days regardless.
   *
   * Optional so an in-memory or test store can omit it; callers must handle
   * absence rather than assume the purge happened.
   */
  purge?(threadId: string, buyerKey?: { builderId: string; buyerPhone: string }): Promise<void>;
  logTurn(entry: {
    threadId: string;
    turnIndex: number;
    buyerText: string;
    reply: string;
    phase: string;
    goal: string;
    grounding: string;
  }): Promise<void>;
}

export interface EngineClock {
  nowMs(): number;
  nowIso(): string;
}

export interface SemanticNluPort {
  enrich(
    text: string,
    builderId: string,
    ex: import('./types.js').Extracted,
    ctx: {
      phase: import('./types.js').Phase;
      microMarkets: readonly string[];
      offeredProjectNames?: readonly string[];
      pendingOfferPricing?: boolean;
      hasPriorConstraints?: boolean;
    },
  ): Promise<import('./types.js').Extracted>;
}

export interface EngineDeps {
  data: EngineData;
  llm: EngineLlm;
  semantic: SemanticNluPort;
  crm: EngineCrm;
  store: EngineStore;
  clock: EngineClock;
  turnIntent?: {
    classify(input: import('./turn-intent/types.js').TurnIntentInput): Promise<import('./turn-intent/types.js').TurnIntentResult>;
  };
  /** Optional Maps key for visit route drive-time stagger. */
  maps?: { apiKey?: string };
  /** Workers AI + Vectorize for RTI-3B turn routing. */
  /** Intent-layer config for classifyTurnRouting. Must carry the SIL_* vars, not
   *  just the bindings — see runtime/deps.ts. */
  routingEnv?: Pick<
    import('../env.js').Env,
    | 'AI'
    | 'INTENT_VECTORS'
    | 'SIL_EMBED_MODEL'
    | 'SIL_INTENT_PROJECTION'
    | 'SIL_ROUTING_TAU'
    | 'SIL_EMBED_FIRST'
    | 'FAILURE_ROUTING'
    | 'TURN_CACHE'
  > & {
    /** Shared with EngineDeps.cacheStats so SIL classify can stamp emb hit/miss. */
    cacheStats?: import('../cache/turn-cache.js').CacheStats;
  };
  /** P6 ExtractTurnFacts — after embedder abstain. */
  bamlExtract?: (input: import('./extract-baml.js').BamlExtractInput) => Promise<
    import('./extract-baml.js').BamlExtractResult | null
  >;
  bamlMode?: import('./extract-baml.js').BamlExtractMode;
  /** Intent recovery after slot/BAML abstain. */
  intentRecoveryMode?: import('./intent-recovery.js').IntentRecoveryMode;
  intentRecover?: (input: {
    text: string;
    phase: string;
    focusName?: string;
  }) => Promise<import('./intent-recovery.js').IntentRecoveryResult | null>;
  /** Hybrid 80/20 compose gate. */
  hybridMode?: import('./hybrid.js').HybridMode;
  /** Soft LLM rate target (0–1); default 0.2 when hybrid on. */
  llmRateTarget?: number;
  /** WhatsApp project-first: pack chips + skip discovery brief. */
  waProjectFirst?: boolean;
  /** Shared TURN_CACHE for L1–L4 read-model (optional). */
  turnCache?: KVNamespace;
  /** Desk project etag for L2 freshness. */
  projectEtag?: (projectId: string) => Promise<{ etag: string; latest_updated_at: number } | null>;
  /** Mutable per-turn cache hit/miss bag (debug). */
  cacheStats?: import('../cache/turn-cache.js').CacheStats;
  /** Mutable per-turn Workers AI embed counter — fills `timings.embed_ms`. */
  embedMeter?: import('../cache/embed-meter.js').EmbedMeter;
  /**
   * Same-turn project detail memo — media+legal packed asks hydrate twice;
   * memo avoids a second Desk RTT within one turn (not persisted).
   */
  projectCardMemo?: Map<string, import('./types.js').ProjectDetail>;
  /** Cloudflare waitUntil — async shadow / etag refresh. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Failure-as-a-value Phase 0: shadow logging only, never behavior. */
  failureLog?: boolean;
  /** Failure-as-a-value Phase 1 behavior gate. */
  failureTools?: boolean;
  /** Failure-as-a-value Phase 2 behavior gate. */
  failureRouting?: boolean;
  /** Failure-as-a-value Phase 3 behavior gate. */
  failureSearch?: boolean;
  /** Failure-as-a-value Phase 4 behavior gate. */
  failureAnswer?: boolean;
  /** THE WIRE — let a high-confidence answer-intent bind rescue a focused turn
   *  that would otherwise fall to search. See turn-routing/goal-rescue.ts. */
  routingInGoal?: boolean;
  /**
   * Phase 0d — join extract ∥ routing before turn-intent may release focus.
   * See docs/lld/PHASE_0D_UNDERSTANDING_BEFORE_MUTATION.md.
   */
  understandingBeforeMutation?: boolean;
  /** Visit open acts teach-only (no ask-team / force regex fallback). */
  visitEmbedActsOnly?: boolean;
  /** Multi-intent Phase A — union topic merges (TOPIC_UNION env). */
  topicUnion?: boolean;
  /** Local dev JSONL turn log (wrangler dev only). */
  emitTurnLog?: (entry: import('../observability/local-turn-log.js').LocalTurnLogEntry) => void;
}

export type { EmiFacts };
