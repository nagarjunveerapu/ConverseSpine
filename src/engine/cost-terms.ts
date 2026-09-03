/**
 * The builder's own cost vocabulary, read from the catalog instead of guessed.
 *
 * `isCostComponentAsk` has been a hand-written alternation of about twenty
 * phrases in facts.ts — stamp duty, registration, GST, floor rise, corpus. Real
 * cost sheets carry heads that list never anticipates: "BESCOM charges",
 * "corner premium", "khata transfer", "plantation management". Adding one has
 * meant editing a regex and deploying the bot, which is the pattern-ladder trap
 * this codebase is trying to leave.
 *
 * Desk has served the answer since #212: `thread_context` returns
 * `cost_sheet[].match_terms`, already parsed, with a comment saying it exists
 * "so the bot can detect a cost-component ask — no hardcoded vocabulary".
 * Nothing on this side ever read it. Both halves of the contract were built and
 * never joined.
 */

/**
 * Bare single tokens that are NOT safe cost signals on their own.
 *
 * A cost sheet legitimately contains rows like "Plantation management charges"
 * and "Base land price", and match_terms flattens those into single words.
 * "plantation" is a property type in this catalog and "land"/"base"/"area" are
 * generic enough to fire on ordinary discovery text, so a bare occurrence must
 * not turn a search into a price ask. The multi-word phrases survive and still
 * match — only the lone token is dropped.
 */
const COST_TERM_COLLISIONS: ReadonlySet<string> = new Set([
  'plantation', 'villa', 'plot', 'plotted', 'apartment', 'flat', 'land',
  'base', 'area', 'management', 'property', 'rate', 'price', 'booking',
]);

/** Minimum length for a term to be worth matching at all. */
const MIN_TERM_LEN = 3;

export interface CostSheetRow {
  label?: string;
  kind?: string;
  match_terms?: string[];
}

/**
 * Flatten a project's cost sheet into the terms worth matching buyer text
 * against. Deduped, lowercased, collisions dropped.
 */
export function costTermsFromCostSheet(
  rows: readonly CostSheetRow[] | undefined | null,
): readonly string[] {
  const out = new Set<string>();
  for (const row of rows ?? []) {
    for (const raw of row.match_terms ?? []) {
      const term = String(raw).trim().toLowerCase();
      if (term.length < MIN_TERM_LEN) continue;
      if (!term.includes(' ') && COST_TERM_COLLISIONS.has(term)) continue;
      out.add(term);
    }
  }
  return [...out];
}

/**
 * Does the buyer's text name one of this project's cost heads?
 *
 * Whole-word for single tokens so "corpus" does not fire inside "corporate";
 * plain substring for phrases, which cannot collide the same way.
 */
export function matchesCostTerm(text: string, terms: readonly string[] | undefined): boolean {
  if (!terms?.length) return false;
  const hay = text.toLowerCase();
  for (const term of terms) {
    if (term.includes(' ')) {
      if (hay.includes(term)) return true;
    } else if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay)) {
      return true;
    }
  }
  return false;
}
