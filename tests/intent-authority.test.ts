import { describe, expect, it } from 'vitest';
import {
  INTENT_EFFECTS,
  applyIntentAuthority,
  isUnclaimedIntent,
} from '../src/engine/turn-routing/intent-authority.js';
import { INTENT_TO_TOPIC_KEYS } from '../src/engine/turn-routing/embedder-map.js';
import type { Extracted } from '../src/engine/types.js';
import type { TurnRoutingResult } from '../src/engine/turn-routing/types.js';

const EX: Extracted = { constraints: {} };

function routing(over: Partial<TurnRoutingResult['bind']> = {}): TurnRoutingResult {
  return {
    routing: 'defer',
    confidence: 'abstain',
    bind: { bind_source: 'none', embed_fired: true, ...over },
  } as TurnRoutingResult;
}

describe('one authority per intent — the table cannot overlap', () => {
  it('claims no kind that already has a topic owner', () => {
    // THE invariant. If a kind is in INTENT_TO_TOPIC it is extraction's to
    // resolve; claiming it here would be the second authority this design
    // exists to prevent.
    const doubled = Object.keys(INTENT_EFFECTS).filter((k) => INTENT_TO_TOPIC_KEYS.includes(k));
    expect(doubled, `owned twice — by INTENT_TO_TOPIC and by INTENT_EFFECTS: ${doubled.join(', ')}`)
      .toEqual([]);
  });

  it('only fires when the embedder was confident AND nothing claimed the kind', () => {
    expect(isUnclaimedIntent(routing({ miss_reason: 'unmapped_kind', top_kind: 'opt_out' }))).toBe(true);
    // below tau — the embedder was not confident
    expect(isUnclaimedIntent(routing({ miss_reason: 'below_tau', top_kind: 'opt_out' }))).toBe(false);
    // a kind that DID map: someone else owns it
    expect(isUnclaimedIntent(routing({ top_kind: 'get_price' }))).toBe(false);
    expect(isUnclaimedIntent(undefined)).toBe(false);
  });
});

describe('applyIntentAuthority', () => {
  const unclaimed = (kind: string) => routing({ miss_reason: 'unmapped_kind', top_kind: kind });

  it('is a no-op by default, returning the very same object', () => {
    const r = applyIntentAuthority(EX, undefined);
    expect(r.ex).toBe(EX);
    expect(r.wrote).toEqual([]);
  });

  it('routes an opt-out into the EXISTING stop path rather than a new one', () => {
    const r = applyIntentAuthority(EX, unclaimed('opt_out'));
    expect(r.ex.stop).toBe(true);
    expect(r.wrote).toEqual(['stop']);
    // Critically NOT a delete: ex.stop only reaches the destructive branch via
    // the standalone-keyword regex or an explicit "yes". The embedding can ask
    // for confirmation; it can never trigger the deletion itself.
  });

  it('marks escalation, callbacks and complaints as wanting a person', () => {
    for (const kind of ['escalate_to_human', 'escalate', 'report_issue', 'callback', 'request_callback']) {
      const r = applyIntentAuthority(EX, unclaimed(kind));
      expect(r.ex.wantsHuman, kind).toBe(true);
      expect(r.ex.stop, kind).toBeUndefined();
    }
  });

  it('never overwrites a slot extraction already filled', () => {
    const already: Extracted = { constraints: {}, stop: true };
    const r = applyIntentAuthority(already, unclaimed('opt_out'));
    expect(r.wrote).toEqual([]);
    expect(r.ex).toBe(already);
  });

  it('ignores kinds it does not own', () => {
    expect(applyIntentAuthority(EX, unclaimed('get_amenities')).wrote).toEqual([]);
    expect(applyIntentAuthority(EX, unclaimed('find_projects')).wrote).toEqual([]);
  });
});
