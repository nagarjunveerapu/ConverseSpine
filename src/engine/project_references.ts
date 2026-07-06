/**
 * Project-reference resolver — names, anaphora ("both", "these"), and bot-reply binding.
 * Ported from Naya src/agent/project_references.ts (pure, deterministic).
 */

export interface ProjectRef {
  readonly project_id: string;
  readonly name: string;
}

export interface ContextMessage {
  readonly text: string;
  readonly created_at_ms: number;
}

export function nameTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
}

export function nameMentioned(name: string, haystackLc: string): boolean {
  const tokens = nameTokens(name);
  const distinctive = tokens.length > 1 ? tokens.slice(1) : tokens;
  return distinctive.some((t) => haystackLc.includes(t));
}

function distinctiveTokens(name: string): string[] {
  const tokens = nameTokens(name);
  return tokens.length > 1 ? tokens.slice(1) : tokens;
}

export function nameFullyMentioned(name: string, haystackLc: string): boolean {
  const distinctive = distinctiveTokens(name);
  return distinctive.length > 0 && distinctive.every((t) => haystackLc.includes(t));
}

export function disambiguateStrictSupersets<P extends ProjectRef>(
  hits: ReadonlyArray<P>,
  textLc: string,
): P[] {
  return hits.filter((p) => {
    const pDist = distinctiveTokens(p.name);
    for (const q of hits) {
      if (q.project_id === p.project_id) continue;
      const qDist = distinctiveTokens(q.name);
      if (qDist.length >= pDist.length) continue;
      if (qDist.every((t) => pDist.includes(t)) && qDist.every((t) => textLc.includes(t))) {
        const extra = pDist.filter((t) => !qDist.includes(t));
        if (extra.some((t) => !textLc.includes(t))) return false;
      }
    }
    return true;
  });
}

function projectsInListing<P extends ProjectRef>(text: string, knownProjects: ReadonlyArray<P>): P[] {
  const textLc = text.toLowerCase();
  const hits = knownProjects.filter((p) => nameFullyMentioned(p.name, textLc));
  return disambiguateStrictSupersets(hits, textLc);
}

const ANAPHORA_RE =
  /\b(?:these|those|both|the\s+two|all\s+(?:of\s+)?(?:them|these|three)|dono|both\s+projects?)\b/i;

export function resolveProjectReferences<P extends ProjectRef>(
  text: string,
  recentMessages: ReadonlyArray<ContextMessage>,
  knownProjects: ReadonlyArray<P>,
): P[] {
  const textLc = text.toLowerCase();
  const direct = knownProjects.filter((p) => nameMentioned(p.name, textLc));
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
