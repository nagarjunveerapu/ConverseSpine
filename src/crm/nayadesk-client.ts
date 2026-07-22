import type { Env } from '../env.js';

export class NayaDeskError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(`${path} → ${status}: ${message}`);
    this.name = 'NayaDeskError';
  }
}

export interface NdConversation {
  conversation_id: string;
  builder_id: string;
  buyer_phone: string;
  buyer_name: string;
  status: string;
  bhk_preference: string;
  budget_inr: string;
  visit_date_pref: string;
  location_pref: string;
  project_id: string;
  purpose: string;
  pending_action: string;
  pending_action_payload: string;
  project_state: 'discovery' | 'shortlist' | 'focused';
  shortlist_project_ids: string;
  turn_count: number;
}

export interface NdProjectSummary {
  project_id: string;
  name: string;
  micro_market: string;
  rera_number: string;
  entry_price_band: string;
  possession_date?: string;
  khata_type?: string;
  na_status?: string;
  ec_status?: string;
  loan_eligibility?: string;
  summary?: string;
}

/**
 * Raw Desk `location_intelligence` row (S1). Every category column is a JSON
 * array string of `{name, distance_km, rating, drive_minutes}` POIs from the
 * Places refresh job; `upcoming_infra` may hold plain strings.
 */
export interface NdLocationIntelRow {
  metro_stations?: string;
  schools?: string;
  hospitals?: string;
  it_parks?: string;
  malls?: string;
  airports?: string;
  transit_stations?: string;
  universities?: string;
  supermarkets?: string;
  parks?: string;
  pois?: string;
  upcoming_infra?: string;
}

export interface NdContextBundle {
  conversation: NdConversation;
  project: NdProjectSummary | null;
  units?: Array<{
    unit_type?: string;
    price_display?: string;
    price_min_paise?: number;
    /** Band high end (overview card renders low–high from configs). */
    price_max_paise?: number;
    /** W7 — live count of available physical units of this type (Desk #203). */
    holdable_units?: number;
  }>;
  faqs?: Array<{ question_key?: string; canonical_question?: string; approved_answer?: string }>;
  /** W7 — journey composer output per active phase (Desk Phase 1; was silently dropped). */
  phase_journeys?: Array<{
    phase_id: string;
    phase_label: string;
    stage: string;
    possession_date?: string;
    modules: string[];
    money_allowed: boolean;
    primary: string;
  }>;
  location_intelligence?: NdLocationIntelRow | null;
  builder: {
    name: string;
    bot_name: string;
    bot_persona: string;
    bot_signature: string;
    preferred_tone: string;
    site_visit_hours?: string;
    escalation_phone?: string;
  } | null;
  returning_buyer?: {
    buyer_name: string;
    days_since_last_seen: number;
    last_project_id?: string;
  } | null;
  recent_messages?: Array<{ direction: 'inbound' | 'outbound'; content: string; created_at: number }>;
  objection_playbooks?: Array<{
    objection_topic: string;
    reframe_angles: string;
    trigger_phrases: string;
    escalate_after?: number;
  }>;
}

export interface NdSearchMatch {
  project_id: string;
  name: string;
  micro_market: string;
  project_type?: string;
  starting_price_inr: number;
  starting_price_display: string;
  match_score?: number;
  match_reasons?: string[];
  lat?: number | null;
  lng?: number | null;
  /** Trade-off Advisor (Desk Phase 1): grounded trade-off narration, present
   *  only when the search resolved preference weights for this conversation. */
  tradeoff_note?: string;
  preference_boost?: number;
  /** Four-questions receipts: typed per-dimension backing + structured absence
   *  (Desk advisor_rerank DimensionFit / AdvisorResult.gap). */
  dimension_fit?: Array<{ dimension: string; score: number; weight: number; evidence: string; good: boolean }>;
  dimension_gap?: { dimension: string; weight: number; label: string };
}

/**
 * Approved corridor value intel (Desk micro_market_intel, Market Intel Layer).
 * Every number arrives with provenance (source + as_of + confidence); nulls
 * are honest gaps (e.g. appreciation until baseline gazettes are parsed).
 */
export interface NdMarketIntel {
  micro_market_id: string;
  city: string;
  display_name: string;
  appreciation: {
    three_yr_pct: number | null;
    five_yr_pct: number | null;
    corridor_maturity: string | null;
  };
  rent_bands: Array<{ unit_type?: string; rent_min_inr?: number; rent_max_inr?: number }>;
  drivers: Array<{ event: string; date?: string; note?: string }>;
  provenance: { source: string; as_of: string; confidence: number };
}

export interface NdPricingQuote {
  project_id: string;
  components_quoted: Array<{
    label: string;
    // Desk's structured unit for `value`: 'per_sqft' | 'percent' | 'flat' | 'info'.
    // Authoritative — the bot must format by this, never guess the unit from the label.
    kind?: string;
    value: string;
    notes_buyer_facing: string;
  }>;
}

export interface NdMessage {
  direction: 'inbound' | 'outbound';
  content: string;
  created_at: number;
}

/** Node-only config when not running inside a Worker. */
export interface NayadeskTransportConfig {
  nayadeskUrl: string;
  botSecret: string;
}

type Transport = Env | NayadeskTransportConfig;

function isEnv(t: Transport): t is Env {
  return 'NAYADESK' in t || 'NAYADESK_URL' in t;
}

/** Typed gateway to NayaDesk — same seam as Naya's nayadesk_client.ts. */
export class NayaDeskClient {
  constructor(private readonly transport: Transport) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    const secret = isEnv(this.transport)
      ? this.transport.BOT_SHARED_SECRET
      : this.transport.botSecret;
    if (secret) h['x-bot-secret'] = secret;
    return h;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: this.headers() };
    if (body !== undefined) init.body = JSON.stringify(body);

    if (isEnv(this.transport) && this.transport.NAYADESK) {
      try {
        const resp = await this.transport.NAYADESK.fetch(`https://nayadesk.internal${path}`, init);
        if (resp.status === 503 && this.transport.NAYADESK_URL) {
          return this.callHttp<T>(this.transport.NAYADESK_URL, path, init);
        }
        return this.readResponse<T>(resp, path);
      } catch (err) {
        if (isEnv(this.transport) && this.transport.NAYADESK_URL) {
          return this.callHttp<T>(this.transport.NAYADESK_URL, path, init);
        }
        throw err;
      }
    }

    const base = isEnv(this.transport)
      ? this.transport.NAYADESK_URL
      : this.transport.nayadeskUrl;
    if (!base) throw new Error('NAYADESK_URL not configured');
    return this.callHttp<T>(base, path, init);
  }

  private async callHttp<T>(base: string, path: string, init: RequestInit): Promise<T> {
    const url = `${base.replace(/\/+$/, '')}${path}`;
    const resp = await fetch(url, init);
    return this.readResponse<T>(resp, path);
  }

  private async readResponse<T>(resp: Response, path: string): Promise<T> {
    const text = await resp.text();
    if (!resp.ok) throw new NayaDeskError(text.slice(0, 300), resp.status, path);
    return JSON.parse(text) as T;
  }

  health(): Promise<{ status?: string; service?: string }> {
    return this.call('GET', '/api/health');
  }

  /** SIL mask vocab, sourced live from the catalog (Understanding Flywheel §7.4). */
  getMaskVocab(): Promise<{
    places: string[]; builders: string[]; projects: string[]; version: string;
  }> {
    return this.call('GET', '/api/engine/mask-vocab');
  }

  /** Wave B safe promotion lane — human-taught phrasings from the understanding
   *  board, in registry-row shape, so the weekly rebuild ingests them exactly
   *  like git-registry rows (canonical embed, manifest-tracked). */
  getPromotedPhrasings(): Promise<{
    rows: Array<{
      id: string; phrasing: string; intent_kind: string; language: string;
      source: string; audit_status: string; eval_split: string; promoted_at: number;
    }>;
    count: number;
  }> {
    return this.call('GET', '/api/engine/promoted-phrasings');
  }

  /** Wave C auto-teach step 1 — teacher-confident pending clusters. */
  getAutoCandidates(opts: { minConf: number; maxClusters: number }): Promise<{
    clusters: Array<{
      cluster_key: string; teacher_intent: string; teacher_confidence: number;
      members: Array<{ queue_id: string; buyer_text: string }>;
    }>;
    count: number;
  }> {
    return this.call(
      'GET',
      `/api/engine/auto-candidates?min_conf=${opts.minConf}&max_clusters=${opts.maxClusters}`,
    );
  }

  /** Wave C auto-teach step 3 — the gate's promote/flag decision per cluster. */
  postAutoTeachDecisions(body: {
    promote: Array<{ cluster_key: string; reviewed_intent: string; note: string }>;
    flag: Array<{ cluster_key: string; note: string }>;
  }): Promise<{ ok: boolean; promoted: number; failed: number; flagged: number }> {
    return this.call('POST', '/api/intent-review-queue/internal/auto-promote', body);
  }

  upsertLead(req: {
    builder_id: string;
    buyer_phone: string;
    buyer_name?: string;
    project_id?: string;
    bhk_preference?: string;
    budget_inr?: string;
    visit_date_pref?: string;
    purpose?: string;
    /** W6 — ingress door label; Desk stores it on conversations.channel. */
    channel?: string;
    pending_action?: string;
    pending_action_payload?: unknown;
  }): Promise<{ ok: true; conversation_id: string; created: boolean }> {
    return this.call('PUT', '/api/leads', req);
  }

  getLead(conversation_id: string): Promise<{ lead: NdConversation }> {
    return this.call('GET', `/api/leads/${encodeURIComponent(conversation_id)}`);
  }

  patchFacts(
    conversation_id: string,
    facts: {
      buyer_name?: string;
      bhk_preference?: string;
      budget_inr?: string;
      visit_date_pref?: string;
      project_id?: string;
      purpose?: string;
    },
  ): Promise<{ ok: true }> {
    return this.call('PATCH', `/api/leads/${encodeURIComponent(conversation_id)}/facts`, facts);
  }

  patchStage(conversation_id: string, stage: string, only_forward?: boolean): Promise<{ ok: true }> {
    return this.call('PATCH', `/api/leads/${encodeURIComponent(conversation_id)}/stage`, {
      stage,
      ...(only_forward ? { only_forward: true } : {}),
    });
  }

  commitProject(conversation_id: string, project_id: string): Promise<{ ok: true }> {
    return this.call(
      'POST',
      `/api/conversations/${encodeURIComponent(conversation_id)}/commit-project`,
      { project_id },
    );
  }

  /**
   * Place a launch-ops unit hold (Phase 4). Pass unit_type ("2 BHK") and Desk
   * auto-picks the cheapest available unit of that type atomically — or a
   * specific unit_id. Throws NayaDeskError 409 when the type has no available
   * units (or the unit is already held) and 404 for an unknown type.
   */
  placeHold(req: {
    project_id: string;
    unit_id?: string;
    unit_type?: string;
    conversation_id?: string;
    buyer_name?: string;
    ttl_minutes?: number;
    note?: string;
    /** W7 — type sold out of available units: join the waitlist instead (202 waiting). */
    queue?: boolean;
  }): Promise<{
    ok: true;
    /** 201 active hold */
    hold_id?: string;
    unit_id: string;
    unit_number?: string;
    expires_at?: number;
    status: 'active' | 'waiting';
    /** 202 waitlist */
    waitlist_id?: string;
    position?: number;
  }> {
    const { project_id, ...body } = req;
    return this.call('POST', `/api/projects/${encodeURIComponent(project_id)}/holds`, body);
  }

  conversationContext(conversation_id: string, recent_message_limit?: number): Promise<NdContextBundle> {
    return this.call('POST', '/api/conversation-context', {
      conversation_id,
      ...(recent_message_limit !== undefined ? { recent_message_limit } : {}),
    });
  }

  /**
   * Market Intel Layer — corridor value intel by free-text micro-market.
   * Desk returns APPROVED rows only (drafts never cross this wire); null
   * intel = no verified data for that corridor, an honest absence.
   */
  marketIntel(q: string): Promise<{ intel: NdMarketIntel | null }> {
    return this.call('GET', `/api/market-intel?q=${encodeURIComponent(q)}`);
  }

  searchProjects(req: {
    builder_id: string;
    search_text?: string;
    budget_min_inr?: number;
    budget_max_inr?: number;
    locations?: string[];
    bhks?: string[];
    project_types?: string[];
    purpose?: 'self_use' | 'investment';
    max_results?: number;
    /** Trade-off Advisor: Desk resolves BPE weights for this conversation and
     *  re-ranks + narrates. Recommend path only; other callers omit it. */
    conversation_id?: string;
    /** Explicit weights win over conversation_id resolution (Desk contract). */
    preference_weights?: Record<string, number>;
    commute_hub?: string;
    budget_target_inr?: number;
    ask_size_sqft?: number;
  }): Promise<{ matches: NdSearchMatch[]; expanded_locations?: string[]; recognized_locations?: string[] | null; no_match_reasoning?: string }> {
    return this.call('POST', '/api/projects/search', req);
  }

  getProject(project_id: string): Promise<{
    project_id: string;
    name: string;
    micro_market: string;
    project_type?: string;
    summary?: string;
    possession_date?: string;
    rera_number?: string;
    entry_price_band?: string;
    khata_type?: string;
    na_status?: string;
    ec_status?: string;
    loan_eligibility?: string;
    builder_id: string;
    /** S1 — Desk serves the LI row alongside the project (sibling key, merged here). */
    location_intelligence?: NdLocationIntelRow | null;
  }> {
    return this.call('GET', `/api/projects/${encodeURIComponent(project_id)}`).then(
      (raw) => {
        const wrapped = raw as {
          project?: typeof raw;
          location_intelligence?: NdLocationIntelRow | null;
        };
        const project = (wrapped.project ?? raw) as {
          project_id: string;
          name: string;
          micro_market: string;
          rera_number?: string;
          entry_price_band?: string;
          builder_id: string;
          location_intelligence?: NdLocationIntelRow | null;
        };
        // Sibling key on the response envelope (kept out of the projects row);
        // merge so the adapter reads one shape from either endpoint.
        if (wrapped.project && wrapped.location_intelligence !== undefined) {
          return { ...project, location_intelligence: wrapped.location_intelligence };
        }
        return project;
      },
    );
  }

  pricingQuote(req: {
    project_id: string;
    conversation_id: string;
    unit_type?: string;
  }): Promise<NdPricingQuote & { components_withheld?: Array<{ label: string; redirect_hint?: string }> }> {
    return this.call('POST', '/api/pricing/quote', req);
  }

  landedCost(req: {
    project_id: string;
    conversation_id: string;
    unit_type: string;
  }): Promise<{
    base_price_low_inr?: number;
    base_price_display?: string;
    one_time_charges?: Array<{ label: string; amount_display?: string }>;
    recurring_charges?: Array<{ label: string; amount_display?: string }>;
    total_display?: string;
    disclaimer?: string;
  }> {
    return this.call('POST', '/api/pricing/landed-cost', req);
  }

  compareProjects(req: {
    conversation_id: string;
    project_ids: string[];
  }): Promise<{
    projects: Array<Record<string, unknown>>;
    table_text?: string;
    matrix?: { projects: Array<{ project_id: string; name: string }>; rows: Array<{ key?: string; label: string; values: string[] }> };
  }> {
    return this.call('POST', '/api/projects/compare', req);
  }

  mediaShare(req: {
    project_id: string;
    conversation_id: string;
    asset_kind: string;
    unit_type_filter?: string;
  }): Promise<{
    allowed: boolean;
    asset?: { title: string; cdn_url: string; asset_kind: string };
    reason?: string;
    redirect_hint?: string;
  }> {
    return this.call('POST', '/api/media/share', req);
  }

  listProjectUnits(project_id: string): Promise<{
    units: Array<{
      unit_type: string;
      price_display: string;
      size_min_sqft: number;
      size_max_sqft: number;
      is_available: number;
      disclosure_tier: string;
      price_min_paise?: number;
      price_max_paise?: number;
    }>;
  }> {
    return this.call('GET', `/api/projects/${encodeURIComponent(project_id)}/units`);
  }

  /**
   * Aggregated unit overview (NayaDesk #178). Prefer over raw `/units` when
   * available — groups by type with size/price ranges. Falls back callers
   * should catch 404 until nayadesk-dev has the route deployed.
   */
  unitsEnrichmentSummary(project_id: string): Promise<{
    project_id: string;
    total_configurations: number;
    unit_types: Array<{
      type: string;
      count: number;
      price_range: { min: number; max: number; display: string };
      size_range: { min: number | null; max: number | null; unit: string };
      available: number;
      disclosure_tier: string;
      media_ids: string[];
    }>;
  }> {
    return this.call(
      'GET',
      `/api/projects/${encodeURIComponent(project_id)}/units-enrichment/summary`,
    );
  }

  applyStateWrites(
    conversation_id: string,
    writes: ReadonlyArray<Record<string, unknown>>,
  ): Promise<{ ok: true; applied: number }> {
    return this.call('POST', `/api/leads/${encodeURIComponent(conversation_id)}/state-writes`, { writes });
  }

  appendMessage(
    conversation_id: string,
    msg: { direction: 'inbound' | 'outbound'; content: string },
  ): Promise<{ ok: true; message_id: string }> {
    return this.call('POST', `/api/leads/${encodeURIComponent(conversation_id)}/messages`, msg);
  }

  listMessages(conversation_id: string): Promise<{ messages: NdMessage[] }> {
    return this.call('GET', `/api/leads/${encodeURIComponent(conversation_id)}/messages?limit=50`);
  }

  turnLedgerContext(conversation_id: string): Promise<{
    prior: {
      turn_index: number;
      composer: string;
      reply_text: string;
      offered_project_ids?: string[];
      disclosed_facts?: Array<Record<string, unknown>>;
      awaiting_response?: boolean;
      action_plan?: Record<string, unknown>;
      resolved_intent?: Record<string, unknown>;
      snapshot_in?: Record<string, unknown>;
    } | null;
    rejected_project_ids: string[];
    next_turn_index: number;
  }> {
    return this.call('GET', `/api/turn-ledger/context?conversation_id=${encodeURIComponent(conversation_id)}`);
  }

  appendTurnLedger(req: {
    conversation_id: string;
    turn_index: number;
    builder_id: string;
    buyer_phone: string;
    created_at: number;
    buyer_text: string;
    composer: string;
    reply_text: string;
    tool_runs: Array<{ name: string; args_summary: string; success: boolean; latency_ms: number }>;
    snapshot_in?: Record<string, unknown>;
    resolved_intent?: Record<string, unknown>;
    action_plan?: Record<string, unknown>;
    offered_project_ids?: string[];
    disclosed_facts?: unknown[];
    verify?: Record<string, unknown>;
  }): Promise<{ ok: boolean }> {
    return this.call('POST', '/api/turn-ledger/append', req);
  }

  listBuilders(): Promise<{ builders: Array<{ builder_id: string; meta_phone_number_id: string; name: string }> }> {
    return this.call('GET', '/api/builders');
  }

  getBuilder(builder_id: string): Promise<{
    builder?: { builder_id: string; name?: string; site_visit_hours?: string; escalation_phone?: string };
  }> {
    return this.call('GET', `/api/builders/${encodeURIComponent(builder_id)}`);
  }

  siteVisitsItinerary(conversation_id: string): Promise<{
    plans: Array<{ collected?: Record<string, unknown>; status?: string }>;
  }> {
    return this.call(
      'GET',
      `/api/plans/site-visits-itinerary?conversation_id=${encodeURIComponent(conversation_id)}`,
    );
  }

  createPlan(req: {
    conversation_id: string;
    buyer_phone: string;
    builder_id: string;
    goal: string;
    steps: Array<{ id: string; kind: string; status?: string }>;
    current_step: string;
    collected: Record<string, unknown>;
  }): Promise<{ ok: boolean; plan_id: string }> {
    return this.call('POST', '/api/plans', req);
  }

  patchPlan(plan_id: string, body: { status?: string; collected?: Record<string, unknown> }): Promise<{ ok: boolean }> {
    return this.call('PATCH', `/api/plans/${encodeURIComponent(plan_id)}`, body);
  }

  getWhatsAppCreds(builder_id: string): Promise<{
    connected: boolean;
    phone_number_id: string;
    access_token: string;
  }> {
    return this.call('GET', `/api/whatsapp/${encodeURIComponent(builder_id)}/creds`);
  }

  postProfileObservations(req: {
    builder_id: string;
    buyer_phone: string;
    conversation_id: string;
    observations: Array<{ fact_key: string; value: unknown; provenance: string; confidence?: number }>;
  }): Promise<{ ok: boolean }> {
    return this.call('POST', '/api/profile/observations', req);
  }

  postJourneySignals(req: {
    builder_id: string;
    buyer_phone: string;
    conversation_id: string;
    signals: Record<string, unknown>;
    context?: { conversation_status?: string; project_state?: string };
    shortlist_add?: string[];
    rejected_add?: string[];
  }): Promise<{ ok: boolean }> {
    return this.call('POST', '/api/journey/signals', req);
  }

  postJourneyTurnSnapshot(req: {
    builder_id: string;
    buyer_phone: string;
    conversation_id: string;
    turn_goal: string;
    strategist_reason: string;
    matched_rules: string[];
    snapshot?: Record<string, unknown>;
  }): Promise<{ ok: boolean; snapshot_id: string }> {
    return this.call('POST', '/api/journey/turn-snapshot', req);
  }

  getJourney(builder_id: string, buyer_phone: string): Promise<{
    journey: {
      stage: string;
      shortlist: string[];
      rejected: string[];
      visit_history: Array<Record<string, unknown>>;
    } | null;
  }> {
    return this.call(
      'GET',
      `/api/journey?builder_id=${encodeURIComponent(builder_id)}&buyer_phone=${encodeURIComponent(buyer_phone)}`,
    );
  }

  getProfile(builder_id: string, buyer_phone: string): Promise<{
    facts: Record<string, unknown>;
    preferences: Array<{ key: string; value: string; confidence: number }>;
  }> {
    return this.call(
      'GET',
      `/api/profile?builder_id=${encodeURIComponent(builder_id)}&buyer_phone=${encodeURIComponent(buyer_phone)}`,
    );
  }

  postChoiceEvent(req: {
    builder_id: string;
    buyer_phone: string;
    conversation_id: string;
    engine_status: string;
    eligible: Array<Record<string, unknown>>;
    stretch: Array<Record<string, unknown>>;
    constraints: Record<string, unknown>;
  }): Promise<{ ok: boolean; event_id: string }> {
    return this.call('POST', '/api/profile/choice-events', req);
  }

  postChoiceResponse(req: {
    conversation_id: string;
    response_text: string;
    response_intent?: string;
  }): Promise<{ ok: boolean; attached: boolean }> {
    return this.call('POST', '/api/profile/choice-response', req);
  }

  getLatestChoiceEvent(conversation_id: string): Promise<{
    event: {
      event_id: string;
      eligible: Array<{ project_id?: string; name?: string }>;
      response_text: string | null;
    } | null;
  }> {
    return this.call(
      'GET',
      `/api/profile/choice-events/latest?conversation_id=${encodeURIComponent(conversation_id)}`,
    );
  }

  releaseProject(conversation_id: string): Promise<{ ok: true; project_state: string }> {
    return this.call(
      'POST',
      `/api/conversations/${encodeURIComponent(conversation_id)}/release-project`,
      {},
    );
  }

  deleteBuyerMemory(conversation_id: string): Promise<{ ok: true; deleted: number }> {
    return this.call('DELETE', `/api/leads/${encodeURIComponent(conversation_id)}/buyer-memory`);
  }

  mirrorMemory(conversation_id: string): Promise<{ ok: true }> {
    return this.call('POST', `/api/leads/${encodeURIComponent(conversation_id)}/mirror-memory`, {});
  }

  getLeadByPhone(phone: string, builder_id: string): Promise<{ lead: NdConversation }> {
    return this.call(
      'GET',
      `/api/leads/by-phone/${encodeURIComponent(phone)}?builder_id=${encodeURIComponent(builder_id)}`,
    );
  }

  getActivePlan(conversation_id: string): Promise<{ plan: Record<string, unknown> | null }> {
    return this.call('GET', `/api/plans/active?conversation_id=${encodeURIComponent(conversation_id)}`);
  }

  getActivePlans(conversation_id: string): Promise<{ plans: Array<Record<string, unknown>> }> {
    return this.call('GET', `/api/plans/active-all?conversation_id=${encodeURIComponent(conversation_id)}`);
  }

  getLatestCompletedPlan(conversation_id: string, goal = 'site_visits'): Promise<{ plan: Record<string, unknown> | null }> {
    return this.call(
      'GET',
      `/api/plans/latest-completed?conversation_id=${encodeURIComponent(conversation_id)}&goal=${encodeURIComponent(goal)}`,
    );
  }

  projectEtag(project_id: string): Promise<{ etag: string; latest_updated_at: number }> {
    return this.call('GET', `/api/projects/${encodeURIComponent(project_id)}/etag`);
  }

  engineConfig(builder_id: string): Promise<{ builder_id: string; config: Record<string, unknown> }> {
    return this.call('GET', `/api/engine/config?builder_id=${encodeURIComponent(builder_id)}`);
  }

  resolveGeo(text: string): Promise<{
    resolved: boolean;
    lat?: number;
    lng?: number;
    radius_km?: number;
  }> {
    return this.call('POST', '/api/engine/geo/resolve', { text });
  }

  areasInRegion(region: string, builder_id?: string): Promise<{
    region: string;
    areas: Array<{ area_id: string; name: string; distance_km: number }>;
    nearby?: Array<{ area_id: string; name: string; distance_km: number }>;
  }> {
    return this.call('POST', '/api/engine/geo/areas-in-region', builder_id ? { region, builder_id } : { region });
  }

  areasNear(area_id: string, max_km = 5): Promise<{ areas: Array<{ area_id: string; name: string; distance_km: number }> }> {
    return this.call('POST', '/api/engine/geo/areas-near', { area_id, max_km });
  }

  areasSemantic(query: string, k = 5): Promise<{ areas: Array<{ area_id: string; name: string; score: number }> }> {
    return this.call('POST', '/api/engine/geo/areas-semantic', { query, k });
  }

  faqLookup(project_id: string, question_key: string): Promise<{
    faq: { question_key: string; canonical_question: string; approved_answer: string } | null;
  }> {
    return this.call(
      'GET',
      `/api/faqs/lookup?project_id=${encodeURIComponent(project_id)}&question_key=${encodeURIComponent(question_key)}`,
    );
  }

  ingestExternalLink(builder_id: string, url: string): Promise<Record<string, unknown>> {
    return this.call('POST', '/api/external/ingest', { builder_id, url });
  }

  ragCorpus(builder_id: string): Promise<{ builder_id: string; projects: Array<Record<string, unknown>> }> {
    return this.call('GET', `/api/rag-corpus?builder_id=${encodeURIComponent(builder_id)}`);
  }

  enqueueIntentReview(payload: Record<string, unknown>): Promise<{ ok: boolean; queue_id: string }> {
    return this.call('POST', '/api/intent-review-queue/internal/enqueue', payload);
  }
}
