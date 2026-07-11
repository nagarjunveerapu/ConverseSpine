/**
 * P6 — ExtractTurnFacts (BAML contract → DeepSeek JSON).
 * Gap-fill only after regex + embedder abstain. Never owns speech act.
 * See baml/extract_turn_facts.baml and docs/lld/P6_BAML_EXTRACT.md
 */
import { locationLooksPolluted } from './facts.js';
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

const SYSTEM = `You extract ONLY gap fields from a real-estate buyer WhatsApp message.
Return STRICT JSON only — no markdown.
Schema: {"ask_topics": string[]|null, "location": string|null, "property_type": string|null, "purpose": "self_use"|"investment"|null, "transition": "want_details"|"see_others"|"want_visit"|null, "confidence": "llm"|"abstain", "abstain_reason": string|null}

Rules:
- Do NOT invent projects, prices, or localities not clearly in the message.
- ask_topics must be from: price, legal, emi, amenities, availability, location, media, overview, property_type, compare
- property_type must be plantation|villa|apartment|plot when clear
- If unsure about a field, leave it null. If unsure overall, confidence=abstain.
- Never classify speech act. Never return fields already filled in the input pack.`;

/** Resolve mode from env — shadow when key present unless explicitly set. */
export function resolveBamlExtractMode(env: Pick<Env, 'BAML_EXTRACT_MODE' | 'DEEPSEEK_API_KEY'>): BamlExtractMode {
  const raw = (env.BAML_EXTRACT_MODE ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'shadow' || raw === 'promote') return raw;
  return env.DEEPSEEK_API_KEY ? 'shadow' : 'off';
}

/** After regex+embedder — should we call ExtractTurnFacts? */
export function needsBamlGapFill(
  ex: Extracted,
  text: string,
  resolution: ChipResolution,
): boolean {
  if (resolution.primary) return false;
  const act = ex.speechAct ?? resolution.speechAct;
  if (act && SKIP_ACTS.has(act)) return false;

  const topics = ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : []);
  const missingTopic = topics.length === 0 && (act === 'unknown' || !act);
  const pollutedLoc = locationLooksPolluted(ex.constraints.location);
  const missingLoc =
    ((!ex.constraints.location || pollutedLoc) &&
      mayWriteSearchConstraints(act ?? 'unknown') &&
      looksLikeSearchBrief(text));
  const missingTransition =
    (!ex.transition || ex.transition === 'none') &&
    /\b(?:visit|site visit|tell me more|more about|show me others?|other options?)\b/i.test(text);

  return missingTopic || missingLoc || missingTransition || pollutedLoc;
}

function looksLikeSearchBrief(text: string): boolean {
  return (
    /\b(?:in|near|around|at)\s+[A-Za-z]/i.test(text) ||
    /\b(?:plantation|villa|apartment|plot|flat|bhk|budget|crore|lakh)\b/i.test(text)
  );
}

export function parseBamlExtractResult(raw: string): BamlExtractResult | null {
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

    const location =
      typeof o.location === 'string' && o.location.trim().length >= 2
        ? o.location.trim().slice(0, 48)
        : undefined;

    const hasAny = Boolean(
      (askTopics && askTopics.length) || location || propertyType || purpose || transition,
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

  return { mode, called: true, would_fill, disagree, confidence: 'llm' };
}

/**
 * Free-text promote: BAML may fill gaps AND overwrite polluted / disagreed locality.
 * Never owns speech act. Chip path never calls this.
 * Budget/BHK stay regex (closed formats) — not in the BAML schema.
 */
export function mergeBamlGapFill(current: Extracted, proposal: BamlExtractResult): Extracted {
  if (proposal.confidence !== 'llm') return current;
  let next = { ...current, constraints: { ...current.constraints } };

  const curTopics = next.askTopics ?? (next.askTopic ? [next.askTopic] : []);
  if (curTopics.length === 0 && proposal.askTopics?.length) {
    next = {
      ...next,
      askTopic: proposal.askTopics[0],
      askTopics: proposal.askTopics,
    };
  }

  const detailAsk = (next.askTopics?.length ?? 0) > 0 || Boolean(next.askTopic);
  if (proposal.location && !locationLooksPolluted(proposal.location) && !detailAsk) {
    const curLoc = next.constraints.location;
    // Promote over empty OR polluted regex — clean regex locality still wins.
    if (!curLoc || locationLooksPolluted(curLoc)) {
      next.constraints = { ...next.constraints, location: proposal.location };
    }
  }
  if (!next.constraints.propertyType && proposal.propertyType) {
    next.constraints = { ...next.constraints, propertyType: proposal.propertyType };
  }
  if (!next.constraints.purpose && proposal.purpose) {
    next.constraints = { ...next.constraints, purpose: proposal.purpose };
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
      max_tokens: 180,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) return '';
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/** Live ExtractTurnFacts call — returns null on network/parse failure. */
export async function extractTurnFactsBaml(
  env: Pick<Env, 'DEEPSEEK_API_KEY' | 'DEEPSEEK_BASE_URL' | 'DEEPSEEK_MODEL' | 'OLLAMA_BASE_URL' | 'OLLAMA_MODEL'>,
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
  return parseBamlExtractResult(raw);
}
