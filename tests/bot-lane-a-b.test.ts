import { describe, expect, it } from 'vitest';
import { extractFactsSync, isFirstHomeHelpText } from '../src/engine/facts.js';
import { decide as discoverDecide, hasRoutableTurnZeroAsk } from '../src/engine/phases/discover.js';
import { shouldDeclinePolicyForFocusedFacet } from '../src/engine/turn-routing/embedder-map.js';
import { initState } from '../src/engine/state.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';

describe('Bot lane A1 — first-home help', () => {
  it('detects the open first-home help phrase', () => {
    const text =
      'Hi, I am looking to buy my first home but I am not sure where to start, can you help?';
    expect(isFirstHomeHelpText(text)).toBe(true);
    const ex = extractFactsSync(text, initState('t', 'naya-advisor'));
    expect(ex.firstHomeHelp).toBe(true);
    const goal = discoverDecide(initState('t', 'naya-advisor'), ex);
    expect(goal.kind).not.toBe('clarify_intent');
    expect(['orient', 'probe', 'recommend']).toContain(goal.kind);
  });

  it('does not surface unknown-intent clarify when firstHomeHelp is stamped', async () => {
    const { shouldSurfaceUnknownIntent } = await import(
      '../src/engine/turn-routing/intent-authority.js'
    );
    const text =
      'Hi, I am looking to buy my first home but I am not sure where to start, can you help?';
    const ex = extractFactsSync(text, initState('t', 'naya-advisor'));
    expect(
      shouldSurfaceUnknownIntent(
        ex,
        {
          routing: 'defer',
          confidence: 'abstain',
          bind: { embed_fired: true, miss_reason: 'below_tau', bind_source: 'embed_intent' },
        } as never,
        false,
        text,
      ),
    ).toBe(false);
  });
});

describe('Bot lane A3b — turn-0 greet gate', () => {
  it('does not treat a price ask as greet-only', () => {
    const s = initState('t', 'naya-advisor');
    const ex = extractFactsSync("What's the price?", s);
    expect(hasRoutableTurnZeroAsk(ex, s)).toBe(true);
    const goal = discoverDecide({ ...s, turnCount: 0 }, ex);
    expect(goal.kind).not.toBe('greet');
  });

  it('still greets bare hi on turn 0', () => {
    const s = initState('t', 'naya-advisor');
    const ex = extractFactsSync('hi', s);
    expect(hasRoutableTurnZeroAsk(ex, s)).toBe(false);
    expect(discoverDecide({ ...s, turnCount: 0 }, ex).kind).toBe('greet');
  });
});

describe('Bot lane A3a — named + facet declines definition', () => {
  it('declines definition when cold named project + price facet', () => {
    const input: TurnRoutingInput = {
      text: "Tell me about Brigade Eldorado - what's the price and possession date?",
      builder_id: 'naya-advisor',
      phase: 'discover',
      ask_topics: ['price', 'possession'],
      named_project_ids: ['brigade-eldorado-naya-advisor'],
    };
    expect(shouldDeclinePolicyForFocusedFacet(input)).toBe(true);
  });

  it('declines definition for payment plan mid-visit with focus pin', () => {
    const input: TurnRoutingInput = {
      text: 'what is the payment plan?',
      builder_id: 'brigade-group',
      phase: 'visit',
      focus: { project_id: 'brigade-eldorado', project_name: 'Brigade Eldorado' },
      visit: {
        queued_count: 0,
        awaiting_confirm: false,
        booked_count: 0,
      },
      named_project_ids: [],
    };
    expect(shouldDeclinePolicyForFocusedFacet(input)).toBe(true);
  });

  it('keeps cold literacy definition when no project pin', () => {
    const input: TurnRoutingInput = {
      text: 'what is a payment plan?',
      builder_id: 'brigade-group',
      phase: 'discover',
      named_project_ids: [],
    };
    // Catalog cue present but no pin — must not steal bare literacy.
    expect(shouldDeclinePolicyForFocusedFacet(input)).toBe(false);
  });
});

describe('Bot lane B2 — managed farmland + Coorg', () => {
  it('extracts plantation type and Coorg location from Hinglish brief', () => {
    const text =
      'Managed farmland mein invest karna hai. Coorg area preferred, budget 50-70L';
    const ex = extractFactsSync(text, initState('t', 'naya-advisor'));
    expect(ex.constraints.propertyType).toMatch(/plantation/i);
    expect(ex.constraints.location?.toLowerCase()).toContain('coorg');
    expect(ex.constraints.location?.toLowerCase()).not.toMatch(/farmland|managed/);
    expect(ex.constraints.budgetMaxInr).toBeGreaterThan(0);
  });
});

describe('Wave 3 — B5.1 when ready + ROI/loan compose', () => {
  it('maps when ready to possession FactKey, not availability-only', async () => {
    const { answerRequirements } = await import('../src/engine/answer-contract.js');
    const { detectTopics } = await import('../src/engine/facts.js');
    expect(answerRequirements('nearby schools and when ready?')).toContain('possession');
    expect(detectTopics('when ready?')).not.toContain('availability');
  });

  it('keeps overview when returns co-asked with loan', async () => {
    const { withAnswerRequirements } = await import('../src/engine/answer-contract.js');
    const next = withAnswerRequirements(
      { kind: 'answer', topic: 'legal', projectId: 'p1', topics: ['legal', 'price'] },
      'returns? also loan eligibility? and per sqft',
    );
    expect(next.requires).toEqual(expect.arrayContaining(['rental_yield', 'loan_eligibility']));
    expect(next.topics).toEqual(expect.arrayContaining(['overview', 'legal']));
  });

  it('maps cost-here with returns to price + rental_yield', async () => {
    const { answerRequirements, withAnswerRequirements } = await import(
      '../src/engine/answer-contract.js'
    );
    const text = 'tell me about returns, also whats the cost here';
    expect(answerRequirements(text)).toEqual(
      expect.arrayContaining(['rental_yield', 'price']),
    );
    const next = withAnswerRequirements(
      { kind: 'answer', topic: 'overview', projectId: 'p1', topics: ['overview'] },
      text,
    );
    expect(next.topics).toEqual(expect.arrayContaining(['overview', 'price']));
  });

  it('keeps media topic when photos co-asked with loan', async () => {
    const { withAnswerRequirements } = await import('../src/engine/answer-contract.js');
    const next = withAnswerRequirements(
      { kind: 'answer', topic: 'media', projectId: 'p1', topics: ['media'] },
      'loan eligibility? also send photos',
    );
    expect(next.requires).toContain('loan_eligibility');
    expect(next.topics).toEqual(expect.arrayContaining(['legal', 'media']));
  });

  it('possession miss stays partial when location sibling evidence exists', async () => {
    const { enforceAnswerContract } = await import('../src/engine/answer-contract.js');
    const out = enforceAnswerContract(
      {
        kind: 'answer',
        topic: 'location',
        projectId: 'p1',
        topics: ['location'],
        requires: ['possession'],
      },
      {
        tools: [],
        location: {
          projectName: 'Eldorado',
          microMarket: 'Devanahalli',
          schools: [{ name: 'ABC School', distanceKm: 2 }],
        },
      },
    );
    expect(out.failure).toBeUndefined();
    expect(out.notices?.map((n) => n.subject)).toContain('possession');
    expect(out.location?.schools?.length).toBe(1);
  });
});
