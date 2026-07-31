/**
 * Phase 2 — discourse state tokens (LLD §5).
 * Gate proof case (ask_next_step across 4 states) lands once corpus is rebuilt;
 * this file locks the token contract so query/corpus cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { buildRoutingQuery } from '../src/engine/turn-routing/build-query.js';
import {
  discourseStateToken,
  withDiscourseStatePrefix,
} from '../src/engine/turn-routing/state-tokens.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';

function base(over: Partial<TurnRoutingInput> = {}): TurnRoutingInput {
  return {
    text: 'what next?',
    builder_id: 'lokations',
    phase: 'discover',
    named_project_ids: [],
    board_count: 0,
    ...over,
  };
}

describe('discourseStateToken', () => {
  it('cold — empty board, no focus', () => {
    expect(discourseStateToken({ phase: 'discover', boardCount: 0 })).toBe('<cold>');
  });

  it('board — shortlist without focus', () => {
    expect(discourseStateToken({ phase: 'discover', boardCount: 3 })).toBe('<board:3>');
  });

  it('focused outranks board', () => {
    expect(
      discourseStateToken({
        phase: 'focused',
        focus: { project_id: 'ayana' },
        boardCount: 2,
      }),
    ).toBe('<focused>');
  });

  it('visit_pending outranks focused', () => {
    expect(
      discourseStateToken({
        phase: 'visit',
        focus: { project_id: 'ayana' },
        visit: { awaiting_confirm: true },
        boardCount: 2,
      }),
    ).toBe('<visit_pending>');
  });

  it('caps board count at 9', () => {
    expect(discourseStateToken({ phase: 'discover', boardCount: 12 })).toBe('<board:9>');
  });
});

describe('buildRoutingQuery + SIL_STATE_TOKENS', () => {
  it('raw by default (no behaviour change)', () => {
    expect(buildRoutingQuery(base({ text: 'what should I do next?' }))).toBe(
      'what should I do next?',
    );
    expect(buildRoutingQuery(base({ text: 'what should I do next?' }), {})).toBe(
      'what should I do next?',
    );
  });

  it('prefixes state token when flag on — four ask_next_step shapes', () => {
    const env = { SIL_STATE_TOKENS: 'true' } as const;
    const cases: Array<{ label: string; input: TurnRoutingInput; token: string }> = [
      { label: 'cold', input: base({ text: 'what next?', board_count: 0 }), token: '<cold>' },
      {
        label: 'board',
        input: base({ text: 'what next?', board_count: 2 }),
        token: '<board:2>',
      },
      {
        label: 'focused',
        input: base({
          text: 'what next?',
          phase: 'focused',
          focus: { project_id: 'ayana', project_name: 'Ayana' },
          board_count: 2,
        }),
        token: '<focused>',
      },
      {
        label: 'visit',
        input: base({
          text: 'what next?',
          phase: 'visit',
          visit: {
            queued_count: 0,
            awaiting_confirm: true,
            booked_count: 0,
          },
        }),
        token: '<visit_pending>',
      },
    ];
    for (const c of cases) {
      expect(buildRoutingQuery(c.input, env), c.label).toBe(`${c.token} what next?`);
    }
  });

  it('withDiscourseStatePrefix is the shared corpus/query join', () => {
    expect(withDiscourseStatePrefix('show me both', '<board:2>')).toBe('<board:2> show me both');
  });
});
