/**
 * Project-reference resolver — names, anaphora ("both", "these"), and bot-reply binding.
 * Ported from Naya src/agent/project_references.ts (pure, deterministic).
 */

import { bearingTokensOf, tokenizeName } from './name-index.js';

export interface ProjectRef {
  readonly project_id: string;
  readonly name: string;
}

export interface ContextMessage {
  readonly text: string;
  readonly created_at_ms: number;
}

export function nameTokens(name: string): string[] {
  return tokenizeName(name);
}

/**
 * Which words name this project, judged against the set it is being resolved
 * from. See name-index.ts — the old rule ("drop the first token, keep tokens ≥5
 * chars") deleted `Viva` from `Viva Greens` and left both Greens projects
 * answering to the bare word `greens`.
 */
function distinctiveTokens(name: string, siblings: ReadonlyArray<{ name: string }>): string[] {
  return bearingTokensOf(name, siblings);
}

export function nameMentioned(
  name: string,
  haystackLc: string,
  siblings: ReadonlyArray<{ name: string }> = [{ name }],
): boolean {
  const distinctive = distinctiveTokens(name, siblings);
  return distinctive.some((t) => haystackLc.includes(t));
}

export function nameFullyMentioned(
  name: string,
  haystackLc: string,
  siblings: ReadonlyArray<{ name: string }> = [{ name }],
): boolean {
  const distinctive = distinctiveTokens(name, siblings);
  return distinctive.length > 0 && distinctive.every((t) => haystackLc.includes(t));
}

export function disambiguateStrictSupersets<P extends ProjectRef>(
  hits: ReadonlyArray<P>,
  textLc: string,
  siblings: ReadonlyArray<{ name: string }> = hits,
): P[] {
  return hits.filter((p) => {
    const pDist = distinctiveTokens(p.name, siblings);
    for (const q of hits) {
      if (q.project_id === p.project_id) continue;
      const qDist = distinctiveTokens(q.name, siblings);
      if (qDist.length < pDist.length) {
        // p is the LONGER name. "cornerstone" alone must not drag in Utopia:
        // drop p when its extra words are absent from the text.
        if (qDist.every((t) => pDist.includes(t)) && qDist.every((t) => textLc.includes(t))) {
          const extra = pDist.filter((t) => !qDist.includes(t));
          if (extra.some((t) => !textLc.includes(t))) return false;
        }
      } else if (qDist.length > pDist.length) {
        // p is the SHORTER name, and the mirror case: "cornerstone utopia" names
        // Utopia specifically, so the plain Cornerstone sibling loses. Without
        // this, a buyer naming the longer project got BOTH back.
        if (pDist.every((t) => qDist.includes(t))) {
          const extra = qDist.filter((t) => !pDist.includes(t));
          if (extra.length > 0 && extra.every((t) => textLc.includes(t))) return false;
        }
      }
    }
    return true;
  });
}

function projectsInListing<P extends ProjectRef>(text: string, knownProjects: ReadonlyArray<P>): P[] {
  const textLc = text.toLowerCase();
  const hits = knownProjects.filter((p) => nameFullyMentioned(p.name, textLc, knownProjects));
  return disambiguateStrictSupersets(hits, textLc, knownProjects);
}

const ANAPHORA_RE =
  /\b(?:these|those|both|the\s+two|all\s+(?:of\s+)?(?:them|these|three)|dono|both\s+projects?)\b/i;

export function resolveProjectReferences<P extends ProjectRef>(
  text: string,
  recentMessages: ReadonlyArray<ContextMessage>,
  knownProjects: ReadonlyArray<P>,
): P[] {
  const textLc = text.toLowerCase();
  // Judge every candidate against the whole set: `greens` names neither Greens
  // project, and the superset rule must apply to the BUYER's words too — it was
  // previously reached only via projectsInListing, i.e. only for bot replies.
  const direct = disambiguateStrictSupersets(
    knownProjects.filter((p) => nameMentioned(p.name, textLc, knownProjects)),
    textLc,
    knownProjects,
  );
  if (direct.length > 0) return direct;

  if (!ANAPHORA_RE.test(text)) return [];

  const byNewest = [...recentMessages].sort((a, b) => b.created_at_ms - a.created_at_ms);
  let single: P[] | null = null;
  for (const m of byNewest) {
    const hits = projectsInListing(m.text, knownProjects);
    if (hits.length >= 2) return hits;
    if (hits.length === 1 && !single) single = hits;
  }
  return single ?? [];
}
