/** ConverseEngine — pure data contract. No infra imports. */

export type Phase = 'discover' | 'focused' | 'visit' | 'handoff';

export interface Constraints {
  budgetMaxInr?: number;
  budgetMinInr?: number;
  bhk?: string;
  location?: string;
  propertyType?: string;
  purpose?: 'self_use' | 'investment';
}

export type ProbeKind = 'location' | 'budget' | 'bhk' | 'purpose';

export interface OfferedProject {
  projectId: string;
  name: string;
  microMarket?: string;
  startingPriceDisplay?: string;
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

export interface ConversationState {
  convId: string;
  builderId: string;
  phase: Phase;
  buyerName?: string;
  constraints: Constraints;
  discover: DiscoverState;
  focus?: FocusState;
  visit?: VisitState;
  turnCount: number;
  objectionCount?: number;
  ndConversationId?: string;
  ndBuyerPhone?: string;
  /** After visit_booked — next short ack should not escalate to handoff. */
  postVisitAckPending?: boolean;
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
  | { kind: 'probe'; slot: ProbeKind }
  | { kind: 'recommend' }
  | { kind: 'advance'; reason: 'same_set' }
  /** Shortlist has 2+ projects; buyer asked for details without naming which. */
  | { kind: 'clarify_project_pick' }
  | { kind: 'no_fit' }
  | { kind: 'ack_reject_recommend' }
  | { kind: 'objection'; topic: ObjectionTopic; projectId?: string }
  | { kind: 'answer'; topic: AnswerTopic; projectId: string; topics?: AnswerTopic[] }
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
    sizeDisplay?: string;
  }>;
  location?: {
    connectivitySummary?: string;
    microMarketOverview?: string;
    nearbyPois?: string[];
    driveTimes?: string[];
  };
}

export interface LocationEvidence {
  projectName: string;
  microMarket: string;
  connectivitySummary?: string;
  microMarketOverview?: string;
  nearbyPois?: string[];
  driveTimes?: string[];
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
  units?: Array<{ unitType: string; priceDisplay: string; sizeDisplay?: string }>;
  searchRecovery?: import('./recovery-planner.js').SearchRecoveryEnvelope;
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
}

export interface TurnDebug {
  phase: Phase;
  goal: TurnGoal;
  tools: string[];
  grounding: 'pass' | 'repaired';
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
