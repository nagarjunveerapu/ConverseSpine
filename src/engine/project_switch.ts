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
 * Tokens left after stripping facet / stop words / config scaffolding.
 * Empty residue ⇒ pure facet chip ("Send brochure" / "show me the 2 bhk floor plan")
 * — do not switch on vector noise.
 */
export function facetNameResidue(text: string): string {
  return text
    .toLowerCase()
    // Config / size scaffolding first (BHK-scoped media asks leave "2 bhk" otherwise).
    .replace(/\b\d+(?:\.\d+)?\s*(?:bhk|bed(?:room)?s?)\b/gi, ' ')
    .replace(/\b(?:bhk|bed(?:room)?s?|sq\.?\s*ft|sqft)\b/gi, ' ')
    .replace(
      // AB-5 — modal/pronoun dialogue words ("can I …") and TYPE words (villa/plot)
      // are not a project-name residue. Leaving them made hasExplicitProjectCue treat
      // "can I see the 2 BHK floor plan?" (residue "can i") and "4 BHK villa sizes"
      // (residue "villa sizes") as a cue to a named OTHER project — so an embedder
      // hallucination (Century Breeze) survived the focus scrub and won the turn.
      /\b(?:send|share|show|see|give|get|want|need|please|the|a|an|me|my|for|on|about|project|brochure|floor|plans?|layout|pricing|prices?|price|size|sizes|starting|legal|status|details?|emi|amenities|availability|configurations?|configs?|units?|location|connectivity|banks?|ec|clear|media|overview|what|which|is|are|unit|paperwork|paper\s*work|okay|ok|somehow|this|that|one|bhejo|bhej|bhejna|bhej\s*do|batao|dikhao|dikha|do|karo|please|thanks|thank\s*you|bsp|carpet|sba|possession|date|area|break(?:\s|-)?up|breakdown|how|much|kitna|padega|and|or|with|from|also|any|there|can|could|would|should|shall|will|may|might|i|you|we|they|it|villas?|plots?|plotted|apartments?|flats?|plantations?|estates?|bungalows?)\b/gi,
      ' ',
    )
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Buyer pointed at another project via dialogue structure — not a catalog name list.
 * Identity still resolves via PROJECT_VECTORS / shortlist / discussed.
 *
 * W4: do not grow this with brand/project hardcodes — structural cues + session pool only.
 *
 * True when: switch/re-focus phrasing + non-empty name residue after facet strip,
 * or sticky media/ask "for|about <residue>" with residue ≥ 3.
 */
export function hasExplicitProjectCue(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const residue = facetNameResidue(t);
  if (residue.length < 3) return false;

  // Re-focus / switch / deixis toward a named other project.
  if (
    /\b(?:back\s+to|switch\s+to|instead|what\s+about|tell\s+me\s+about|more\s+about|also\s+(?:about\s+)?|interested\s+in|know\s+more\s+about)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // "brochure for X" / "pricing on X" — residue is the name cue; vectors resolve which.
  if (
    /\b(?:brochure|floor\s*plans?|pricing|prices?|legal|details?|overview|visit)\b/i.test(t) &&
    /\b(?:for|on|about)\b/i.test(t)
  ) {
    return true;
  }
  // "Krishnaja Greens pricing" — facet token + leftover name residue (not a brand list).
  if (
    /\b(?:brochure|floor\s*plans?|pricing|prices?|price|legal|details?|overview|emi|amenities|availability|bsp|carpet|possession)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Residue overlaps offered/discussed/focus names (session pool — never a global catalog). */
export function residueMatchesPool(
  text: string,
  pool: ReadonlyArray<{ name: string }>,
): boolean {
  const residue = facetNameResidue(text);
  if (residue.length < 3 || !pool.length) return false;
  const r = residue.toLowerCase();
  for (const o of pool) {
    const name = o.name.trim().toLowerCase();
    if (!name) continue;
    const distinctive = name.replace(/^\S+\s+/, ''); // drop leading brand token if any
    if (r.includes(name) || (distinctive.length >= 3 && r.includes(distinctive))) return true;
    if (name.includes(r) || (distinctive.length >= 3 && distinctive.includes(r))) return true;
  }
  return false;
}

/** Structural cue OR session-pool name hit — identity still resolves via vectors. */
export function buyerCuedOtherProject(
  text: string,
  pool?: ReadonlyArray<{ name: string }>,
): boolean {
  if (hasExplicitProjectCue(text)) return true;
  if (pool?.length) return residueMatchesPool(text, pool);
  return false;
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
  for (const d of s.discover.discussedProjects ?? []) {
    if (!pool.some((p) => p.projectId === d.projectId)) pool.push(d);
  }
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
      // Sticky facet without structural/pool cue → stay on focus (vector noise).
      if (isStickyFacetAsk(ex) && !buyerCuedOtherProject(_text, poolOf(s))) return null;
      return { commit: n, ...fu };
    }
    return null;
  }

  if (ex.pickName) {
    const pool = poolOf(s);
    const hit = exactPoolPick(pool, ex.pickName);
    if (hit && hit.projectId !== focus.projectId) {
      if (isStickyFacetAsk(ex) && !buyerCuedOtherProject(_text, pool)) return null;
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
