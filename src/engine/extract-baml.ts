/**
 * P6/P1 — ExtractTurnFacts (BAML contract → DeepSeek JSON).
 * Free-text search briefs: multi-slot LLM authority for location/type/purpose (+ soft prefs).
 * Budget/BHK: LLM fills when regex left empty; regex wins when present (closed formats).
 * Chips / speech-act never owned here.
 * See baml/extract_turn_facts.baml and docs/lld/P6_BAML_EXTRACT.md
 */
import { locationLooksPolluted, parseBudgetToInr } from './facts.js';
import type { Env } from '../env.js';
import { mayWriteSearchConstraints } from './speech-act/permissions.js';
import type { ChipResolution, SpeechActKind } from './speech-act/types.js';
import type { AnswerTopic, Extracted } from './types.js';

export type BamlExtractMode = 'off' | 'shadow' | 'promote';

export interface BamlExtractInput {
  text: string;
  phase: string;
  speechAct: SpeechActKind;
  askTopics: readonly AnswerTopic[];
  constraints: Extracted['constraints'];
  hasNamedProject: boolean;
  focusProjectName?: string;
}

export interface BamlExtractResult {
  askTopics?: AnswerTopic[];
  location?: string;
  propertyType?: string;
  purpose?: 'self_use' | 'investment';
  transition?: 'want_details' | 'see_others' | 'want_visit';
  bhk?: string;
  budgetMaxInr?: number;
  nearAirport?: boolean;
  readyToMove?: boolean;
  confidence: 'llm' | 'abstain';
  abstainReason?: string;
}

export interface BamlShadowReport {
  mode: BamlExtractMode;
  called: boolean;
  would_fill: string[];
  disagree: string[];
  confidence?: 'llm' | 'abstain';
  abstain_reason?: string;
}

const VALID_TOPICS = new Set<AnswerTopic>([
  'price',
  'legal',
  'emi',
  'amenities',
  'availability',
  'location',
  'media',
  'overview',
  'property_type',
  'compare',
]);

const SKIP_ACTS = new Set<SpeechActKind>(['greet', 'stop', 'handoff']);

const SYSTEM = `You extract search constraints and topics from a real-estate buyer WhatsApp message.
Return STRICT JSON only — no markdown.
Pack EVERY clearly stated requirement into one object (multi-slot), e.g. 3BHK + North Bangalore + 1.2 Cr + near airport.
Schema: {"ask_topics": string[]|null, "location": string|null, "property_type": string|null, "purpose": "self_use"|"investment"|null, "transition": "want_details"|"see_others"|"want_visit"|null, "bhk": string|null, "budget_max_inr": number|null, "near_airport": boolean|null, "ready_to_move": boolean|null, "confidence": "llm"|"abstain", "abstain_reason": string|null}

Rules:
- location = locality/corridor ONLY (e.g. "North Bangalore", "Whitefield"). NEVER append budget words (under/crore/lakh).
- budget_max_inr = integer INR when clear (1.2 Cr → 12000000, 50L → 5000000).
- bhk like "2 BHK" / "3 BHK" when clear.
- property_type: plantation|villa|apartment|plot when clear.
- ask_topics from: price, legal, emi, amenities, availability, location, media, overview, property_type, compare
- Do NOT invent projects or localities not in the message.
- If unsure about a field, leave it null. If unsure overall, confidence=abstain.
- Never classify speech act.`;

/** Resolve mode from env — shadow when key present unless explicitly set. */
export function resolveBamlExtractMode(env: Pick<Env, 'BAML_EXTRACT_MODE' | 'DEEPSEEK_API_KEY'>): BamlExtractMode {
  const raw = (env.BAML_EXTRACT_MODE ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'shadow' || raw === 'promote') return raw;
  return env.DEEPSEEK_API_KEY ? 'shadow' : 'off';
}

/** Free-text search brief — multi-slot extract should run. */
export function looksLikeSearchBrief(text: string): boolean {
  return (
    /\b(?:in|near|around|at)\s+[A-Za-z]/i.test(text) ||
    /\b(?:plantation|villa|apartment|plot|flat|bhk|budget|crore|lakh)\b/i.test(text)
  );
}

/** Call ExtractTurnFacts on free-text search briefs or classic gaps. */
export function needsBamlGapFill(
  ex: Extracted,
  text: string,
  resolution: ChipResolution,
): boolean {
  if (resolution.primary) return false;
  const act = ex.speechAct ?? resolution.speechAct;
  if (act && SKIP_ACTS.has(act)) return false;

  // P1: always run multi-slot extract on search briefs (LLM packs requirements).
  if (looksLikeSearchBrief(text) && mayWriteSearchConstraints(act ?? 'unknown')) return true;

  const topics = ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : []);
  const missingTopic = topics.length === 0 && (act === 'unknown' || !act);
  const pollutedLoc = locationLooksPolluted(ex.constraints.location);
  const missingLoc =
    (!ex.constraints.location || pollutedLoc) &&
    mayWriteSearchConstraints(act ?? 'unknown') &&
    looksLikeSearchBrief(text);
  const missingTransition =
    (!ex.transition || ex.transition === 'none') &&
    /\b(?:visit|site visit|tell me more|more about|show me others?|other options?)\b/i.test(text);

  return missingTopic || missingLoc || missingTransition || pollutedLoc;
}

function normalizeBhk(raw: string): string | undefined {
  const m = raw.trim().match(/(\d(?:\.\d)?)\s*bhk/i);
  if (!m?.[1]) return undefined;
  return `${m[1]} BHK`;
}

function parseBudgetField(o: Record<string, unknown>, fullText: string): number | undefined {
  if (typeof o.budget_max_inr === 'number' && o.budget_max_inr > 100_000) {
    return Math.round(o.budget_max_inr);
  }
  if (typeof o.budget_max_inr === 'string') {
    const fromStr = parseBudgetToInr(o.budget_max_inr);
    if (fromStr?.max) return fromStr.max;
  }
  return parseBudgetToInr(fullText)?.max;
}

export function parseBamlExtractResult(raw: string, sourceText = ''): BamlExtractResult | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const confidence = o.confidence === 'abstain' || o.confidence === 'llm' ? o.confidence : 'abstain';
    if (confidence === 'abstain') {
      return {
        confidence: 'abstain',
        ...(typeof o.abstain_reason === 'string' ? { abstainReason: o.abstain_reason.slice(0, 160) } : {}),
      };
    }

    const askTopics = Array.isArray(o.ask_topics)
      ? (o.ask_topics.filter(
          (t): t is AnswerTopic => typeof t === 'string' && VALID_TOPICS.has(t as AnswerTopic),
        ) as AnswerTopic[])
      : undefined;

    const propertyType =
      typeof o.property_type === 'string' &&
      /^(?:plantation|villa|apartment|plot)$/i.test(o.property_type.trim())
        ? o.property_type.trim().toLowerCase()
        : undefined;

    const purpose =
      o.purpose === 'self_use' || o.purpose === 'investment' ? o.purpose : undefined;

    const transition =
      o.transition === 'want_details' ||
      o.transition === 'see_others' ||
      o.transition === 'want_visit'
        ? o.transition
        : undefined;

    let location =
      typeof o.location === 'string' && o.location.trim().length >= 2
        ? o.location.trim().slice(0, 48)
        : undefined;
    if (locationLooksPolluted(location)) location = undefined;

    const bhk = typeof o.bhk === 'string' ? normalizeBhk(o.bhk) : undefined;
    const budgetMaxInr = parseBudgetField(o, sourceText);
    const nearAirport = typeof o.near_airport === 'boolean' ? o.near_airport : undefined;
    const readyToMove = typeof o.ready_to_move === 'boolean' ? o.ready_to_move : undefined;

    const hasAny = Boolean(
      (askTopics && askTopics.length) ||
        location ||
        propertyType ||
        purpose ||
        transition ||
        bhk ||
        budgetMaxInr ||
        nearAirport === true ||
        readyToMove === true,
    );
    if (!hasAny) {
      return { confidence: 'abstain', abstainReason: 'empty_llm_payload' };
    }

    return {
      confidence: 'llm',
      ...(askTopics?.length ? { askTopics } : {}),
      ...(location ? { location } : {}),
      ...(propertyType ? { propertyType } : {}),
      ...(purpose ? { purpose } : {}),
      ...(transition ? { transition } : {}),
      ...(bhk ? { bhk } : {}),
      ...(budgetMaxInr ? { budgetMaxInr } : {}),
      ...(nearAirport !== undefined ? { nearAirport } : {}),
      ...(readyToMove !== undefined ? { readyToMove } : {}),
    };
  } catch {
    return null;
  }
}

/** Compare BAML proposal to current extract — for shadow telemetry. */
export function buildBamlShadowReport(
  mode: BamlExtractMode,
  current: Extracted,
  proposal: BamlExtractResult | null,
): BamlShadowReport {
  if (!proposal || proposal.confidence !== 'llm') {
    return {
      mode,
      called: true,
      would_fill: [],
      disagree: [],
      confidence: proposal?.confidence ?? 'abstain',
      ...(proposal?.abstainReason ? { abstain_reason: proposal.abstainReason } : {}),
    };
  }

  const would_fill: string[] = [];
  const disagree: string[] = [];
  const curTopics = current.askTopics ?? (current.askTopic ? [current.askTopic] : []);

  if (proposal.askTopics?.length) {
    if (curTopics.length === 0) would_fill.push('askTopics');
    else if (proposal.askTopics[0] !== curTopics[0]) disagree.push('askTopics');
  }
  if (proposal.location) {
    if (!current.constraints.location || locationLooksPolluted(current.constraints.location)) {
      would_fill.push('location');
    } else if (current.constraints.location.toLowerCase() !== proposal.location.toLowerCase()) {
      disagree.push('location');
    }
  }
  if (proposal.propertyType) {
    if (!current.constraints.propertyType) would_fill.push('propertyType');
    else if (current.constraints.propertyType !== proposal.propertyType) disagree.push('propertyType');
  }
  if (proposal.purpose) {
    if (!current.constraints.purpose) would_fill.push('purpose');
    else if (current.constraints.purpose !== proposal.purpose) disagree.push('purpose');
  }
  if (proposal.transition) {
    if (!current.transition || current.transition === 'none') would_fill.push('transition');
    else if (current.transition !== proposal.transition) disagree.push('transition');
  }
  if (proposal.bhk) {
    if (!current.constraints.bhk) would_fill.push('bhk');
    else if (current.constraints.bhk !== proposal.bhk) disagree.push('bhk');
  }
  if (proposal.budgetMaxInr) {
    if (!current.constraints.budgetMaxInr) would_fill.push('budget');
    else if (current.constraints.budgetMaxInr !== proposal.budgetMaxInr) disagree.push('budget');
  }
  if (proposal.nearAirport === true && !current.constraints.nearAirport) would_fill.push('nearAirport');
  if (proposal.readyToMove === true && !current.constraints.readyToMove) would_fill.push('readyToMove');

  return { mode, called: true, would_fill, disagree, confidence: 'llm' };
}

export interface MergeBamlOptions {
  /** Free-text search brief — LLM owns location/type/purpose. */
  searchBrief?: boolean;
}

/**
 * Merge ExtractTurnFacts into extract.
 * Search brief: LLM owns location/type/purpose; regex keeps BHK/budget when already set.
 * Non-brief: gap-fill + polluted location overwrite only.
 */
export function mergeBamlGapFill(
  current: Extracted,
  proposal: BamlExtractResult,
  opts?: MergeBamlOptions,
): Extracted {
  if (proposal.confidence !== 'llm') return current;
  let next = { ...current, constraints: { ...current.constraints } };
  const searchBrief = Boolean(opts?.searchBrief);

  const curTopics = next.askTopics ?? (next.askTopic ? [next.askTopic] : []);
  if (curTopics.length === 0 && proposal.askTopics?.length) {
    next = {
      ...next,
      askTopic: proposal.askTopics[0],
      askTopics: proposal.askTopics,
    };
  }

  const detailAsk =
    !searchBrief && ((next.askTopics?.length ?? 0) > 0 || Boolean(next.askTopic));

  if (proposal.location && !locationLooksPolluted(proposal.location) && !detailAsk) {
    const curLoc = next.constraints.location;
    if (searchBrief || !curLoc || locationLooksPolluted(curLoc)) {
      next.constraints = { ...next.constraints, location: proposal.location };
    }
  }

  if (proposal.propertyType) {
    if (searchBrief || !next.constraints.propertyType) {
      next.constraints = { ...next.constraints, propertyType: proposal.propertyType };
    }
  }
  if (proposal.purpose) {
    if (searchBrief || !next.constraints.purpose) {
      next.constraints = { ...next.constraints, purpose: proposal.purpose };
    }
  }

  // Closed formats: regex wins when present; LLM fills gaps.
  if (!next.constraints.bhk && proposal.bhk) {
    next.constraints = { ...next.constraints, bhk: proposal.bhk };
  }
  if (!next.constraints.budgetMaxInr && proposal.budgetMaxInr) {
    next.constraints = { ...next.constraints, budgetMaxInr: proposal.budgetMaxInr };
  }
  if (proposal.nearAirport !== undefined) {
    next.constraints = { ...next.constraints, nearAirport: proposal.nearAirport };
  }
  if (proposal.readyToMove !== undefined) {
    next.constraints = { ...next.constraints, readyToMove: proposal.readyToMove };
  }

  if ((!next.transition || next.transition === 'none') && proposal.transition) {
    next = { ...next, transition: proposal.transition };
  }
  return next;
}

export function buildBamlExtractInput(
  text: string,
  statePhase: string,
  ex: Extracted,
  focusProjectName?: string,
): BamlExtractInput {
  return {
    text,
    phase: statePhase,
    speechAct: ex.speechAct ?? 'unknown',
    askTopics: ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : []),
    constraints: ex.constraints,
    hasNamedProject: (ex.namedProjects?.length ?? 0) > 0 || Boolean(ex.pickName),
    ...(focusProjectName ? { focusProjectName } : {}),
  };
}

async function chatJson(
  base: string,
  model: string,
  apiKey: string | undefined,
  user: string,
): Promise<string> {
  if (!apiKey) return '';
  const resp = await fetch(`${base.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      max_tokens: 280,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) return '';
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/** Live ExtractTurnFacts call — returns null on network/parse failure. */
export async function extractTurnFactsBaml(
  env: Pick<
    Env,
    'DEEPSEEK_API_KEY' | 'DEEPSEEK_BASE_URL' | 'DEEPSEEK_MODEL' | 'OLLAMA_BASE_URL' | 'OLLAMA_MODEL'
  >,
  input: BamlExtractInput,
): Promise<BamlExtractResult | null> {
  const pack = {
    text: input.text,
    phase: input.phase,
    speech_act: input.speechAct,
    ask_topics: input.askTopics,
    constraints: input.constraints,
    has_named_project: input.hasNamedProject,
    focus_project_name: input.focusProjectName ?? null,
  };
  const user = JSON.stringify(pack);

  const ollamaBase = env.OLLAMA_BASE_URL?.trim();
  let raw = '';
  if (ollamaBase) {
    raw = await chatJson(
      ollamaBase,
      env.OLLAMA_MODEL ?? 'llama3.1:8b-instruct',
      undefined,
      user,
    );
  }
  if (!raw) {
    raw = await chatJson(
      env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      env.DEEPSEEK_API_KEY,
      user,
    );
  }
  if (!raw) return null;
  return parseBamlExtractResult(raw, input.text);
}
