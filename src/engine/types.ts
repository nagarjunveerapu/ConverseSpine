/** ConverseEngine — pure data contract. No infra imports. */

export type Phase = 'discover' | 'focused' | 'visit' | 'handoff';

export interface Constraints {
  budgetMaxInr?: number;
  budgetMinInr?: number;
  bhk?: string;
  location?: string;
  propertyType?: string;
  purpose?: 'self_use' | 'investment';
  /** Soft prefs — provenance/compose only; not Desk locality invent. */
  nearAirport?: boolean;
  readyToMove?: boolean;
  /** Trade-off Advisor soft signals — persisted as BPE facts at Layer 13;
   *  never Desk search-filter tokens (the Desk resolves weights from BPE). */
  commuteHub?: string;
  priorityFocus?: 'commute' | 'budget' | 'balanced';
  schoolsMentioned?: boolean;
  /** Buyer's stated worries from the advisor brief ("overpaying", "daily traffic"). */
  worries?: string[];
  /** Buyer mentioned walkability ("walkable", "walking distance"). */
  walkabilityMentioned?: boolean;
  /** Buyer mentioned resale / appreciation ("resale value", "will it hold value"). */
  valueMentioned?: boolean;
  /** The size the buyer asked for, parsed from their own config words
   *  ("Quarter-Acre Plot (10,000 sqft)" → 10000). Desk prices THEIR unit. */
  askSizeSqft?: number;
  /** Buyer explicitly declined the commute angle ("not commute-driven").
   *  A declined dimension must never earn a phantom weight or a probe. */
  commuteDeclined?: boolean;
}

/** One ranked-dimension receipt from the Desk re-rank (see Desk
 *  advisor_rerank.ts DimensionFit) — evidence-grade, speakable verbatim. */
export interface DimensionFitReceipt {
  dimension: string;
  score: number;
  weight: number;
  evidence: string;
  good: boolean;
}

/** Structured absence: the buyer's top-weighted dimension a project has no
 *  data for. Rendered as an honest-unknown, never silently dropped. */
export interface DimensionGapReceipt {
  dimension: string;
  weight: number;
  label: string;
}

export type ProbeKind = 'location' | 'budget' | 'bhk' | 'purpose' | 'priority';

export interface OfferedProject {
  projectId: string;
  name: string;
  microMarket?: string;
  startingPriceDisplay?: string;
  /** Numeric price from the Desk match — kept so shortlist-wide computes
   *  (EMI fallback basis) never have to parse a display string. */
  startingPriceInr?: number;
  /** Desk-authored trade-off narration ("✓ 17 min to ITPL · ⚠ ₹15 L over…").
   *  Fallback voice only — compose renders from dimensionFit when present. */
  tradeoffNote?: string;
  dimensionFit?: DimensionFitReceipt[];
  dimensionGap?: DimensionGapReceipt;
}

export interface TranscriptMessage {
  text: string;
  role: 'buyer' | 'bot';
  atMs: number;
}

export interface DiscoverState {
  asked: ProbeKind[];
  rejectedProjectIds: string[];
  lastOffered: OfferedProject[];
  oriented: boolean;
  ignoredProbes: number;
  advancedOnce: boolean;
  /** Recent turns for anaphora ("both", "these") — newest last. */
  recentMessages?: TranscriptMessage[];
  /**
   * Projects the buyer has actually engaged with this session (focus, switch, named Q&A).
   * Used for "compare both" / "visit them" when lastOffered is still the search shortlist.
   */
  discussedProjects?: OfferedProject[];
}

export interface FocusState {
  projectId: string;
  projectName: string;
}

export interface QueuedVisit {
  projectId: string;
  projectName: string;
  slotText?: string;
}

export interface VisitState {
  projectId?: string;
  projectName?: string;
  slotText?: string;
  awaitingConfirm?: boolean;
  proposedLabel?: string;
  proposedIso?: string;
  queued?: QueuedVisit[];
  askCount?: number;
  lastAsk?: 'project' | 'day' | 'time' | 'origin' | 'window' | 'same_day_choice' | 'stagger_propose';
  /** Buyer-stated pickup origin for multi-stop routing. */
  originText?: string;
  originLat?: number;
  originLng?: number;
  originAsked?: boolean;
  /** Queue reordered once by travel from origin. */
  tripOrdered?: boolean;
  /** Day-only anchor pending morning/afternoon choice. */
  pendingDayIso?: string;
  pendingDayLabel?: string;
  /** Precomputed drive from last booked stop (Maps). */
  driveFromPriorMin?: number | null;
  driveSource?: 'distance_matrix' | 'haversine' | 'none';
}

/**
 * Unit-hold sub-flow (Phase 4 launch ops) — the inventory twin of VisitState.
 * A hold_propose turn sets awaitingConfirm; a bare affirmation on the NEXT
 * turn converts it to hold_booked (Desk auto-picks the cheapest available
 * unit of the type — unit numbers never surface in chat). Any other reply
 * clears the window (one-shot, like the visit confirm gate).
 */
export interface HoldState {
  awaitingConfirm?: boolean;
  unitType?: string;
  projectId?: string;
  projectName?: string;
  /** W2 — turn the offer was made/downgraded; a bare affirm within 6 turns re-proposes. */
  offeredAtTurn?: number;
  /** W7 — the type is sold out of available units: a confirm JOINS THE WAITLIST instead of holding. */
  queue?: boolean;
}

export interface ConversationState {
  convId: string;
  builderId: string;
  phase: Phase;
  buyerName?: string;
  constraints: Constraints;
  discover: DiscoverState;
  focus?: FocusState;
  visit?: VisitState;
  hold?: HoldState;
  turnCount: number;
  /** W5 — turns spent in the focused phase (drives the 'engaged' rung). */
  focusedTurns?: number;
  /** W5 — highest funnel rung already written to Desk (write-once, monotonic). */
  stageWritten?: 'engaged' | 'qualified';
  /** W3 — previous outbound reply (repeat guard compares against this). */
  lastReply?: string;
  objectionCount?: number;
  ndConversationId?: string;
  ndBuyerPhone?: string;
  /** After visit_booked — next short ack should not escalate to handoff. */
  postVisitAckPending?: boolean;
  /** Opt-out asked in a mixed message — delete buyer memory only after an explicit yes. */
  stopConfirmPending?: boolean;
  /** Cached NayaDesk project facts for focused / shortlisted projects. */
  projectCache?: Record<string, ProjectDetail>;
  /** Last-read confirmed visits from NayaDesk (itinerary mirror for board). */
  visitBookedCache?: Array<{
    projectId: string;
    projectName: string;
    iso: string;
    label: string;
  }>;
  /** From NayaDesk returning_buyer on turn bootstrap. */
  returningBuyer?: { buyerName: string; daysSinceLastSeen: number };
  /** Contextual turn intent session (recovery yes/no, chips). */
  rti?: import('./turn-intent/types.js').RtiState;
  /**
   * Last advisor-brief payload applied (values trimmed), keyed by pref field.
   * The SPA re-sends the whole brief every turn; in recovery only fields whose
   * value CHANGED vs this snapshot may overwrite server-side constraints.
   */
  advisorPrefsSnapshot?: Record<string, string>;
  /** P2b — structured prior from turn_ledger (gap-fill source; live KV wins). */
  feedForward?: import('./ledger-read.js').TurnFeedForward;
  /**
   * P2c — session-local disclosed facts (merged into compose + ledger write).
   * Survives within KV even before Desk prior round-trip.
   */
  disclosedFacts?: import('./disclosed-facts.js').DisclosedFact[];
}

export type ObjectionTopic =
  | 'price'
  | 'timeline'
  | 'reputation'
  | 'competition'
  | 'legal'
  | 'location'
  | 'custom';

export type AnswerTopic =
  | 'price'
  | 'legal'
  | 'emi'
  | 'amenities'
  | 'availability'
  | 'location'
  | 'media'
  | 'overview'
  | 'property_type'
  | 'compare';

export type TurnGoal =
  | { kind: 'greet' }
  | { kind: 'orient' }
  /**
   * Below-threshold fallback: the buyer asked something the engine could not
   * confidently route, OR a generative goal was reached with no evidence to
   * generate from. Acknowledge and ask ONE clarifying question — assert nothing.
   *
   * This exists because the alternative fallbacks (greet / orient / an objection
   * with zero reframe angles) all have GENERATIVE compose contracts, so reaching
   * them empty-handed is what makes the bot invent ("the hills offer better
   * views and natural cooling"). Recognition coverage is raised in the embedding
   * lane; this is what must happen when coverage misses.
   */
  | { kind: 'clarify_intent' }
  | { kind: 'probe'; slot: ProbeKind }
  | { kind: 'recommend' }
  | { kind: 'advance'; reason: 'same_set' }
  /** Shortlist has 2+ projects; buyer asked for details without naming which. */
  | { kind: 'clarify_project_pick' }
  | { kind: 'no_fit' }
  | { kind: 'ack_reject_recommend' }
  | { kind: 'objection'; topic: ObjectionTopic; projectId?: string }
  | { kind: 'answer'; topic: AnswerTopic; projectId: string; topics?: AnswerTopic[] }
  /** Facet ask over a multi-project shortlist with no pick — answer the facet
   *  for EVERY shortlisted project instead of asking which one to open. */
  | { kind: 'shortlist_answer'; topic: AnswerTopic; topics?: AnswerTopic[]; projectIds: string[] }
  | {
      kind: 'commit';
      projectId: string;
      projectName: string;
      followUp?: AnswerTopic;
      followUpTopics?: AnswerTopic[];
    }
  | { kind: 'propose_visit'; projectId?: string }
  | { kind: 'visit_ask'; ask: 'project' | 'day' | 'time' | 'origin' | 'window' | 'same_day_choice' | 'stagger_propose'; copy: string; state: VisitState }
  | { kind: 'visit_propose'; iso: string; label: string; projectName: string; projectId: string; copy: string; state: VisitState }
  | {
      kind: 'visit_booked';
      label: string;
      projectName: string;
      projectId: string;
      iso: string;
      /** Remaining stop after this booking — captured at confirm time. */
      nextQueuedStop?: { projectId: string; projectName: string; slotText?: string };
    }
  | { kind: 'visit_recall' }
  /** Offer to hold a unit of a TYPE — copy is deterministic; sets hold.awaitingConfirm. */
  | { kind: 'hold_propose'; projectId: string; projectName: string; unitType: string; copy: string; state: HoldState }
  /**
   * Confirmed — the evidence stage places the hold via Desk (auto-picked unit)
   * and stamps the outcome onto the goal for the deterministic confirmation copy.
   */
  | {
      kind: 'hold_booked';
      projectId: string;
      projectName: string;
      unitType: string;
      placed?: boolean;
      expiresLabel?: string;
      /** W7 — the confirm joined the waitlist (type sold out): queued + position. */
      queued?: boolean;
      position?: number;
    }
  | { kind: 'handoff' }
  | { kind: 'warm_ack' }
  | { kind: 'smalltalk' };

export interface Match {
  projectId: string;
  name: string;
  microMarket: string;
  startingPriceInr: number;
  startingPriceDisplay: string;
  matchReasons: string[];
  projectType?: string;
  /** Desk-authored trade-off narration; evidence-grade (speakable verbatim).
   *  Fallback voice only — compose renders from dimensionFit when present. */
  tradeoffNote?: string;
  /** Typed rank receipts (Desk advisor re-rank) — the four-questions source. */
  dimensionFit?: DimensionFitReceipt[];
  dimensionGap?: DimensionGapReceipt;
}

export interface CatalogEnvelope {
  priceMinInr: number;
  priceMaxInr: number;
  projectTypes: string[];
  microMarkets: string[];
  total: number;
  sample: Array<{ name: string; startingPriceDisplay: string }>;
}

export interface SearchFilters {
  budgetMaxInr?: number;
  budgetMinInr?: number;
  bhks?: string;
  locations?: string;
  projectTypes?: string;
  purpose?: 'self_use' | 'investment';
  searchText?: string;
  maxResults?: number;
  /** Desk conversations row id. Recommend path only — lets the Desk resolve
   *  the buyer's BPE preference weights and re-rank + narrate trade-offs.
   *  Never set for catalog/facet/recovery-count calls. */
  conversationId?: string;
  /** Explicit in-state weights (advisor-weights.ts) — win over conversationId
   *  resolution Desk-side; close the same-turn persist race. */
  preferenceWeights?: Record<string, number>;
  commuteHub?: string;
  /** Buyer's asked size — Desk's budget dimension prices THEIR unit. */
  askSizeSqft?: number;
  budgetTargetInr?: number;
}

export interface PricingEvidence {
  projectName: string;
  startingDisplay?: string;
  components: Array<{ label: string; value: string }>;
}

export interface CompareMatrixPayload {
  projects: Array<{ project_id: string; name: string }>;
  rows: Array<{ key?: string; label: string; values: readonly string[] }>;
}

export interface CompareEvidence {
  tableText: string;
  projects: Array<{
    name?: string;
    micro_market?: string;
    starting_price_lakhs?: number;
    possession_date?: string;
    project_type?: string;
  }>;
  matrix?: CompareMatrixPayload;
}

export interface ProjectDetail {
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
  faqs?: Array<{ questionKey: string; question: string; answer: string }>;
  configurations?: Array<{
    unitType: string;
    priceDisplay: string;
    priceMinInr: number;
    /** Band high end — the overview card renders one low–high band from configs. */
    priceMaxInr?: number;
    sizeDisplay?: string;
    /** W7 — live count of holdable physical units of this type (Desk #203). */
    holdableUnits?: number;
  }>;
  /** W7 — one buyer-ready phase caveat ("Phase 2 is pre-RERA — booking opens at registration"). */
  phaseNote?: string;
  location?: {
    connectivitySummary?: string;
    microMarketOverview?: string;
    nearbyPois?: string[];
    driveTimes?: string[];
  } & LocationPoiCategories;
}

/** One named place from Desk location_intelligence — always Desk-verified, never invented. */
export interface LocationPoi {
  name: string;
  distanceKm?: number;
  driveMinutes?: number;
}

/** Structured POI categories from Desk `location_intelligence` (S1 — LI evidence unlock). */
export interface LocationPoiCategories {
  schools?: LocationPoi[];
  hospitals?: LocationPoi[];
  metroStations?: LocationPoi[];
  airports?: LocationPoi[];
  itParks?: LocationPoi[];
  malls?: LocationPoi[];
  transitStations?: LocationPoi[];
  universities?: LocationPoi[];
  supermarkets?: LocationPoi[];
  parks?: LocationPoi[];
  upcomingInfra?: string[];
}

export type LocationCategoryKey = Exclude<keyof LocationPoiCategories, 'upcomingInfra'>;

export interface LocationEvidence extends LocationPoiCategories {
  projectName: string;
  microMarket: string;
  connectivitySummary?: string;
  microMarketOverview?: string;
  nearbyPois?: string[];
  driveTimes?: string[];
  /** Categories the buyer explicitly asked about — compose leads with these. */
  askedCategories?: readonly LocationCategoryKey[];
}

export interface MediaEvidence {
  projectName: string;
  allowed: boolean;
  title?: string;
  cdnUrl?: string;
  assetKind?: string;
  reason?: string;
  redirectHint?: string;
}

export interface EmiEvidence {
  emiFormatted: string;
  principalFormatted: string;
  downPaymentFormatted?: string;
  basisFormatted: string;
  ratePercent: number;
  tenureYears: number;
}

export interface LandedCostEvidence {
  projectName: string;
  unitType: string;
  baseDisplay: string;
  oneTime: Array<{ label: string; display: string }>;
  recurring: Array<{ label: string; display: string }>;
  totalDisplay: string;
  disclaimer?: string;
}

export interface VisitEvidence {
  visits: Array<{ projectName: string; label: string; confirmed: boolean }>;
  siteVisitHours?: string;
}

export interface ObjectionEvidence {
  topic: ObjectionTopic;
  acknowledged: string;
  reframeAngles: string[];
}

export interface EvidenceSet {
  tools: string[];
  matches?: Match[];
  /**
   * The buyer named an area we could not match, so the search fell back to an
   * area-less one. Compose MUST NOT present these matches as fitting that area.
   * The area string itself is deliberately NOT carried: the capture may be
   * dialogue noise, and echoing noise back is its own defect.
   */
  areaFilterDropped?: boolean;
  catalog?: CatalogEnvelope;
  floor?: { display: string; projectName?: string };
  budgetGap?: {
    budgetDisplay: string;
    location?: string;
    closestName: string;
    closestDisplay: string;
    closestProjectId?: string;
  };
  propertyTypeGap?: {
    requestedType: string;
    budgetDisplay?: string;
    /** Locality the type was asked in — "no plantation IN WHITEFIELD" beats "no plantation". */
    location?: string;
    closestName: string;
    closestDisplay: string;
    closestProjectId?: string;
  };
  typeFloor?: {
    propertyType: string;
    projectName: string;
    display: string;
  };
  constraintGap?: {
    blocking: 'bhk' | 'budget' | 'joint';
    bhk?: string;
    budgetDisplay?: string;
    location?: string;
    alternateProject?: string;
    alternateProjectId?: string;
    alternatePriceDisplay?: string;
    configFloorDisplay?: string;
  };
  noMatch?: { reasoning: string; nearby: string[] };
  nextSlot?: ProbeKind;
  detail?: ProjectDetail;
  pricing?: PricingEvidence;
  compare?: CompareEvidence;
  objection?: ObjectionEvidence;
  escalationPhone?: string;
  location?: LocationEvidence;
  media?: MediaEvidence;
  emi?: EmiEvidence;
  landedCost?: LandedCostEvidence;
  visits?: VisitEvidence;
  /** holdableUnits: live per-type availability (AB-1). Positive = real count; 0/absent = unknown (Desk sends 0 when a project tracks no units). */
  units?: Array<{ unitType: string; priceDisplay: string; sizeDisplay?: string; holdableUnits?: number }>;
  /** FAQ-shaped ask where Desk had no row for the resolved key(s).
   *  taught: the missed key came from a human-taught facet bind (not buyer
   *  text) — the floor renders the honest miss instead of the overview card. */
  faqMiss?: { keys: string[]; taught?: boolean };
  /** Per-project values for a facet asked across the whole shortlist
   *  (shortlist_answer). Empty `value` = honestly not on file for that project. */
  shortlistFacet?: ShortlistFacetEvidence;
  searchRecovery?: import('./recovery-planner.js').SearchRecoveryEnvelope;
}

export interface ShortlistFacetEvidence {
  facets: Array<{
    topic: AnswerTopic;
    label: string;
    perProject: Array<{ projectId: string; name: string; value: string }>;
  }>;
}

export interface Extracted {
  constraints: Partial<Constraints>;
  rejected?: boolean;
  rejectedName?: string;
  pickOrdinal?: number;
  pickName?: string;
  affirm?: boolean;
  decline?: boolean;
  nameIntro?: string;
  transition?: 'want_details' | 'see_others' | 'want_visit' | 'none';
  askTopic?: AnswerTopic;
  askTopics?: AnswerTopic[];
  implicitProjectPick?: boolean;
  isQuestion?: boolean;
  objection?: boolean;
  objectionTopic?: ObjectionTopic;
  wantsMore?: boolean;
  recall?: boolean;
  /** Deterministic hold-intent gate (hold-intent.ts) — stamped by the extract funnel. */
  holdAsk?: boolean;
  visitSlotText?: string;
  emiRatePercent?: number;
  emiTenureYears?: number;
  mediaAssetKind?: string;
  namedProjects?: OfferedProject[];
  compareAdvice?: boolean;
  compareProjectIds?: string[];
  smalltalk?: boolean;
  stop?: boolean;
  /** Short ack after visit booked ("okay", "thanks") — not a handoff trigger. */
  postVisitAck?: boolean;
  /** "Do they come in 20L?" — feasibility ask, not a project detail follow-up. */
  budgetFitQuestion?: boolean;
  /** "Which fits my budget best?" — compare/advise among shortlist. */
  budgetPickQuestion?: boolean;
  /** Recovery chip applied — re-list matches even if same as last turn. */
  forceRecommendList?: boolean;
  /** SA-0: resolved speech act (chip path / free-text→chip). */
  speechAct?: import('./speech-act/types.js').SpeechActKind;
  /** SA-0: primary (+ optional secondary) chip path ids. */
  chipPathIds?: import('./speech-act/types.js').ChipPathId[];
}

export interface ComposeContext {
  buyerName?: string;
  constraints: Constraints;
  alreadyShownSameSet: boolean;
  builderName: string;
  buyerText?: string;
  focusProjectName?: string;
  returningBuyer?: { buyerName: string; daysSinceLastSeen: number };
  /** P2c — from TurnFeedForward / ledger prior. */
  priorTopics?: string[];
  priorReplyExcerpt?: string;
  disclosedFacts?: Array<import('./disclosed-facts.js').DisclosedFact | Record<string, unknown>>;
}

export interface ComposeRequest {
  goal: TurnGoal;
  evidence: EvidenceSet;
  context: ComposeContext;
  /** W3 — anti-repeat retry: draft again with fresh wording (one bounded use). */
  vary?: boolean;
  /** W1 — grounding retry: the previous draft stated these unbacked values; use EVIDENCE only. */
  repair?: { unbacked: string[] };
}

export interface TurnDebug {
  phase: Phase;
  goal: TurnGoal;
  tools: string[];
  /** 'recomposed' (W1) = draft failed grounding, ONE retry with the violations fed back succeeded. */
  grounding: 'pass' | 'repaired' | 'recomposed';
  /** W3 — repeat guard outcome, present only when the guard fired. */
  repeat_guard?: 'recomposed' | 'template' | 'still_identical';
  /** Set at ingress — chip tap vs typed message. */
  input_source?: import('./ingress.js').TurnInputSource;
  /** Per-field extract provenance (free-text funnel). */
  extract_provenance?: import('./ingress.js').ExtractProvenance;
  /** SA-0: chip-canonical speech act for this turn. */
  speech_act?: import('./speech-act/types.js').SpeechActKind;
  /** SA-0: resolved chip path ids (primary first). */
  chip_path_ids?: import('./speech-act/types.js').ChipPathId[];
  /** W2/W6: shortlist size after turn (stale-board asserts). */
  last_offered_count?: number;
  last_offered_ids?: string[];
}
