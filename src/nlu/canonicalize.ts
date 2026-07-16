/**
 * Entity canonicalization for the semantic intent layer (SIL schema evolution).
 *
 * The corpus and the live query are embedded through THIS one function, so the
 * two never drift (the train/serve-skew fix): buyers type "price of Brigade
 * Oasis in Whitefield", the corpus stores "1BHK chahiye Whitefield ke paas" —
 * both collapse to "<project>"/"<place>" tokens here, and the embedder scores on
 * intent shape rather than surface names it has never seen.
 *
 * Rules (must stay identical to scripts/registry-v2.py `canonical()` and
 * scripts/mine-yantra.py `canon()`, which produced the registry's canonical
 * column offline):
 *   1. project → <project>, then builder → <builder>, then place → <place>
 *      (order matters: a project name may contain a builder token).
 *   2. longest phrase first, so "sarjapur road" wins over "sarjapur".
 *   3. case-insensitive match on word boundaries; collapse whitespace; lowercase.
 *   4. numbers are KEPT — BHK/budget are real intent signal, not noise.
 *
 * Vocab is bundled (src/nlu/mask-vocab.json) — a strict superset of the
 * Desk-sourced corpus vocab. Bundling (vs a runtime Desk fetch) guarantees the
 * rebuild and the query see the exact same vocab with no hot-path dependency;
 * it refreshes on deploy, in lockstep with the corpus it was built from.
 */
import vocab from './mask-vocab.json';

const WS = /\s+/g;

export interface MaskVocab {
  places: string[];
  builders: string[];
  projects: string[];
}

/** Build one longest-first, case-insensitive, word-boundary alternation. */
function compile(terms: string[]): RegExp | null {
  const parts = terms
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  if (parts.length === 0) return null;
  return new RegExp('\\b(' + parts.join('|') + ')\\b', 'gi');
}

/** The static bundled vocab — Desk-sourced snapshot + gazetteer. Used as the
 *  default and as the FALLBACK when the live Desk/KV vocab is unavailable. */
export const BUNDLED_VOCAB: MaskVocab = {
  places: vocab.places as string[],
  builders: vocab.builders as string[],
  projects: vocab.projects as string[],
};

/**
 * Compile a canonicalizer bound to a specific vocab (Understanding Flywheel
 * §7.4). The rebuild and the live query each construct one from the vocab
 * snapshot they load, so corpus and query always mask with the identical vocab
 * — the same code path, no train/serve drift. Regexes compile once per vocab.
 */
export function makeCanonicalizer(v: MaskVocab): (text: string) => string {
  const rxProject = compile(v.projects);
  const rxBuilder = compile(v.builders);
  const rxPlace = compile(v.places);
  return (text: string): string => {
    let t = text ?? '';
    if (rxProject) t = t.replace(rxProject, '<project>');
    if (rxBuilder) t = t.replace(rxBuilder, '<builder>');
    if (rxPlace) t = t.replace(rxPlace, '<place>');
    return t.replace(WS, ' ').trim().toLowerCase();
  };
}

/** Union two vocabs (live Desk catalog ∪ static gazetteer seed), deduped. */
export function mergeVocab(a: MaskVocab, b: MaskVocab): MaskVocab {
  const u = (x: string[], y: string[]) => [...new Set([...x, ...y].filter(Boolean))];
  return {
    places: u(a.places, b.places),
    builders: u(a.builders, b.builders),
    projects: u(a.projects, b.projects),
  };
}

/** Default canonicalizer over the bundled vocab. Backward-compatible with all
 *  existing call sites; live-vocab call sites use makeCanonicalizer instead. */
export const canonicalize = makeCanonicalizer(BUNDLED_VOCAB);

/** Vocab sizes — for the rebuild report / command-center diagnostics. */
export const vocabSizes = {
  projects: BUNDLED_VOCAB.projects.length,
  builders: BUNDLED_VOCAB.builders.length,
  places: BUNDLED_VOCAB.places.length,
};
