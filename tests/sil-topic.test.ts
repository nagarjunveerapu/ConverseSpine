import { describe, expect, it } from 'vitest';
import {
  SIL_TOPIC_TAU,
  UNANSWERABLE_INTENT_KINDS,
  silTopic,
} from '../src/engine/sil-topic.js';
import type { TurnRoutingResult } from '../src/engine/turn-routing/types.js';

/**
 * The SIL wire. Before this, the 14k-row intent corpus was observability only:
 * `intent_kind` reached the intent-review telemetry and nothing else, so goal
 * selection ran purely off the deterministic + LLM extraction and a confident
 * embedding bind changed nothing about the turn.
 */
function routing(over: Partial<NonNullable<TurnRoutingResult['bind']>> = {}): TurnRoutingResult {
  return {
    bind: { bind_source: 'embed_intent', top_kind: 'get_price', top_score: 0.9, ...over },
  } as TurnRoutingResult;
}

describe('silTopic', () => {
  it('binds a confident embedding verdict to an answerable topic', () => {
    expect(silTopic(routing())).toBe('price');
    expect(silTopic(routing({ top_kind: 'get_legal_info' }))).toBe('legal');
    expect(silTopic(routing({ top_kind: 'compare_projects' }))).toBe('compare');
    expect(silTopic(routing({ top_kind: 'get_brochure' }))).toBe('media');
  });

  it('stays silent below τ — that is the clarify/probe lane, not a guess', () => {
    expect(silTopic(routing({ top_score: SIL_TOPIC_TAU - 0.01 }))).toBeUndefined();
    expect(silTopic(routing({ top_score: 0 }))).toBeUndefined();
  });

  it('ignores a regex-sourced bind — this wire is the embedding lane only', () => {
    expect(silTopic(routing({ bind_source: 'regex' }))).toBeUndefined();
    expect(silTopic(routing({ bind_source: 'none' }))).toBeUndefined();
  });

  it('stays silent for intents the engine has NO answer path for', () => {
    // Forcing these into the nearest topic would answer a different question
    // than the buyer asked — the "on-topic is not answered" defect. They must
    // fall through to the honest below-threshold path instead.
    for (const kind of UNANSWERABLE_INTENT_KINDS) {
      expect(silTopic(routing({ top_kind: kind }))).toBeUndefined();
    }
  });

  it('stays silent on an unknown kind or a missing bind', () => {
    expect(silTopic(routing({ top_kind: 'not_a_real_kind' }))).toBeUndefined();
    expect(silTopic(undefined)).toBeUndefined();
    expect(silTopic({} as TurnRoutingResult)).toBeUndefined();
  });
});
