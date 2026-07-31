/**
 * Phase 2 — discourse state tokens + ask_next_step consumer (LLD §5).
 *
 * Gate: ask_next_step resolves correctly across cold / board / focused /
 * visit_pending. Corpus expand must stay in lockstep with buildRoutingQuery.
 */
import { describe, expect, it } from 'vitest';
import {
  isAskNextStepText,
  resolveAskNextStepGoal,
  shouldConsumeAskNextStep,
} from '../src/engine/ask-next-step.js';
import { mapIntentToRouting } from '../src/engine/turn-routing/embedder-map.js';
import { buildRoutingQuery } from '../src/engine/turn-routing/build-query.js';
import {
  discourseStateToken,
  expandRowForStateTokens,
  withDiscourseStatePrefix,
} from '../src/engine/turn-routing/state-tokens.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';
import { commitTo, initState, recordOffered } from '../src/engine/state.js';
import type { ConversationState, Extracted, Match } from '../src/engine/types.js';
import { embedTextForRow, planRebuild, type RegistryRow } from '../src/rebuild/intent-index.js';

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

const emptyEx = {} as Extracted;

const m = (id: string, name: string): Match =>
  ({
    projectId: id,
    name,
    microMarket: 'Sakleshpur',
    priceDisplay: '₹50L',
  }) as Match;

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

  it('does NOT prefix fact intents (partial corpus expand must not skew)', () => {
    const env = { SIL_STATE_TOKENS: 'true' } as const;
    expect(
      buildRoutingQuery(
        base({
          text: 'what is the price?',
          phase: 'focused',
          focus: { project_id: 'ayana', project_name: 'Ayana' },
        }),
        env,
      ),
    ).toBe('what is the price?');
  });

  it('withDiscourseStatePrefix is the shared corpus/query join', () => {
    expect(withDiscourseStatePrefix('show me both', '<board:2>')).toBe('<board:2> show me both');
  });
});

describe('Phase 2b — corpus expand under stateTokens', () => {
  it('expandRowForStateTokens multiplies ask_next_step into 4 prefixed ids', () => {
    const xs = expandRowForStateTokens({
      id: 'ph_ans',
      phrasing: 'what should we do next',
      intent_kind: 'ask_next_step',
    });
    expect(xs.map((r) => r.id)).toEqual([
      'ph_ans:st:cold',
      'ph_ans:st:board_2',
      'ph_ans:st:focused',
      'ph_ans:st:visit_pending',
    ]);
    expect(xs[0]!.discourse_state).toBe('<cold>');
  });

  it('planRebuild stateTokens replaces ask_next_step with prefixed siblings', () => {
    const rows: RegistryRow[] = [
      {
        id: 'a',
        phrasing: 'what next',
        intent_kind: 'ask_next_step',
        audit_status: 'clean',
        quarantine: false,
        eval_split: 'train',
      },
      {
        id: 'b',
        phrasing: 'price please',
        intent_kind: 'get_price',
        audit_status: 'clean',
        quarantine: false,
        eval_split: 'train',
      },
    ];
    const { eligible } = planRebuild(rows, {}, { stateTokens: true });
    expect(eligible.filter((r) => r.intent_kind === 'get_price')).toHaveLength(1);
    const next = eligible.filter((r) => r.intent_kind === 'ask_next_step');
    expect(next).toHaveLength(4);
    expect(next.every((r) => r.discourse_state)).toBe(true);
    expect(embedTextForRow(next[0]!, (t) => t, false)).toBe('<cold> what next');
  });
});

describe('Phase 2c — ask_next_step consumer (four states)', () => {
  it('detects process-next phrasing and ignores facet asks', () => {
    expect(isAskNextStepText('what should I do next?')).toBe(true);
    expect(isAskNextStepText("what's the next step")).toBe(true);
    expect(isAskNextStepText('aage kya karna hai')).toBe(true);
    expect(isAskNextStepText('what is the next payment')).toBe(false);
    expect(isAskNextStepText('what is the price')).toBe(false);
  });

  it('mapIntentToRouting binds ask_next_step (not unmapped)', () => {
    const r = mapIntentToRouting('ask_next_step', 0.9, base());
    expect(r?.routing).toBe('ask_next_step');
    expect(r?.embedder_intent_kind).toBe('ask_next_step');
  });

  it('cold → orient / probe', () => {
    let s = initState('p2', 'lokations');
    expect(resolveAskNextStepGoal(s).kind).toBe('orient');
    s = { ...s, discover: { ...s.discover, oriented: true } };
    expect(resolveAskNextStepGoal(s)).toEqual({ kind: 'probe', slot: 'location' });
  });

  it('board (≥2) → clarify_project_pick', () => {
    let s = initState('p2', 'lokations');
    s = recordOffered(s, [m('ayana', 'Ayana'), m('krishnaja', 'Krishnaja Greens')]);
    expect(resolveAskNextStepGoal(s).kind).toBe('clarify_project_pick');
  });

  it('board (1) → commit open', () => {
    let s = initState('p2', 'lokations');
    s = recordOffered(s, [m('ayana', 'Ayana')]);
    const g = resolveAskNextStepGoal(s);
    expect(g).toMatchObject({
      kind: 'commit',
      projectId: 'ayana',
      projectName: 'Ayana',
      followUp: 'overview',
    });
  });

  it('focused → advance (visit/hold nudge)', () => {
    let s = initState('p2', 'lokations');
    s = recordOffered(s, [m('ayana', 'Ayana'), m('krishnaja', 'Krishnaja Greens')]);
    s = commitTo(s, 'ayana', 'Ayana');
    expect(s.phase).toBe('focused');
    expect(resolveAskNextStepGoal(s)).toEqual({ kind: 'advance', reason: 'same_set' });
  });

  it('visit_pending awaiting confirm → re-propose', () => {
    let s: ConversationState = initState('p2', 'lokations');
    s = commitTo(s, 'ayana', 'Ayana');
    s = {
      ...s,
      phase: 'visit',
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        awaitingConfirm: true,
        proposedIso: '2026-08-01T10:00:00+05:30',
        proposedLabel: 'Sat 1 Aug, 10:00 am',
      },
    };
    const g = resolveAskNextStepGoal(s);
    expect(g.kind).toBe('visit_propose');
    if (g.kind === 'visit_propose') {
      expect(g.projectId).toBe('ayana');
      expect(g.label).toContain('Sat');
    }
  });

  it('visit_pending without slot → propose_visit', () => {
    let s = commitTo(initState('p2', 'lokations'), 'ayana', 'Ayana');
    s = {
      ...s,
      phase: 'visit',
      visit: { projectId: 'ayana', projectName: 'Ayana' },
    };
    expect(resolveAskNextStepGoal(s)).toEqual({
      kind: 'propose_visit',
      projectId: 'ayana',
    });
  });

  it('shouldConsumeAskNextStep yields to catalog asks', () => {
    const s = initState('p2', 'lokations');
    expect(shouldConsumeAskNextStep(s, emptyEx, 'what should I do next?')).toBe(true);
    expect(
      shouldConsumeAskNextStep(s, { askTopic: 'price' } as Extracted, 'what should I do next?'),
    ).toBe(false);
  });
});
