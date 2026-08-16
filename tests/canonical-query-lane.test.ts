/**
 * The corpus and the query must produce the SAME text for the same phrasing.
 *
 * `SIL_CANONICAL_EMBED` was described everywhere as flipping "corpus and query
 * together". It did not. Two lanes query INTENT_VECTORS:
 *
 *   adapters/semantic-nlu.ts   canonicalizes  — topic gap-fill, only when the
 *                                               regex topics came back empty
 *   turn-routing/build-query.ts  did NOT      — the routing bind, i.e. the
 *                                               `bind_source: embed_intent`
 *                                               authority that reaches goal
 *                                               selection
 *
 * So the flag would have entity-masked 19,404 corpus rows and left the primary
 * lane asking in raw words. Cosine does not fail on a space mismatch; it
 * returns plausible numbers over unrelated geometry, which is why this needs a
 * test rather than a code review.
 *
 * The assertion is deliberately an EQUALITY between the two implementations
 * rather than a restatement of either. A test that only checked "the query
 * contains <project>" would still pass if the corpus later changed its masking
 * or its ordering, and the two would drift apart green.
 */
import { describe, expect, it } from 'vitest';
import { buildRoutingQuery } from '../src/engine/turn-routing/build-query.js';
import { embedTextForRow, type RegistryRow } from '../src/rebuild/intent-index.js';
import { canonicalize } from '../src/nlu/canonicalize.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';

const input = (text: string): TurnRoutingInput => ({
  text,
  builder_id: 'lokations',
  phase: 'discover',
  named_project_ids: [],
  board_count: 0,
});

const row = (phrasing: string, discourse_state?: string): RegistryRow => ({
  id: 'r1',
  phrasing,
  intent_kind: 'get_price',
  ...(discourse_state ? { discourse_state } : {}),
});

const PHRASINGS = [
  'what is the price of Brigade Eldorado in Whitefield',
  'tell me about Brigade Eldorado',
  'how far is Ayana from Whitefield',
  'ameneties?', // a taught row with nothing to mask — must still agree
  'what are the maintenance charges?',
];

describe('canonical cutover — corpus and query land in one space', () => {
  it('query text equals corpus text, phrasing for phrasing', () => {
    for (const p of PHRASINGS) {
      expect(buildRoutingQuery(input(p), {}, canonicalize), p).toBe(
        embedTextForRow(row(p), canonicalize, true),
      );
    }
  });

  it('and equals it in legacy mode too, with no canonicalizer on either side', () => {
    // The rollback path has to be in one space as well.
    for (const p of PHRASINGS) {
      expect(buildRoutingQuery(input(p), {}), p).toBe(
        embedTextForRow(row(p), canonicalize, false),
      );
    }
  });

  it('actually masks — otherwise both sides could agree on doing nothing', () => {
    // Guards the guard. If the vocab stops masking, the equality above holds
    // vacuously and this file would report parity over a no-op.
    const q = buildRoutingQuery(input(PHRASINGS[0]!), {}, canonicalize);
    expect(q).not.toBe(PHRASINGS[0]);
    expect(q).toContain('<project>');
  });

  it('masks before prefixing, so a state token is never eaten as an entity', () => {
    // The corpus does canonicalize() then withDiscourseStatePrefix(); the query
    // must not do it the other way round or the token itself gets masked.
    const withState = { SIL_STATE_TOKENS: 'true' } as const;
    const q = buildRoutingQuery(
      { ...input('what should I do next?'), phase: 'discover' },
      withState,
      canonicalize,
    );
    expect(q.startsWith('<')).toBe(true);
    expect(q).toContain('what should i do next');
  });
});
