/**
 * The definition class-balance boost must be a MARGIN, not a precedence.
 *
 * `classify.ts` sorts class before score:
 *
 *     if (aBalanced !== bBalanced) return aBalanced ? -1 : 1;
 *     return b.score - a.score || …            // score only breaks ties
 *
 * so any definition candidate at ≥0.8 outranks everything else regardless of
 * how much better the other candidate scored. The comment two lines above says
 * "score still wins". It does not.
 *
 * The trigger makes it bite constantly — `looksLikeDefinitionAsk` fires on a
 * bare "what's", so it is on for "what's the price", "what's the RERA number"
 * and "what's the possession date for Eldorado", i.e. the commonest phrasing of
 * a factual lookup. Measured live:
 *
 *   "what's the BSP and carpet area and possession date"
 *      → definition_ready_to_move @ 0.831 → a glossary answer, projectId ''
 *   "what's the price and is RERA done"
 *      → "I don't have a short explainer for that yet"
 *
 * Keeping definition rows in the CANDIDATE SET is right — they are outnumbered
 * by search/availability rows and would never be retrieved otherwise. Letting
 * them win a contest they lost on score is not.
 *
 * LANDED (state-condition, not margin): when `phase === 'focused'` + focus,
 * definition class-boost is off, and mapIntent declines definition /
 * negotiate_price on catalog-facet asks so the walk binds get_price /
 * get_amenities. Pins live in `tests/failure-routing.test.ts`. Margin-based
 * ranking remains skipped below — do not revive without measured distributions.
 */
import { describe, expect, it } from 'vitest';

/**
 * BLOCKED — specification only for the MARGIN approach, not yet implemented.
 *
 * A margin was tried at 0.03 and reverted: `failure-routing.test.ts:121` pins
 * "what is this bhk you people say" with definition_bhk @ 0.805 losing to
 * get_availability @ 0.874 — a 0.069 gap. That test is RIGHT; it is a genuine
 * literacy ask, and the boost exists precisely because definition rows are
 * outnumbered and therefore score lower even when they are correct.
 *
 * So the constant cannot be guessed. Picking it is a judgement about which
 * utterances are literacy asks, and the two known data points (0.069 must
 * pass, EXP-01's competing score unknown) do not determine it.
 *
 * Structural answer (shipped): STATE-CONDITION on focused + catalog facet —
 * see embedder-map `shouldDeclinePolicyForFocusedFacet` and classify
 * `definitionBoostOk` gating. This file stays skipped for the margin idea.
 *
 * Un-skip only when measured score distributions set a real margin.
 */
const m = (kind: string, score: number, facet = '') => ({ kind, score, facet });
void m;

describe.skip('a boosted definition candidate wins on margin, not on class', () => {
  const rankIntentMatches = (x: unknown[], _b: boolean) => x as { kind: string; facet?: string }[];
  it('does not beat a materially better-scoring candidate', () => {
    const ranked = rankIntentMatches(
      [m('get_price', 0.93), m('definition_ready_to_move', 0.81)],
      true,
    );
    expect(ranked[0]!.kind).toBe('get_price');
  });

  it('still wins when it is genuinely close — that is the point of the boost', () => {
    const ranked = rankIntentMatches(
      [m('get_availability', 0.845), m('definition_bhk', 0.84)],
      true,
    );
    expect(ranked[0]!.kind).toBe('definition_bhk');
  });

  it('is still retrieved and ranked when it is simply the best', () => {
    const ranked = rankIntentMatches(
      [m('definition_bhk', 0.91), m('get_availability', 0.72)],
      true,
    );
    expect(ranked[0]!.kind).toBe('definition_bhk');
  });

  it('never applies below the 0.8 floor', () => {
    const ranked = rankIntentMatches(
      [m('get_price', 0.79), m('definition_bhk', 0.78)],
      true,
    );
    expect(ranked[0]!.kind).toBe('get_price');
  });

  it('is inert on a non-literacy turn', () => {
    const ranked = rankIntentMatches(
      [m('find_projects', 0.88), m('definition_bhk', 0.87)],
      false,
    );
    expect(ranked[0]!.kind).toBe('find_projects');
  });

  it('keeps the taught-facet tie-break for equal scores', () => {
    const ranked = rankIntentMatches(
      [m('get_price', 0.9), m('get_price', 0.9, 'rental_yield')],
      false,
    );
    expect(ranked[0]!.facet).toBe('rental_yield');
  });
});
