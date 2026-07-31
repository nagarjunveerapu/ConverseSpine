/**
 * Focused-phase project switch — commit when PROJECT_VECTORS fills namedProjects.
 */
import type { AnswerTopic, ConversationState, Extracted, OfferedProject, TurnGoal } from './types.js';
import type { EngineDeps } from './ports.js';
import { bearingTokensOf, tokenizeName } from './name-index.js';

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

/** One insertion/deletion/substitution — tolerates buyer typos ("conerstone"). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  const [s, l] = la <= lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) {
      i++;
      j++;
      continue;
    }
    if (edits++) return false;
    if (s.length === l.length) i++; // substitution
    j++; // insertion in the longer string (or the substitution's other half)
  }
  return edits + (l.length - j) + (s.length - i) <= 1;
}

/**
 * The words that actually name this project, judged against the catalog it lives
 * in (see name-index.ts). Previously a fixed ≥4-char filter with the first token
 * dropped — which let the brand token `brigade` stand as evidence for any of ten
 * Brigade rows, and let `greens` name two different projects at once.
 */
function evidenceTokens(
  name: string,
  siblings: ReadonlyArray<{ name: string }> = [{ name }],
): string[] {
  return bearingTokensOf(name, siblings);
}

function tokenMatchesWord(word: string, token: string): boolean {
  if (word === token) return true;
  // Typo tolerance only where a single edit can't turn one real word into another
  // short one ("oasis" vs "basis" stays exact-only via the length floor).
  return token.length >= 6 && word.length >= 5 && withinOneEdit(word, token);
}

export type NameEvidence = 'full' | 'partial' | 'none';

/**
 * Does the buyer's own text contain this project's name? Judged on the facet-stripped
 * residue so "starting prices for eldorado" reads as name evidence while "starting
 * prices" alone never does. 'full' = every distinctive token present (typo-tolerant);
 * 'partial' = some; 'none' = the buyer never named this project.
 */
export function nameEvidenceIn(
  text: string,
  name: string,
  siblings: ReadonlyArray<{ name: string }> = [{ name }],
): NameEvidence {
  const words = facetNameResidue(text).split(' ').filter(Boolean);
  if (!words.length) return 'none';
  // Only name-bearing tokens count. A word shared with an unrelated project
  // (`greens`, `brigade`) is not evidence for either of them — which is what the
  // old code's own comment said, while returning 'partial' anyway.
  const distinctive = evidenceTokens(name, siblings);
  if (!distinctive.length) return 'none';
  const matched = distinctive.filter((t) => words.some((w) => tokenMatchesWord(w, t)));
  if (matched.length === distinctive.length) return 'full';
  return matched.length > 0 ? 'partial' : 'none';
}

/**
 * Precision floor for vector/LLM-proposed project identity: a proposal survives only
 * when the buyer's text actually names it, and on split evidence the session pool
 * (board / discussed / focus) outranks the global catalog — "conerstone" must resolve
 * to the Cornerstone already on the buyer's board, never a same-brand sibling from
 * another corridor. Veto-only: this never adds candidates the extractor didn't propose.
 */
export function filterNamedProjectsByEvidence(
  text: string,
  named: ReadonlyArray<OfferedProject>,
  pool: ReadonlyArray<{ projectId?: string; name: string }>,
  /**
   * The builder's full catalog names. Without it a LONE proposal has no sibling
   * in the call to reveal that its token is shared — the embedder's top hit
   * "Krishnaja Greens" on "I want green spaces" looked fully named because no
   * Viva Greens was present to contest `greens`. Optional so every existing
   * caller keeps working, but the turn pipeline threads it.
   */
  catalogNames: ReadonlyArray<{ projectId?: string; name: string }> = [],
): OfferedProject[] {
  if (!named.length) return [...named];
  const siblings = [...catalogNames, ...named, ...pool];
  const inPool = (p: OfferedProject): boolean =>
    pool.some(
      (q) =>
        (q.projectId && q.projectId === p.projectId) ||
        q.name.trim().toLowerCase() === p.name.trim().toLowerCase(),
    );
  // The pool competes for identity: a board project fully named by the text beats a
  // global proposal that the text only partially names.
  const candidates: { p: OfferedProject; ev: NameEvidence; pool: boolean }[] = [];
  const seen = new Set<string>();
  for (const p of named) {
    candidates.push({ p, ev: nameEvidenceIn(text, p.name, siblings), pool: inPool(p) });
    seen.add(p.projectId);
  }
  for (const q of pool) {
    if (!q.projectId || seen.has(q.projectId)) continue;
    const ev = nameEvidenceIn(text, q.name, siblings);
    if (ev === 'full') candidates.push({ p: { projectId: q.projectId, name: q.name }, ev, pool: true });
  }
  // Catalog FULL-name rescue (veto-shaped: buyer's words must fully name it).
  // (1) Cold "tell me about cornerstone" when embedder proposed Utopia partial.
  // (2) NAME-06: embedder returns only focused Cornerstone while buyer typed
  //     "Brigade Cornerstone Utopia" — admit the longer catalog hit, then the
  //     token-superset rule drops the shorter.
  // Skip when a candidate already carries the same display name (embedder id
  // vs catalog id must not invent a false compare pair).
  for (const q of catalogNames) {
    const qid = 'projectId' in q ? q.projectId : undefined;
    if (!qid || seen.has(qid)) continue;
    const qName = q.name.trim().toLowerCase();
    if (candidates.some((c) => c.p.name.trim().toLowerCase() === qName)) continue;
    if (nameEvidenceIn(text, q.name, siblings) !== 'full') continue;
    seen.add(qid);
    candidates.push({ p: { projectId: qid, name: q.name }, ev: 'full', pool: false });
  }
  let alive = candidates.filter((c) => c.ev !== 'none');
  if (!alive.length) return [];
  // Specificity: a candidate whose matched tokens are a strict subset of another's
  // loses to the more specifically named one — "krishnaja greens" drops Viva Greens
  // (matched {greens} ⊂ {krishnaja, greens}); "cornerstone utopia" drops the plain
  // Cornerstone sibling the same way.
  const words = facetNameResidue(text).split(' ').filter(Boolean);
  const matchedSet = (name: string): string[] =>
    evidenceTokens(name, siblings)
      .filter((t) => words.some((w) => tokenMatchesWord(w, t)))
      .sort();
  const matched = new Map<string, string[]>(alive.map((c) => [c.p.projectId, matchedSet(c.p.name)]));
  const dropped = new Set<string>();
  for (const a of alive) {
    const ta = matched.get(a.p.projectId)!;
    for (const b of alive) {
      if (a === b) continue;
      const tb = matched.get(b.p.projectId)!;
      if (tb.length > ta.length && ta.every((t) => tb.includes(t))) {
        dropped.add(a.p.projectId);
      }
    }
  }
  if (dropped.size) alive = alive.filter((c) => !dropped.has(c.p.projectId));
  // Full sibling overshadows a partial that shares any name token.
  // Live NAME-06: "what about cornerstone utopia" → Utopia full, Brigade
  // Cornerstone partial (bearing fell back to {brigade,cornerstone}; brigade
  // absent). Matched sets {utopia} vs {cornerstone} are not nested, so the
  // subset rule above keeps both and the turn becomes a compare. Drop the
  // partial when a full candidate shares a token — true dual-full compares
  // ("ayana and krishnaja") are untouched.
  if (alive.some((c) => c.ev === 'full') && alive.some((c) => c.ev === 'partial')) {
    const fullTokenSets = alive
      .filter((c) => c.ev === 'full')
      .map((c) => new Set(tokenizeName(c.p.name)));
    alive = alive.filter((c) => {
      if (c.ev !== 'partial') return true;
      const pt = tokenizeName(c.p.name);
      return !fullTokenSets.some((ft) => pt.some((t) => ft.has(t)));
    });
  }
  // Name-token superset (dig NAME-06): both "Brigade Cornerstone" and
  // "Brigade Cornerstone Utopia" are FULL when the buyer types the longer name.
  // Drop the shorter when the longer is fully named — token sets nest.
  {
    const drop = new Set<string>();
    for (const a of alive) {
      const ta = tokenizeName(a.p.name);
      for (const b of alive) {
        if (a.p.projectId === b.p.projectId || b.ev !== 'full') continue;
        const tb = tokenizeName(b.p.name);
        if (tb.length > ta.length && ta.every((t) => tb.includes(t))) {
          drop.add(a.p.projectId);
        }
      }
    }
    if (drop.size) alive = alive.filter((c) => !drop.has(c.p.projectId));
  }
  // Full-beats-partial and pool-beats-global arbitrate only between candidates the
  // text points at with the SAME words ("conerstone" → board Cornerstone over global
  // Utopia) — distinct names in one utterance ("compare ayana and krishnaja greens")
  // are separate claims and all survive.
  const groups = new Map<string, typeof alive>();
  for (const c of alive) {
    const key = matched.get(c.p.projectId)!.join('|') || `#${c.p.projectId}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const keep = new Set<string>();
  for (const group of groups.values()) {
    const score = (c: { ev: NameEvidence; pool: boolean }): number =>
      (c.ev === 'full' ? 2 : 0) + (c.pool ? 1 : 0);
    const best = Math.max(...group.map(score));
    for (const c of group) if (score(c) === best) keep.add(c.p.projectId);
  }
  return alive.filter((c) => keep.has(c.p.projectId)).map((c) => c.p);
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
  const focus = s.focus;
  const fu = followUpTopics(ex);
  const siblings = [...poolOf(s), ...(ex.namedProjects ?? [])];

  /** Longer-sibling refinement while focused — switch, don't compare. */
  const refinementSwitch = (): (SwitchIntent & { commit: OfferedProject }) | null => {
    const candidates = ex.namedProjects ?? [];
    const others = candidates.filter((n) => n.projectId !== focus.projectId);
    if (others.length !== 1) return null;
    const other = others[0]!;
    const otherEv = nameEvidenceIn(_text, other.name, siblings);
    const focusEv = nameEvidenceIn(_text, focus.projectName, siblings);
    if (otherEv === 'full' && focusEv !== 'full') {
      return { commit: other, ...fu };
    }
    // Dig: both FULL when buyer types "Brigade Cornerstone Utopia" — still switch
    // when the other's name tokens are a strict superset of focus.
    if (otherEv === 'full' && focusEv === 'full') {
      const ft = tokenizeName(focus.projectName);
      const ot = tokenizeName(other.name);
      if (ot.length > ft.length && ft.every((t) => ot.includes(t))) {
        return { commit: other, ...fu };
      }
    }
    return null;
  };

  if ((ex.compareProjectIds?.length ?? 0) >= 2) {
    const refined = refinementSwitch();
    if (refined) return refined;
    return null;
  }
  if (ex.askTopic === 'compare' && (ex.compareProjectIds?.length ?? 0) >= 2) return null;

  // Two named projects usually mean compare — except NAME-06 refinement.
  if ((ex.namedProjects?.length ?? 0) >= 2) {
    const refined = refinementSwitch();
    if (refined) return refined;
    return null;
  }

  // Deictic "this one" / "for this" stays on focus — vectors must not invent a switch.
  // Do NOT match bare "what about <name>" — that is a refinement/switch cue (NAME-06).
  if (/\b(?:this\s+one|this\s+project|for\s+this|about\s+this)\b/i.test(_text) && !ex.pickName) {
    return null;
  }

  const named = ex.namedProjects;
  if (named && named.length >= 1) {
    const n = named[0];
    if (!n) return null;
    if (n.projectId !== focus.projectId) {
      // Sticky facet without structural/pool cue → stay on focus (vector noise) —
      // unless the buyer's text itself fully names the project ("and krishnaja
      // greens?"): typed name evidence beats the pool gate.
      //
      // NAME-06: "what about cornerstone utopia" while focused on Cornerstone —
      // overview is sticky, but `what about` + full name evidence must switch.
      const stickyHold =
        isStickyFacetAsk(ex) &&
        !buyerCuedOtherProject(_text, poolOf(s)) &&
        nameEvidenceIn(_text, n.name, siblings) !== 'full';
      if (stickyHold) {
        return null;
      }
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
