/** ConverseEngine — pure data contract. No infra imports. */

// Type-only, and engine-local: emi.ts is arithmetic over outcome.ts and imports
// nothing from here, so this cannot cycle.
import type { Affordability } from './emi.js';

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

export type ConstraintAuthorityKey = 'location' | 'propertyType' | 'bhk' | 'budget';
export type ConstraintAuthority = 'declared' | 'inferred';

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

export type ProbeKind =
  | 'location'
  | 'budget'
  | 'bhk'
  | 'purpose'
  | 'priority'
  | 'propertyType'
  | 'worries'
  | 'schools'
  | 'hub';

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
  /**
   * Phase 1c — revive-only legacy board. Authority is `shortlistIds` + entities.
   * Hydrated once on load via `hydrateLegacyDiscourse`; never write-through.
   */
  lastOffered: OfferedProject[];
  oriented: boolean;
  ignoredProbes: number;
  advancedOnce: boolean;
  /**
   * WA minimal brief (builder-allotted lines) — pending step after the buyer
   * taps “Help me choose”. Two steps max: size, then budget. Cleared on a
   * project pick, the Projects menu, or once both facts are known.
   */
  waBriefStep?: 'size' | 'budget';
  /** Recent turns for anaphora ("both", "these") — newest last. */
  recentMessages?: TranscriptMessage[];
  /**
   * Phase 1c — revive-only legacy discussed list. Authority is `discussedList`.
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

export interface VisitTeamRequest {
  projectId: string;
  projectName: string;
  preferredDateIso?: string;
  reason: 'outside_hours' | 'overpacked' | 'buyer_late_time';
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
  lastAsk?:
    | 'project'
    | 'day'
    | 'time'
    | 'origin'
    | 'window'
    | 'same_day_choice'
    | 'stagger_propose'
    | 'which_projects'
    | 'split_day'
    | 'team_request';
  /** Discussed candidates shown in which-projects chooser (ordered). */
  candidateIds?: Array<{ projectId: string; projectName: string }>;
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
  /** Prefer next/other day for remaining queue after split warn. */
  preferredDayHint?: 'next' | 'other' | 'same_forced';
  /** Split-day warn already shown; awaiting accept/force. */
  splitOffered?: boolean;
  /** Overflow stops pending team confirmation (not firm-booked). */
  pendingTeamRequests?: VisitTeamRequest[];
  /** Awaiting yes to confirm firm stops + file team requests. */
  awaitingTeamRequestConfirm?: boolean;
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
  /** Durable origin strength used by the per-turn relaxation planner. */
  constraintAuthority?: Partial<Record<ConstraintAuthorityKey, ConstraintAuthority>>;
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
  /**
   * Fingerprints of the last few outbound lines, newest first. `lastReply`
   * catches a line sent twice in a row; over 12 long conversations the repeats
   * that actually landed were three and four turns apart — the same "which one?"
   * menu at turns 7, 9, 10 and 13. A window of one cannot see a loop.
   */
  recentReplies?: string[];
  objectionCount?: number;
  /** Hybrid — count of sync DeepSeek compose/extract calls this conversation. */
  llmUsedCount?: number;
  ndConversationId?: string;
  ndBuyerPhone?: string;
  /** After visit_booked — next short ack should not escalate to handoff. */
  postVisitAckPending?: boolean;
  /**
   * The project this conversation has already booked a visit to. Booking
   * DELETES `visit`, so without this the next visit-shaped turn ("and can my
   * brother come too") re-asked "which day and time" one turn after saying
   * "Done — your visit is set for Saturday at 10:30 AM".
   */
  lastBookedProjectId?: string;
  /** One-shot: the booked slot has been read back, so a real change may re-ask. */
  visitRebookOffered?: boolean;
  /**
   * What we already worked out from a monthly figure the buyer gave. Turn 2:
   * "i can pay 55000 a month" → "about ₹63 L of loan, roughly ₹79 L of home".
   * Turns 5, 9, 10 and 12: "I need a loan amount before I can work that out."
   * The number was ours — derived, spoken, and then forgotten. Asking for it
   * back is amnesia, not honesty.
   */
  affordability?: Affordability & { fromIncome: boolean };
  /** Opt-out confirmation/disambiguation is active. */
  stopConfirmPending?: boolean;
  /** Whether the pending turn confirms explicit deletion or clarifies contact scope. */
  stopConfirmMode?: 'delete_confirm' | 'contact_scope';
  /** Cached NayaDesk project facts for focused / shortlisted projects. */
  projectCache?: Record<string, ProjectDetail>;
  /**
   * Phase 1 — discourse entity store (entity-store.ts). 1c authority for
   * shortlist card payload + discourse roles. Legacy lastOffered /
   * discussedProjects are revive-only (not mirrored). Spine KV only.
   *
   * JSON-safe by construction: a Record of plain records, never a Map, because
   * store-kv.ts persists this with JSON.stringify and a Map round-trips to {}.
   */
  entities?: Record<string, import('./entity-store.js').DiscourseEntityRecord>;
  /** Focus history, most recent first. Depth > 1 powers "the other one" /
   *  "go back" via salience; legacy `focus` still dual-writes for phase gates. */
  focusStack?: string[];
  /** Phase 1c — current board order (search rank). Source for currentShortlist(). */
  shortlistIds?: string[];
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
  /**
   * Last configuration the bot answered for this focus (e.g. "2 BHK (Ivory)").
   * Price / all-in / media follow-ups must prefer this unit over bare BHK.
   */
  focusUnit?: import('./focus-unit.js').FocusUnit;
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
  | 'compare'
  /** Platform buyer-education literacy answer (not a project FAQ). */
  | 'education';

export type FactKey =
  | 'carpet_area'
  | 'built_up_area'
  | 'possession'
  | 'rera'
  | 'khata'
  | 'ec_status'
  | 'loan_eligibility'
  | 'project_type'
  | 'price'
  /** Statutory add-ons — stamp duty, registration, GST — from the cost sheet. */
  | 'stamp_duty'
  /** The comparable unit rate. Only ever spoken from a published size + price. */
  | 'price_per_sqft'
  | 'flood_zone'
  | 'rental_yield'
  /** Corridor appreciation from approved micro_market_intel. */
  | 'appreciation'
  /** Corridor growth drivers from approved micro_market_intel. */
  | 'growth_drivers'
  /** Operator / revenue / maintenance model from project investment fields. */
  | 'operator_model'
  /** Site-visit logistics (pickup, parking, food, hours). */
  | 'visit_logistics';

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
  /**
   * `askedTopic` — the buyer asked something of the BOOK before picking a
   * project ("price?", "rera number first", "send the brochure"). The list is
   * still the right screen, but the reply owes an answer to the question it was
   * given: the book's own range where the book has one, and an honest "that
   * lives per project — pick one" where it doesn't. Without this the turn fell
   * to clarify_intent and replied "tell me a size or budget", throwing the
   * buyer's question away because it carried no filter.
   */
  | {
      kind: 'recommend';
      askedTopic?: AnswerTopic;
      /**
       * A question about the LINE or the BOOK rather than a property — "are you
       * a bot?", "do I pay commission?", "which is the cheapest?". The list is
       * still the right screen; this says what the reply owes first.
       */
      bookQuestion?: import('./book-questions.js').BookQuestion;
      /**
       * The buyer described their own situation rather than asking anything —
       * "this is my first home", "we have two small kids". The list is still
       * the right screen; this says what the reply owes before it.
       */
      situation?: import('./book-questions.js').Situation;
    }
  | { kind: 'advance'; reason: 'same_set' | 'cta_decline' }
  /** Shortlist has 2+ projects; buyer asked for details without naming which. */
  | { kind: 'clarify_project_pick' }
  /**
   * Discourse deixis / compare cannot resolve honestly — ask, don't recycle overview.
   * - no_alternate: "the other one" with only the focused project in play
   * - no_prior_focus: "go back" with stack depth 1
   * - need_pair_to_compare: "compare both" with &lt;2 discourse projects
   * - ambiguous_alternate: "the other one" with 2+ non-focus candidates
   */
  | {
      kind: 'clarify_discourse';
      reason: 'no_alternate' | 'no_prior_focus' | 'need_pair_to_compare' | 'ambiguous_alternate';
      projectName: string;
      /** For ambiguous_alternate — names the buyer can pick. */
      alternateNames?: string[];
    }
  | { kind: 'no_fit' }
  | { kind: 'ack_reject_recommend' }
  | { kind: 'objection'; topic: ObjectionTopic; projectId?: string }
  | {
      kind: 'answer';
      topic: AnswerTopic;
      projectId: string;
      topics?: AnswerTopic[];
      /** Multi-intent Phase C — topics beyond the top-2 answered this turn. */
      parkedTopics?: AnswerTopic[];
      requires?: FactKey[];
      /**
       * The buyer asked something specific and NOTHING was recognised, so the
       * topic fell back to `overview` as a DEFAULT rather than as evidence.
       * Compose must say so plainly instead of reciting the project card — the
       * card does not answer "share the location pin", and printing the same
       * card for two different questions is how the bot reads as not listening.
       */
      unrecognised?: boolean;
    }
  /** EMI from a buyer-stated principal; no project pick or price lookup required. */
  | { kind: 'emi_calculate' }
  /** Facet ask over a multi-project shortlist with no pick — answer the facet
   *  for EVERY shortlisted project instead of asking which one to open. */
  | {
      kind: 'shortlist_answer';
      topic: AnswerTopic;
      topics?: AnswerTopic[];
      parkedTopics?: AnswerTopic[];
      projectIds: string[];
    }
  | {
      kind: 'commit';
      projectId: string;
      projectName: string;
      followUp?: AnswerTopic;
      followUpTopics?: AnswerTopic[];
    }
  | { kind: 'propose_visit'; projectId?: string }
  | {
      kind: 'visit_ask';
      ask:
        | 'project'
        | 'day'
        | 'time'
        | 'origin'
        | 'window'
        | 'same_day_choice'
        | 'stagger_propose'
        | 'which_projects'
        | 'split_day'
        | 'team_request';
      copy: string;
      state: VisitState;
    }
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
  /** Echo stored hard prefs (budget/area/BHK) — not visit booking recall. */
  | { kind: 'recall_constraints' }
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
  /** Every project name for this builder. Free: the same Desk call already
   *  returns the rows. The name resolvers need the full set to know which words
   *  pick out one project (name-index.ts). */
  projectNames?: Array<{ projectId: string; name: string }>;
  /** Desk cityFromLocation aggregate — outside-served city cover bit. */
  servedCities?: string[];
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

/** Approved corridor intel — CS-gated by confidence ≥ τ before attach. */
export interface ProjectMarketIntel {
  displayName: string;
  appreciation3yrPct?: number;
  appreciation5yrPct?: number;
  corridorMaturity?: string;
  rentBands: Array<{ unitType?: string; rentMinInr?: number; rentMaxInr?: number }>;
  drivers: Array<{ event: string; date?: string; note?: string }>;
  provenance: { source: string; asOf: string; confidence: number };
  /** Buyer-ready provenance tag, e.g. "(99acres, 2026-Q2)". */
  provenanceLabel: string;
}

export interface ProjectInvestment {
  expectedRoi?: string;
  revenueModel?: string;
  operatorBrand?: string;
  guaranteedPayment?: string;
  maintenanceModel?: string;
  targetBuyerProfiles?: string[];
  categoryTags?: string[];
  landClassification?: string;
  buildCoverage?: string;
  launchStage?: string;
}

export interface ProjectVisitLogistics {
  pickupMode?: string;
  pickupOriginCities?: string;
  pickupRadiusKm?: number;
  pickupCostNote?: string;
  parkingOnSite?: string;
  foodOffered?: string;
  accommodationOffered?: string;
  visitDurationNote?: string;
  siteVisitHours?: string;
}

export interface ProjectDetail {
  projectId: string;
  /**
   * The project's real name. NEVER the projectId — a slug is not a name, and a
   * cached one is spoken to the buyer on every later turn.
   */
  name: string;
  microMarket: string;
  /**
   * Identity + units only: built from the search result because Desk's
   * conversationContext is focus-scoped and this project was not the focus.
   * Cached like any card, but re-hydrated on the next read so a project that
   * later becomes the focus picks up its full record.
   */
  identityOnly?: boolean;
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
  /** Active phases with per-phase RERA/possession when Desk ships them. */
  phases?: Array<{
    phaseId: string;
    phaseLabel: string;
    stage: string;
    possession?: string;
    reraNumber?: string;
  }>;
  /** Distinct media asset_kind values on the focused project (inventory gate). */
  mediaKinds?: string[];
  location?: {
    connectivitySummary?: string;
    microMarketOverview?: string;
    nearbyPois?: string[];
    driveTimes?: string[];
  } & LocationPoiCategories;
  /** Approved micro-market intel (yield / appreciation / drivers). */
  marketIntel?: ProjectMarketIntel;
  /** Project investment / operator fields from the catalog row. */
  investment?: ProjectInvestment;
  visitLogistics?: ProjectVisitLogistics;
  /** Parsed from project.spec_json when structured. */
  amenities?: string[];
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
  /** Desk mime when share returns it (image/png, application/pdf, …). */
  mimeType?: string;
  reason?: string;
  redirectHint?: string;
}

export interface EmiEvidence {
  emiFormatted: string;
  principalFormatted: string;
  downPaymentFormatted?: string;
  basisFormatted: string;
  basisKind: 'explicit_principal' | 'project_price';
  ltvPercent?: number;
  /** Phase 1 copy contract: name principal/basis, rate, and tenure. */
  discloseInputs?: boolean;
  ratePercent: number;
  tenureYears: number;
  /**
   * Set when the basis came from something the buyer said on an EARLIER turn
   * rather than this one. Computing on a remembered number is right; doing it
   * silently is not — the reply names where the figure came from so a buyer
   * whose circumstances changed can correct it.
   */
  basisSource?:
    | { kind: 'buyer_monthly'; monthlyInr: number; fromIncome: boolean }
    | { kind: 'buyer_budget'; budgetInr: number };
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

/**
 * A dimension of the buyer's ask a search had to relax to return anything.
 *
 * `type` is deliberately absent: AB-2 makes a declared property type a HARD
 * filter that is never relaxed (padding a "villa" list with a plantation
 * misleads), so it can never appear here.
 */
export type RelaxedDimension = 'type' | 'area' | 'size' | 'budget';

export interface EvidenceSet {
  tools: string[];
  /** Phase 0b — wall-clock ms per tool name (last call wins). */
  toolLatencyMs?: Record<string, number>;
  /** Phase 0b — absent vs transport when the port returned !ok. */
  toolFailureReason?: Record<string, 'absent' | 'transport'>;
  matches?: Match[];
  /**
   * Dimensions of the buyer's ask that had to be RELAXED for these matches to
   * exist. Compose MUST NOT present relaxed matches as satisfying the original
   * ask — broadening exists so the buyer is never dead-ended (RTI-D+ "list
   * three projects on first brief"), not so we can claim a fit we don't have.
   *
   * Dimensions only, never the buyer's raw values: a location capture may be
   * dialogue noise, and echoing noise back is its own defect.
   */
  relaxed?: RelaxedDimension[];
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
  /**
   * Empty-locality widen: nothing in `asked`, but `matches` are nearby /
   * in-city alternatives. Compose must name the miss — never present as a fit.
   */
  localityWiden?: {
    asked: string;
    nearbyAreas?: string[];
    /** When set, exact fit already shown — copy says "other/also", not "I don't have". */
    exactFitName?: string;
  };
  /**
   * Singleton (or thin) exact fit with same-type inventory outside `asked`.
   * Board stays exact; compose/chips offer an opt-in nearby widen.
   */
  nearbyOffer?: {
    asked: string;
    nearbyAreas: string[];
    previewNames?: string[];
  };
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
  /**
   * The comparable rate, derived where a published size and a published price
   * meet. Computed in the evidence layer so the division happens once and
   * compose only formats it — and so the answer contract can tell "we worked
   * out a rate" apart from "we have a price".
   */
  perSqft?: {
    projectName: string;
    rows: Array<{ unitType: string; rateInr: number }>;
  };
  /** FAQ-shaped ask where Desk had no row for the resolved key(s).
   *  taught: the missed key came from a human-taught facet bind (not buyer
   *  text) — the floor renders the honest miss instead of the overview card. */
  faqMiss?: { keys: string[]; taught?: boolean };
  /** Platform buyer-education hit (definition policy class). Not detail.faqs. */
  education?: import('./education.js').EducationEvidence;
  /** Terminal stage failure; the single failure speaker owns buyer copy. */
  failure?: import('./outcome.js').Failure;
  /** Supported atoms actually present in structured evidence. */
  deliveredFacts?: FactKey[];
  /** Missing atoms on a partial-success answer; fixed copy comes from speakFailure. */
  notices?: import('./outcome.js').Failure[];
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
  /** "What was my budget / which area did I pick?" — echo constraints, not visit list. */
  recallConstraints?: boolean;
  /** Deterministic hold-intent gate (hold-intent.ts) — stamped by the extract funnel. */
  holdAsk?: boolean;
  visitSlotText?: string;
  emiRatePercent?: number;
  emiTenureYears?: number;
  /** Explicit loan principal stated in an EMI ask; never a search budget. */
  emiPrincipalInr?: number;
  /**
   * "I can pay 55000 a month" / "I take home 1.5 lakhs a month", converted.
   * Held on the turn so the state layer can keep it: the buyer states their
   * budget in the unit they think in exactly once, and every money answer
   * afterwards is owed that number.
   */
  affordability?: Affordability & { fromIncome: boolean };
  /** Phase 1 extraction/goal contract is active for this EMI turn. */
  emiContractV1?: boolean;
  mediaAssetKind?: string;
  namedProjects?: OfferedProject[];
  /**
   * Name-shaped tokens the buyer used that did not bind to any session/catalog
   * project. Distinguishes "named nothing" from "named something unbound" so
   * compare fall-through does not pool-guess the shortlist (SUBJECT PR-2).
   */
  unboundProjectNames?: string[];
  compareAdvice?: boolean;
  compareProjectIds?: string[];
  smalltalk?: boolean;
  stop?: boolean;
  /** Short ack after visit booked ("okay", "thanks") — not a handoff trigger. */
  postVisitAck?: boolean;
  /**
   * Buyer wants a person — escalation, a callback, or a complaint to log.
   * Written ONLY by the intent authority (turn-routing/intent-authority.ts),
   * for kinds no other layer owns. Extraction never sets this, so there is no
   * second writer to arbitrate against.
   */
  wantsHuman?: boolean;
  /** "Do they come in 20L?" — feasibility ask, not a project detail follow-up. */
  budgetFitQuestion?: boolean;
  /** "Which fits my budget best?" — compare/advise among shortlist. */
  budgetPickQuestion?: boolean;
  /** Recovery chip applied — re-list matches even if same as last turn. */
  forceRecommendList?: boolean;
  /** Open-ended first-home / help-me-start — discovery ladder, not clarify. */
  firstHomeHelp?: boolean;
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
  /** Voice gate — advisor_web gets consultative framing; default WhatsApp. */
  channel?: 'whatsapp' | 'advisor_web';
  /** Skip area/budget interview — show the allotted book. */
  waProjectFirst?: boolean;
  /** How many configs the just-picked project has, when the chrome will offer
   *  them as rows. The confirm copy has to name what is actually on screen. */
  waSizeOptions?: number;
  /** Stage 7 — named latch when Desk provides sales contact. */
  handoffPhone?: string;
  handoffTeamName?: string;
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
  repeat_guard?: 'recomposed' | 'template' | 'still_identical' | 'acknowledged' | 'loop_broken';
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
  /** Soft nearby-widen CTA attached this turn (chips / WA buttons). */
  nearby_offer?: { asked: string; nearbyAreas: string[]; label: string };
  /** Hybrid — wall-clock stage timings (ms). */
  timings?: {
    /** Wall before extractT0 (store.load, L2 seed, bootstrap, turnIntent, catalog, …). */
    pre_extract_ms?: number;
    extract_ms?: number;
    /** Extract end → goalT0 (routing / catalog name / location / phase prep). */
    mid_pre_goal_ms?: number;
    /** Desk catalog-name resolve wall inside mid (0 when catalog.projectNames reused). */
    mid_catalog_ms?: number;
    /** Location validate / outside-served Desk wall inside mid. */
    mid_location_ms?: number;
    /** Visit phase Desk prep wall inside mid (coords/geo/builder/itinerary). */
    mid_phase_prep_ms?: number;
    /** Awaited classifyTurnRouting wall inside mid_pre_goal (0 when early reuse). */
    routing_ms?: number;
    evidence_ms?: number;
    compose_ms?: number;
    goal_ms?: number;
    /** After compose until store.save starts (L2 write, prefetch, RTI/transcript, setStage, …). */
    post_compose_ms?: number;
    store_save_ms?: number;
    /** Sync CRM before waitUntil (ensureLead / setStage) — nests inside pre/post. */
    crm_pre_ms?: number;
    total_ms?: number;
    embed_ms?: number;
    desk_ms?: number;
  };
  /** L1–L4 TURN_CACHE hit/miss. */
  cache?: {
    seg?: 'hit' | 'miss' | 'skip';
    proj?: 'hit' | 'miss' | 'skip';
    emb?: 'hit' | 'miss' | 'skip';
    search?: 'hit' | 'miss' | 'skip';
  };
  /** Hybrid — sync DeepSeek used this turn. */
  llm_used?: boolean;
  /** Hybrid — paid call timed out or rate-capped → template. */
  llm_shed?: boolean;
  /** Hybrid — compose path used voice template (not LLM). */
  compose_template?: boolean;
}
