import type { Env } from '../../env.js';
import type { AnswerTopic, ConversationState, Extracted, OfferedProject } from '../types.js';
import { detectTopics, isDetailAskTurn, isLocationCorrectionTurn, looksLikeConfigAsk } from '../facts.js';
import { buyerCuedOtherProject, facetNameResidue } from '../project_switch.js';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const TOPIC_THRESHOLD = 0.72;
const LOCATION_THRESHOLD = 0.78;
/** Low threshold — project names are short; intent vectors use 0.72. */
export const PROJECT_VECTOR_THRESHOLD = 0.65;

/**
 * INTENT_VECTORS → AnswerTopic gap-fill when chip-resolve left speechAct unknown
 * (or regex topics empty). Do NOT map find_projects / book_visit / recommend —
 * those are search/visit moves, not answer facets.
 */
const INTENT_TO_TOPIC: Record<string, AnswerTopic> = {
  get_price: 'price',
  get_legal_info: 'legal',
  get_availability: 'availability',
  get_unit_configs: 'availability',
  get_brochure: 'media',
  get_media: 'media',
  get_amenities: 'amenities',
  get_location_info: 'location',
  ask_delivery_timeline: 'availability',
  get_project_info: 'overview',
  ask_about_builder: 'overview',
  compute_emi: 'emi',
  get_payment_plan: 'price',
  negotiate_price: 'price',
  ask_investment_return: 'overview',
  compare_projects: 'compare',
};

export interface SemanticNluPort {
  enrich(text: string, builderId: string, ex: Extracted, ctx: SemanticContext): Promise<Extracted>;
}

export interface SemanticContext {
  phase: ConversationState['phase'];
  microMarkets: readonly string[];
  /** Shortlist names — enables PROJECT_VECTORS on chip-miss when buyer names a match. */
  offeredProjectNames?: readonly string[];
  /** L2 pending offer_pricing — block PROJECT_VECTORS on affirm/decline. */
  pendingOfferPricing?: boolean;
  /** Session already has search constraints (location/type/budget) — bare name after no_fit. */
  hasPriorConstraints?: boolean;
}

export interface ProjectVectorMatch {
  readonly projectId: string;
  readonly name: string;
  readonly score: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedTexts(ai: Env['AI'], texts: string[]): Promise<number[][]> {
  if (!ai || texts.length === 0) return [];
  const resp = (await ai.run(EMBED_MODEL, { text: texts })) as { data?: number[][] };
  return resp.data ?? [];
}

/** Collect distinct projects from Vectorize matches above threshold. */
export function collectNamedProjectsFromMatches(
  matches: ReadonlyArray<{ score?: number; metadata?: Record<string, unknown> }>,
  threshold = PROJECT_VECTOR_THRESHOLD,
): OfferedProject[] {
  const byId = new Map<string, { name: string; score: number }>();
  for (const m of matches) {
    const score = m.score ?? 0;
    if (score < threshold) continue;
    const meta = m.metadata ?? {};
    const projectId =
      typeof meta.project_id === 'string' ? meta.project_id : '';
    const name = typeof meta.name === 'string' ? meta.name : '';
    if (!projectId || !name) continue;
    const prev = byId.get(projectId);
    if (!prev || score > prev.score) {
      byId.set(projectId, { name, score });
    }
  }
  return [...byId.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([projectId, { name }]) => ({ projectId, name }));
}

async function queryProjectVectors(
  env: Env,
  text: string,
  builderId: string,
): Promise<ReadonlyArray<{ score?: number; metadata?: Record<string, unknown> }>> {
  const vectors = await embedTexts(env.AI!, [text]);
  const query = vectors[0];
  if (!query || !env.PROJECT_VECTORS) return [];
  const results = await env.PROJECT_VECTORS.query(query, {
    topK: 8,
    returnMetadata: 'all',
    filter: { builder_id: builderId },
  }).catch(() => null);
  return results?.matches ?? [];
}

/** Strip compare/visit lead-in so each clause embeds a project name, not the verb. */
function clauseForProjectEmbed(clause: string): string {
  return clause
    .replace(/^.*?\bcompare\b\s*/i, '')
    .replace(/^(?:visit|book)\s+/i, '')
    .trim();
}

/** Resolve project names from Vectorize — per-clause when compare/visit/multi-name lists. */
async function resolveNamedProjectsFromVectors(
  env: Env,
  text: string,
  builderId: string,
  ex: Extracted,
): Promise<OfferedProject[]> {
  const multiProject =
    ex.askTopic === 'compare' ||
    ex.transition === 'want_visit' ||
    /\bcompare\b/i.test(text) ||
    /\band\b/i.test(text);

  const clauses =
    multiProject && /\band\b/i.test(text)
      ? text
          .split(/\band\b/i)
          .map((p) => p.trim())
          .filter((p) => p.length >= 3)
      : [text];

  const allMatches: Array<{ score?: number; metadata?: Record<string, unknown> }> = [];
  for (const clause of clauses.slice(0, 3)) {
    const embedClause = clauseForProjectEmbed(clause);
    if (embedClause.length < 3) continue;
    allMatches.push(...(await queryProjectVectors(env, embedClause, builderId)));
  }

  const named = collectNamedProjectsFromMatches(allMatches);
  return multiProject ? named.slice(0, 3) : named.slice(0, 1);
}

/** Buyer text likely references a project by name (not pure location/budget seed). */
const PROJECT_REF_RE =
  /\b(?:about|compare|visit|brochure|switch\s+to|tell\s+me|show\s+me|interested\s+in|know\s+more|more\s+about|also\s+about|share|add|sounds\s+good|looks\s+good)\b/i;

/** Anaphoric visit/compare — resolve from discourse, not full-catalog embed noise. */
const ANAPHORA_ONLY_RE =
  /\b(?:both|these|those|them|the\s+two|dono|both\s+(?:the\s+)?projects?)\b/i;

export function isAnaphoricProjectRef(text: string): boolean {
  const t = text.trim();
  if (!ANAPHORA_ONLY_RE.test(t)) return false;
  // Has an explicit proper-name-ish token beyond anaphora → still vectorize.
  const stripped = t
    .replace(ANAPHORA_ONLY_RE, ' ')
    .replace(/\b(?:compare|visit|see|tour|about|the|projects?|ones?|options?|i|would|like|to|can|you|okay|ok|please|also|and|both)\b/gi, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .trim();
  return stripped.length < 3;
}

export function shouldQueryProjectVectors(
  text: string,
  ex: Extracted,
  ctx: SemanticContext,
): boolean {
  // Full pair already resolved — no vectors.
  if ((ex.namedProjects?.length ?? 0) >= 2 || text.trim().length < 3) return false;
  // Partial shortlist hit (1 name): only continue for multi-name compare/visit
  // ("compare ayana and krishnaja"). Bare "tell me about Brigade Eldorado" must
  // not re-embed — brand token "Brigade" otherwise invents sibling projects → false compare.
  if (
    (ex.namedProjects?.length ?? 0) === 1 &&
    !/\b(?:and|compare|vs\.?|versus|both|also)\b/i.test(text)
  ) {
    return false;
  }
  // Dialogue affirm (incl. Hinglish / multi-word) — never invent a project from catalog noise.
  if (ex.affirm && !PROJECT_REF_RE.test(text) && text.trim().split(/\s+/).length <= 4) {
    return false;
  }
  // Pending CTA affirm/decline even if extract.affirm missed (e.g. "haan" edge).
  if (
    ctx.pendingOfferPricing &&
    /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|haan?|haaji|theek(?:\s+hai)?|yeah\s+sure|yes\s+please|no|nope|no\s+thanks)(?:[.!?]|\s)*$/i.test(
      text.trim(),
    )
  ) {
    return false;
  }
  // "visit them" / "compare both" — do not invent Desire Spaces from catalog noise.
  if (isAnaphoricProjectRef(text)) return false;
  // Search + narrowing constraints → identity from filters, not PROJECT_VECTORS
  // (LOC-G01: "show me projects in North Bangalore…" must not invent Eldorado).
  if (
    ex.speechAct === 'search' &&
    Boolean(ex.constraints.budgetMaxInr || ex.constraints.location || ex.constraints.bhk)
  ) {
    return false;
  }
  // Location correction ("meant Whitefield not Devanahalli") — filters, not catalog identity.
  if (isLocationCorrectionTurn(text)) return false;
  const t = text.trim().toLowerCase();
  // Pure discovery constraint lines — location + budget without a project name.
  // Do not let "show me" (PROJECT_REF_RE) defeat this — that is a search verb, not a name.
  if (
    /\b\d+\s*(?:lakh|lac|l|cr|crore)\b/.test(t) &&
    !/\b(?:about|compare|visit|brochure|switch\s+to|tell\s+me|interested\s+in|know\s+more|more\s+about|also\s+about|share|add|sounds\s+good|looks\s+good)\b/i.test(
      text,
    ) &&
    !/\b(?:ayana|krishnaja|brigade|greens|eldorado|cornerstone|utopia|exotica|orchards|neo|vanam)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  // Focused/visit pure-facet asks — stay on focus unless structural cue or session-pool name.
  // Never gate on a hardcoded catalog list; vectors resolve identity.
  if (ctx.phase === 'focused' || ctx.phase === 'visit') {
    const pool = (ctx.offeredProjectNames ?? []).map((name) => ({ name }));
    // Bare "I want to visit" / visit_book — stay on focus; do not invent Desire Spaces.
    if (
      (ex.speechAct === 'visit_book' || ex.transition === 'want_visit') &&
      !buyerCuedOtherProject(text, pool)
    ) {
      return false;
    }
    const facetAsk =
      (ex.askTopic && ex.askTopic !== 'compare') ||
      (ex.askTopics?.some((topic) => topic !== 'compare') ?? false);
    if (facetAsk && !buyerCuedOtherProject(text, pool)) return false;
    if (facetAsk && facetNameResidue(text).length < 3) return false;
    return true;
  }
  if (ex.affirm) return true;
  if (ex.transition === 'want_visit' || ex.transition === 'want_details') return true;
  if (ex.askTopic === 'compare' || ex.askTopic === 'media') return true;
  if (ex.askTopics?.some((t) => t === 'compare' || t === 'media')) return true;
  // Facet ask + leftover name residue after facet strip → let vectors resolve (no catalog regex).
  const facetTopics = ex.askTopics?.length
    ? ex.askTopics
    : ex.askTopic
      ? [ex.askTopic]
      : detectTopics(text);
  if (facetTopics.some((topic) => topic !== 'compare') && facetNameResidue(text).length >= 3) {
    return true;
  }
  // Chip miss + shortlist on the board: resolve which offered project was named.
  // Do not vectorize bare discovery seeds (empty shortlist) — that broke Coorg funnel.
  // Allow short picks ("Neo", 3 chars) when a shortlist is already on the board.
  if (ex.speechAct === 'unknown' && (ctx.offeredProjectNames?.length ?? 0) > 0) {
    return text.trim().length >= 3;
  }
  // After a constraint-bearing session (incl. no_fit), bare project name ("Ayana")
  // must still resolve via PROJECT_VECTORS — shortlist may be empty.
  if (
    ex.speechAct === 'unknown' &&
    Boolean(
      ctx.hasPriorConstraints ||
        ex.constraints.location ||
        ex.constraints.propertyType ||
        ex.constraints.budgetMaxInr,
    ) &&
    text.trim().split(/\s+/).length <= 2 &&
    text.trim().length >= 4 &&
    !/\b(?:lakh|lac|cr|crore|bhk|apartment|villa|plot|plantation|budget|under|near|in)\b/i.test(text)
  ) {
    return true;
  }
  return PROJECT_REF_RE.test(text);
}

export function makeSemanticNlu(env: Env): SemanticNluPort {
  return {
    async enrich(text, builderId, ex, ctx): Promise<Extracted> {
      if (!env.AI) return ex;
      let next = ex;
      const topics = ex.askTopics?.length ? ex.askTopics : detectTopics(text);

      // Topic gap-fill when chip-resolve left act unknown (or regex topics empty).
      // INTENT_VECTORS never invents a chip — only fills AnswerTopic under answer/search.
      if (topics.length === 0 && env.INTENT_VECTORS) {
        const vectors = await embedTexts(env.AI, [text]);
        const query = vectors[0];
        if (query) {
          const results = await env.INTENT_VECTORS.query(query, {
            topK: 3,
            returnMetadata: 'all',
            filter: { builder_scope: builderId },
          }).catch(() => null);
          const top = results?.matches?.[0];
          const kind =
            top?.metadata && typeof top.metadata.intent_kind === 'string'
              ? (top.metadata.intent_kind as string)
              : '';
          const score = top?.score ?? 0;
          const topic = INTENT_TO_TOPIC[kind];
          // find_projects often wins on "options for X in Project" — if shortlist
          // already named a project, treat as unit/config ask (corpus will refine).
          const namedOnShortlist =
            (next.namedProjects?.length ?? 0) > 0 ||
            ((ctx.offeredProjectNames?.length ?? 0) > 0 &&
              ctx.offeredProjectNames!.some((n) =>
                text.toLowerCase().includes(
                  n.toLowerCase().replace(/^(brigade|lokations)\s+/i, ''),
                ),
              ));
          const bridgedTopic =
            !topic &&
            namedOnShortlist &&
            score >= TOPIC_THRESHOLD &&
            (kind === 'find_projects' || kind === 'recommend') &&
            looksLikeConfigAsk(text)
              ? ('availability' as AnswerTopic)
              : topic;
          if (bridgedTopic && score >= TOPIC_THRESHOLD) {
            next = {
              ...next,
              askTopic: next.askTopic ?? bridgedTopic,
              askTopics: next.askTopics?.length ? next.askTopics : [bridgedTopic],
            };
          }
        }
      }

      const baseTopics = next.askTopics ?? (next.askTopic ? [next.askTopic] : []);
      if (
        !next.constraints.location &&
        !isDetailAskTurn(next) &&
        baseTopics.length === 0 &&
        ctx.microMarkets.length > 0
      ) {
        const locHint =
          /\b(?:in|near|around|at|projects?\s+in)\s+([A-Za-z][A-Za-z\s/.-]{2,40})/i.exec(text)?.[1]?.trim() ??
          text.trim();
        if (locHint.length >= 3) {
          const batch = [locHint, ...ctx.microMarkets.slice(0, 24)];
          const vectors = await embedTexts(env.AI, batch);
          if (vectors.length === batch.length) {
            const q = vectors[0]!;
            let bestIdx = -1;
            let bestScore = 0;
            for (let i = 1; i < vectors.length; i++) {
              const score = cosine(q, vectors[i]!);
              if (score > bestScore) {
                bestScore = score;
                bestIdx = i - 1;
              }
            }
            if (bestIdx >= 0 && bestScore >= LOCATION_THRESHOLD) {
              next = {
                ...next,
                constraints: { ...next.constraints, location: ctx.microMarkets[bestIdx] },
              };
            }
          }
        }
      }

      // PROJECT_VECTORS — which project (full builder catalog, not shortlist).
      if (
        env.PROJECT_VECTORS &&
        shouldQueryProjectVectors(text, next, ctx)
      ) {
        const picked = await resolveNamedProjectsFromVectors(env, text, builderId, next);
        if (picked.length > 0) {
          next = { ...next, namedProjects: picked };
        }
      }

      return next;
    },
  };
}

export function noopSemanticNlu(): SemanticNluPort {
  return { async enrich(_t, _b, ex) { return ex; } };
}
