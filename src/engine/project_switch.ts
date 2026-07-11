/**
 * Focused-phase project switch — commit when PROJECT_VECTORS fills namedProjects.
 */
import type { AnswerTopic, ConversationState, Extracted, OfferedProject, TurnGoal } from './types.js';
import type { EngineDeps } from './ports.js';

export interface SwitchIntent {
  readonly followUp?: AnswerTopic;
  readonly followUpTopics?: AnswerTopic[];
}

/** Facets that stay on the current focus unless the buyer names another project. */
const FOCUS_STICKY_FACETS: ReadonlySet<AnswerTopic> = new Set([
  'price',
  'legal',
  'emi',
  'amenities',
  'availability',
  'location',
  'media',
  'property_type',
  'overview',
]);

function followUpTopics(ex: Extracted): { followUp?: AnswerTopic; followUpTopics?: AnswerTopic[] } {
  const topics = ex.askTopics?.length ? ex.askTopics.filter((t) => t !== 'compare') : [];
  if (topics.length) return { followUp: topics[0], followUpTopics: topics };
  if (ex.askTopic && ex.askTopic !== 'compare') return { followUp: ex.askTopic };
  if (ex.transition === 'want_details') return { followUp: 'overview' };
  return { followUp: 'overview' };
}

function isStickyFacetAsk(ex: Extracted): boolean {
  if (ex.askTopic && FOCUS_STICKY_FACETS.has(ex.askTopic)) return true;
  return (ex.askTopics ?? []).some((t) => FOCUS_STICKY_FACETS.has(t));
}

/**
 * Tokens left after stripping facet / stop words.
 * Empty residue ⇒ pure facet chip ("Send brochure") — do not switch on vector noise.
 */
export function facetNameResidue(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /\b(?:send|share|please|the|a|an|me|my|for|on|about|project|brochure|floor|plans?|pricing|prices?|starting|legal|status|details?|emi|amenities|availability|configurations?|configs?|units?|location|connectivity|banks?|ec|clear|media|overview|what|is|are|unit|paperwork|paper\s*work|okay|ok|somehow|this|one)\b/gi,
      ' ',
    )
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function exactPoolPick(pool: readonly OfferedProject[], pickName: string): OfferedProject | null {
  const needle = pickName.trim().toLowerCase();
  for (const o of pool) {
    if (o.name.trim().toLowerCase() === needle) return o;
  }
  return null;
}

function poolOf(s: ConversationState): OfferedProject[] {
  const pool = [...s.discover.lastOffered];
  if (s.focus && !pool.some((p) => p.projectId === s.focus!.projectId)) {
    pool.push({ projectId: s.focus.projectId, name: s.focus.projectName });
  }
  return pool;
}

/** Sync detection — returns null when no switch or when compare/handoff paths own the turn. */
export function detectFocusedSwitchIntent(
  _text: string,
  ex: Extracted,
  s: ConversationState,
): (SwitchIntent & { commit: OfferedProject }) | null {
  if (!s.focus) return null;
  if (ex.recall || ex.stop || ex.transition === 'see_others' || ex.wantsMore || ex.transition === 'want_visit') {
    return null;
  }
  // Bare affirm is dialogue continuation — never switch from vector noise.
  if (ex.affirm) {
    const bare =
      /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|haan?|theek|done|confirm(?:ed)?|go ahead|sounds good|perfect|great)\.?!?\s*$/i.test(
        _text.trim(),
      );
    if (bare && !ex.pickName) return null;
  }
  if ((ex.compareProjectIds?.length ?? 0) >= 2) return null;
  if (ex.askTopic === 'compare' && (ex.compareProjectIds?.length ?? 0) >= 2) return null;
  // Two named projects → compare path owns the turn, not a single-project switch.
  if ((ex.namedProjects?.length ?? 0) >= 2) return null;

  const focus = s.focus;
  const fu = followUpTopics(ex);

  // Deictic "this one" / "for this" stays on focus — vectors must not invent a switch.
  if (/\b(?:this\s+one|this\s+project|for\s+this|about\s+this)\b/i.test(_text) && !ex.pickName) {
    return null;
  }

  const named = ex.namedProjects;
  if (named && named.length >= 1) {
    const n = named[0];
    if (!n) return null;
    if (n.projectId !== focus.projectId) {
      // "Send brochure" while focused — PROJECT_VECTORS often invents another project.
      // Only switch when the buyer left a name-like residue (e.g. "brochure for Eldorado").
      if (isStickyFacetAsk(ex) && facetNameResidue(_text).length < 3) return null;
      return { commit: n, ...fu };
    }
    return null;
  }

  if (ex.pickName) {
    const hit = exactPoolPick(poolOf(s), ex.pickName);
    if (hit && hit.projectId !== focus.projectId) {
      if (isStickyFacetAsk(ex) && facetNameResidue(_text).length < 3) return null;
      return { commit: hit, ...fu };
    }
  }

  return null;
}

export async function resolveFocusedSwitchGoal(
  text: string,
  ex: Extracted,
  s: ConversationState,
  _deps: EngineDeps,
): Promise<TurnGoal | null> {
  const intent = detectFocusedSwitchIntent(text, ex, s);
  if (!intent) return null;

  const { commit, followUp, followUpTopics: fuTopics } = intent;
  return {
    kind: 'commit',
    projectId: commit.projectId,
    projectName: commit.name,
    ...(followUp ? { followUp } : {}),
    ...(fuTopics?.length ? { followUpTopics: fuTopics } : {}),
  };
}
