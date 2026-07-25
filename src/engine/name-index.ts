/**
 * Which words in a project's name actually pick that project out.
 *
 * Every name resolver in the engine used to answer this with a guess about name
 * SHAPE — "drop the first token, keep tokens ≥5 characters" (project_references)
 * or "≥4 characters" (project_switch). The guess encoded an assumption that the
 * first word is the builder brand and that distinguishing words are long. Both
 * fail on the real catalog:
 *
 *   Viva Greens        → `viva` is 4 chars, deleted → judged on `greens` alone
 *   Krishnaja Greens   → also judged on `greens`
 *   → the word "greens" in "I want green spaces" named BOTH projects
 *
 *   ten rows start with Brigade → `brigade` was evidence for all ten
 *
 * The catalog already knows the answer. A token picks out a project when no
 * OTHER project could have been meant by it — so ask the catalog, never the
 * shape of the string.
 *
 * ## Ambiguity vs specificity
 *
 * Two different situations produce a shared token, and only one of them is a
 * problem:
 *
 *   `greens`      Krishnaja Greens {krishnaja, greens} · Viva Greens {viva, greens}
 *                 Neither name's tokens contain the other's. Saying "greens"
 *                 genuinely does not choose. → AMBIGUOUS, not name-bearing.
 *
 *   `cornerstone` Brigade Cornerstone {brigade, cornerstone}
 *                 Brigade Cornerstone Utopia {brigade, cornerstone, utopia}
 *                 One name's tokens are a strict subset of the other's. Saying
 *                 "cornerstone" DOES pick out the shorter name, and the existing
 *                 superset rule resolves it. → still name-bearing.
 *
 * So: a token is ambiguous iff two names carrying it are unordered by ⊆ on their
 * token sets. Otherwise it bears the name. This keeps every project addressable
 * (a name whose tokens are all shared with unrelated projects would otherwise
 * become unreachable) while refusing to let a shared word choose for the buyer.
 *
 * Nothing here is catalog-specific: no place names, no brand list, no length
 * threshold doing semantic work. Hand it a different tenant and it re-derives.
 */

/** Below this, tokens are glue ("of", "the", "my") rather than names. */
const MIN_TOKEN = 3;

export function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN);
}

export interface NameIndex {
  /**
   * The tokens of `name` that actually pick it out. Empty when every token is
   * ambiguous — an honest "you cannot name this project by a single word".
   */
  bearing(name: string): string[];
  /** Every token of `name`, ambiguous or not. */
  all(name: string): string[];
  /** True when this token could have meant a different, unrelated project. */
  isAmbiguous(token: string): boolean;
}

function isSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/**
 * Build the index over the set of names a decision is judged against — the
 * builder's catalog wherever it is available, otherwise whatever names are in
 * the call. A wider set can only make the index MORE careful, never less.
 */
export function buildNameIndex(names: readonly string[]): NameIndex {
  const tokenSets = new Map<string, Set<string>>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key || tokenSets.has(key)) continue;
    tokenSets.set(key, new Set(tokenizeName(name)));
  }

  const carriers = new Map<string, Set<string>[]>();
  for (const set of tokenSets.values()) {
    for (const token of set) {
      const list = carriers.get(token) ?? [];
      list.push(set);
      carriers.set(token, list);
    }
  }

  const ambiguous = new Set<string>();
  for (const [token, sets] of carriers) {
    for (let i = 0; i < sets.length && !ambiguous.has(token); i++) {
      for (let j = i + 1; j < sets.length; j++) {
        // Unordered by ⊆ → this token cannot choose between them.
        if (!isSubset(sets[i]!, sets[j]!) && !isSubset(sets[j]!, sets[i]!)) {
          ambiguous.add(token);
          break;
        }
      }
    }
  }

  const all = (name: string) => tokenizeName(name);
  return {
    all,
    isAmbiguous: (token) => ambiguous.has(token),
    bearing: (name) => all(name).filter((t) => !ambiguous.has(t)),
  };
}

/**
 * The tokens that name `name`, judged against `siblings` — with the two guards
 * every caller needs.
 *
 * **No knowledge → no derivation.** Judged against fewer than two distinct
 * names there is nothing to compute: which word is the builder brand and which
 * is the project is unknowable from one string. Fall back to the historical
 * guess (the leading token is the brand) rather than invent certainty. Callers
 * that can reach the catalog should pass it and get the real answer.
 *
 * **A project is never unnameable.** When every token is ambiguous the name
 * would resolve to nothing and the buyer could not reach it by any word at all
 * — strictly worse than the over-matching this module exists to fix. Real case
 * from the fixtures: `Brigade Cornerstone` shares `brigade` with nine rows and
 * `cornerstone` with `Cornerstone Utopia`, which is not its superset. Keep the
 * full token set and let the caller's full-vs-partial and specificity rules
 * choose, which is what they are for.
 */
export function bearingTokensOf(
  name: string,
  siblings: ReadonlyArray<{ name: string }>,
): string[] {
  const names = siblings.map((s) => s.name);
  const distinct = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const all = tokenizeName(name);
  if (distinct.size < 2) return all.length > 1 ? all.slice(1) : all;
  const bearing = buildNameIndex(names).bearing(name);
  return bearing.length ? bearing : all;
}
