/**
 * Hold-intent gate (Phase 4 launch ops) — the closed-set lexical extractor
 * behind the unit-hold sub-flow, stamped as `ex.holdAsk` in the extract
 * funnel (same discipline as the other deterministic extractors) and consumed
 * by focused.decide.
 *
 * Deliberately conservative — a hold is a Desk write, so false positives cost
 * more than misses:
 *  - `book` is NOT a hold verb: in Indian buyer chat "book a 2BHK" usually
 *    means purchase intent, not a soft 24h inventory hold.
 *  - Visit phrasing ("block saturday for a site visit") never fires.
 *  - Weak objects ("hold IT / hold ONE for me") need a strong verb
 *    (hold/reserve), and the type then comes from the buyer's stated BHK
 *    preference. Explicit objects ("block a 2 bhk") may use any hold verb.
 */

const HOLD_VERB = /\b(?:hold|reserve|block)\b/i;
const HOLD_VERB_STRONG = /\b(?:hold|reserve)\b/i;
const EXPLICIT_OBJECT = /\b(?:[1-9]\s*(?:bhk|bed)|unit|flat|apartment|villa|plot|home|house)\b/i;
const WEAK_OBJECT = /\b(?:one|it)\b/i;
const VISIT_WORDS = /\b(?:visit|site|tour|appointment|slot|come|drop by)\b/i;
const BHK_OF = /([1-9])\s*(?:bhk|bed)/i;

/** Does this utterance explicitly ask to hold/reserve a unit? */
export function holdIntent(text: string): boolean {
  if (!text || VISIT_WORDS.test(text)) return false;
  if (HOLD_VERB.test(text) && EXPLICIT_OBJECT.test(text)) return true;
  // "hold it / reserve one for me" — only the unambiguous verbs.
  return HOLD_VERB_STRONG.test(text) && WEAK_OBJECT.test(text);
}

/**
 * The unit TYPE to hold: named in the ask ("2 bhk"), else the buyer's stated
 * BHK preference — but the stored-preference fallback needs a strong verb
 * ("block a flat" with no type stays a normal availability answer).
 */
export function holdUnitType(text: string, constraintBhk: string | undefined): string | null {
  const m = text.match(BHK_OF);
  if (m) return `${m[1]} BHK`;
  if (!HOLD_VERB_STRONG.test(text)) return null;
  const bhk = constraintBhk?.trim();
  if (!bhk) return null;
  return /^[1-9]$/.test(bhk) ? `${bhk} BHK` : bhk;
}
