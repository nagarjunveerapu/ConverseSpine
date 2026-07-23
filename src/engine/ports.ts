import type { ComposeRequest, LocationPoiCategories } from './types.js';
import type { EmiFacts } from './emi.js';

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
    total: number;
    sample: Array<{ name: string; startingPriceDisplay: string }>;
  }>;
  /**
   * AB-6 / W8 — the full builder name index, so a project NAMED from a cold start
   * ("is Brigade Oasis plotted?") resolves against the whole catalog, not just the
   * session shortlist. Type-only: no prices/facts.
   */
  projectNames(builderId: string): Promise<Array<{ projectId: string; name: string }>>;
  /** conversation-context when focused; getProject fallback otherwise. */
  projectDetail(builderId: string, ndConversationId: string, projectId: string): Promise<{
    projectId: string;
    name: string;
    microMarket: string;
    summary?: string;
    reraNumber?: string;
    possession?: string;
    projectType?: string;
    startingPriceDisplay?: string;
    khata?: string;
    naStatus?: string;
    ecStatus?: string;
    loanEligibility?: string;
    faqs?: ProjectFaq[];
    configurations?: UnitConfig[];
    /** W7 — one buyer-ready phase caveat (journey composer; pre-RERA gating). */
    phaseNote?: string;
    location?: LocationIntel;
  } | null>;
  pricing(builderId: string, ndConversationId: string, projectId: string, unitType?: string): Promise<{
    projectName: string;
    startingDisplay?: string;
    components: Array<{ label: string; value: string }>;
    withheld?: Array<{ label: string; redirectHint: string }>;
  } | null>;
  landedCost(builderId: string, ndConversationId: string, projectId: string, unitType: string): Promise<LandedCostFacts | null>;
  compare(ndConversationId: string, projectIds: string[]): Promise<{
    tableText: string;
    projects: Array<Record<string, unknown>>;
    matrix?: import('./types.js').CompareMatrixPayload;
  } | null>;
  priceBasis(builderId: string, ndConversationId: string, projectId: string, unitType?: string): Promise<{
    priceInr: number;
    display: string;
  } | null>;
  listUnits(projectId: string): Promise<UnitConfig[]>;
  mediaShare(ndConversationId: string, projectId: string, assetKind: string, unitType?: string): Promise<MediaShareResult | null>;
  conversationContext(ndConversationId: string): Promise<import('../crm/nayadesk-client.js').NdContextBundle | null>;
  /** Approved corridor value intel for a micro-market string; null = honest absence. */
  marketIntel(microMarket: string): Promise<import('../crm/nayadesk-client.js').NdMarketIntel | null>;
  objectionContext(ndConversationId: string): Promise<{
    playbooks: Array<{ topic: string; reframeAngles: string[]; escalateAfter: number }>;
    escalationPhone?: string;
  } | null>;
  siteVisitsItinerary(ndConversationId: string): Promise<readonly StoredVisit[]>;
  builder(builderId: string): Promise<{ siteVisitHours: string; name?: string; escalationPhone?: string } | null>;
  recordVisit(
    ids: { ndConversationId: string; buyerPhone: string; builderId: string },
    visit: { projectId: string; projectName: string; iso: string; label: string },
  ): Promise<boolean>;
  /**
   * Place a launch-ops hold on a unit of the given TYPE — Desk auto-picks the
   * cheapest available unit atomically (one-active-hold enforced by its DB),
   * so unit numbers never cross this port. reason 'none_available' = the type
   * sold out (surface it honestly); 'error' = transport/unknown (also honest).
   */
  placeHold(
    ids: { ndConversationId: string; builderId: string },
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
  /** Turn-start bundle — returning buyer, builder persona, recent messages, ledger prior. */
  bootstrapContext(ndConversationId: string): Promise<{
    returningBuyer?: { buyerName: string; daysSinceLastSeen: number; lastProjectId?: string };
    builderPersona?: { botName?: string; preferredTone?: string };
    recentMessages: Array<{ role: 'buyer' | 'bot'; text: string; atMs: number }>;
    rejectedProjectIds: string[];
    turnIndex: number;
    /** P2b — raw Desk prior row (mapped in turn bootstrap). */
    ledgerPrior?: import('./ledger-read.js').LedgerPriorRow | null;
  }>;
  geoAreasInRegion(region: string, builderId: string): Promise<Array<{ name: string; distanceKm: number }>>;
  resolveGeo(text: string): Promise<{ lat: number; lng: number } | null>;
  projectCoords(builderId: string): Promise<ReadonlyArray<{ projectId: string; lat: number; lng: number }>>;
  faqLookup(projectId: string, questionKey: string): Promise<{ question: string; answer: string } | null>;
  getProfile(builderId: string, buyerPhone: string): Promise<Record<string, unknown>>;
}

export interface EngineCrm {
  ensureLead(builderId: string, buyerPhone: string, channel?: string): Promise<{ conversationId: string } | null>;
  appendMessage(conversationId: string, direction: 'inbound' | 'outbound', content: string, meta?: { replyKey?: string }): Promise<void>;
  updateFacts(conversationId: string, facts: Record<string, string | undefined>): Promise<void>;
  commitProject(conversationId: string, projectId: string): Promise<void>;
  releaseProject(conversationId: string): Promise<void>;
  syncShortlist(conversationId: string, projectIds: string[]): Promise<void>;
  syncMatching(conversationId: string, projectIds: string[]): Promise<void>;
  setStage(
    conversationId: string,
    stage: 'new' | 'engaged' | 'qualified' | 'visit_booked' | 'escalated' | 'cold' | 'dropped',
    /** W5 — onlyForward: Desk skips the write if the lead is already at/past the rung. */
    opts?: { onlyForward?: boolean },
  ): Promise<void>;
  appendSharedFact(conversationId: string, factKind: string, projectId: string, turnIndex: number): Promise<void>;
  appendTurnLedger(entry: {
    conversationId: string;
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
    toolRuns?: Array<{ name: string; args_summary: string; success: boolean; latency_ms: number }>;
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
    conversationId: string,
    signals: Record<string, unknown>,
    extras?: { shortlistAdd?: string[]; rejectedAdd?: string[] },
  ): Promise<void>;
  postJourneyTurnSnapshot(
    builderId: string,
    buyerPhone: string,
    conversationId: string,
    goal: string,
    phase: string,
  ): Promise<void>;
  postProfileObservations(
    builderId: string,
    buyerPhone: string,
    conversationId: string,
    observations: Array<{ fact_key: string; value: unknown; provenance: string }>,
  ): Promise<void>;
  postChoiceEvent(
    builderId: string,
    buyerPhone: string,
    conversationId: string,
    matches: Array<{ projectId: string; name: string }>,
    constraints: Record<string, unknown>,
  ): Promise<void>;
  postChoiceResponse(conversationId: string, responseText: string, responseIntent?: string): Promise<void>;
  deleteBuyerMemory(conversationId: string): Promise<void>;
  mirrorMemory(conversationId: string): Promise<void>;
  /**
   * Understanding Flywheel Wave A — capture this turn into Desk's intent
   * review queue (feeds the /operations/understanding board + T1 grading).
   * Optional: wired only when UNDERSTANDING_CAPTURE is on. Deliberately does
   * NOT set the legacy embedder/llm voter fields, so the old retroactive
   * miner can never auto-promote from the bot's own confidence.
   */
  enqueueIntentReview?(payload: {
    builderId: string;
    conversationId: string;
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
}

export interface EngineStore {
  load(convId: string): Promise<import('./types.js').ConversationState | null>;
  save(state: import('./types.js').ConversationState): Promise<void>;
  logTurn(entry: {
    convId: string;
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
    'AI' | 'INTENT_VECTORS' | 'SIL_EMBED_MODEL' | 'SIL_INTENT_PROJECTION' | 'SIL_ROUTING_TAU' | 'SIL_EMBED_FIRST'
  >;
  /** P6 ExtractTurnFacts — after embedder abstain. */
  bamlExtract?: (input: import('./extract-baml.js').BamlExtractInput) => Promise<
    import('./extract-baml.js').BamlExtractResult | null
  >;
  bamlMode?: import('./extract-baml.js').BamlExtractMode;
  /** Failure-as-a-value Phase 0: shadow logging only, never behavior. */
  failureLog?: boolean;
  /** Failure-as-a-value Phase 1 behavior gate. */
  failureTools?: boolean;
  /** Local dev JSONL turn log (wrangler dev only). */
  emitTurnLog?: (entry: import('../observability/local-turn-log.js').LocalTurnLogEntry) => void;
}

export type { EmiFacts };
