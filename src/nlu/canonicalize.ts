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

/** Build one longest-first, case-insensitive, word-boundary alternation. */
function compile(terms: string[]): RegExp | null {
  const parts = terms
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  if (parts.length === 0) return null;
  return new RegExp('\\b(' + parts.join('|') + ')\\b', 'gi');
}

const RX_PROJECT = compile(vocab.projects as string[]);
const RX_BUILDER = compile(vocab.builders as string[]);
const RX_PLACE = compile(vocab.places as string[]);

/**
 * Canonicalize buyer/corpus text to its masked intent shape. Deterministic and
 * side-effect free — safe to call on the hot path (a few regex passes).
 */
export function canonicalize(text: string): string {
  let t = text ?? '';
  if (RX_PROJECT) t = t.replace(RX_PROJECT, '<project>');
  if (RX_BUILDER) t = t.replace(RX_BUILDER, '<builder>');
  if (RX_PLACE) t = t.replace(RX_PLACE, '<place>');
  return t.replace(WS, ' ').trim().toLowerCase();
}

/** Vocab sizes — for the rebuild report / command-center diagnostics. */
export const vocabSizes = {
  projects: (vocab.projects as string[]).length,
  builders: (vocab.builders as string[]).length,
  places: (vocab.places as string[]).length,
};
