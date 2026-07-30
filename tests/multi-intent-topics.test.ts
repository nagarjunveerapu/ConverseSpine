import { describe, expect, it } from 'vitest';
import { fallbackReply } from '../src/engine/compose.js';
import { detectTopics, splitComposeTopics, unionAskTopics } from '../src/engine/facts.js';
import { decide as focusedDecide } from '../src/engine/phases/focused.js';
import { commitTo, initState } from '../src/engine/state.js';
import {
  attachAnswerTopics,
  mergeRoutingTopicsIntoExtract,
} from '../src/engine/turn-routing/answer-topics.js';
import type { TurnRoutingInput, TurnRoutingResult } from '../src/engine/turn-routing/types.js';
import type { Extracted } from '../src/engine/types.js';
import { withAnswerRequirements } from '../src/engine/answer-contract.js';
import { excludeParkedFaqKeys } from '../src/engine/faq-keys.js';

describe('unionAskTopics / splitComposeTopics', () => {
  it('unions and orders by TOPIC_ORDER, caps at 3', () => {
    expect(unionAskTopics(['legal'], ['price', 'emi'], ['media', 'amenities'])).toEqual([
      'price',
      'legal',
      'emi',
    ]);
  });

  it('splits compose active as the full capped set (answer all intents)', () => {
    expect(splitComposeTopics(['price', 'legal', 'location'])).toEqual({
      active: ['price', 'legal', 'location'],
      parked: [],
    });
  });
});

describe('Phase B — answer_topics on routing', () => {
  const input: TurnRoutingInput = {
    text: 'price and is it RERA approved',
    builder_id: 'naya-advisor',
    phase: 'focused',
    ask_topic: 'price',
    ask_topics: ['price', 'legal'],
    named_project_ids: [],
  };

  it('attachAnswerTopics preserves the full set on answer_on_project', () => {
    const raw: TurnRoutingResult = {
      routing: 'answer_on_project',
      confidence: 'rule',
      answer_topic: 'price',
    };
    const attached = attachAnswerTopics(raw, input);
    expect(attached.answer_topic).toBe('price');
    expect(attached.answer_topics).toEqual(['price', 'legal']);
  });

  it('mergeRoutingTopicsIntoExtract grows askTopics from routing', () => {
    const ex: Extracted = { constraints: {}, askTopic: 'price', askTopics: ['price'] };
    const routing: TurnRoutingResult = {
      routing: 'answer_on_project',
      confidence: 'embedder',
      answer_topic: 'legal',
      answer_topics: ['legal'],
    };
    const merged = mergeRoutingTopicsIntoExtract(ex, routing);
    expect(merged.askTopics).toEqual(['price', 'legal']);
    expect(merged.askTopic).toBe('price');
  });

  it('keeps extract primary when embedder topic would leapfrog TOPIC_ORDER', () => {
    const ex: Extracted = { constraints: {}, askTopic: 'location', askTopics: ['location'] };
    const routing: TurnRoutingResult = {
      routing: 'answer_on_project',
      confidence: 'embedder',
      answer_topic: 'price',
      answer_topics: ['price'],
    };
    const merged = mergeRoutingTopicsIntoExtract(ex, routing);
    expect(merged.askTopic).toBe('location');
    expect(merged.askTopics?.[0]).toBe('location');
    expect(merged.askTopics).toContain('price');
  });

  it('does not merge embedder facets into overview extract', () => {
    const ex: Extracted = { constraints: {}, askTopic: 'overview', askTopics: ['overview'] };
    const routing: TurnRoutingResult = {
      routing: 'answer_on_project',
      confidence: 'embedder',
      answer_topic: 'price',
      answer_topics: ['price'],
    };
    const merged = mergeRoutingTopicsIntoExtract(ex, routing);
    expect(merged.askTopics).toEqual(['overview']);
    expect(merged.askTopic).toBe('overview');
  });

  it('focused decide keeps location primary when price is also in the set', () => {
    let s = initState('naya-advisor', 't-loc-primary');
    s = commitTo(s, 'oasis', 'Brigade Oasis');
    const goal = focusedDecide(
      s,
      {
        constraints: {},
        askTopics: ['location', 'price'],
        askTopic: 'location',
      },
      'ಸ್ಥಳ ಎಲ್ಲಿದೆ??',
    );
    expect(goal.kind).toBe('answer');
    if (goal.kind !== 'answer') return;
    expect(goal.topic).toBe('location');
    expect(goal.topics?.[0]).toBe('location');
  });
});

describe('Phase C — answer all capped topics', () => {
  it('focused decide keeps all three topics active (no park drop)', () => {
    let s = initState('naya-advisor', 't-park');
    s = commitTo(s, 'oasis', 'Brigade Oasis');
    const goal = focusedDecide(
      s,
      {
        constraints: {},
        askTopics: ['price', 'legal', 'location'],
        askTopic: 'price',
      },
      'price, RERA, and schools nearby?',
    );
    expect(goal.kind).toBe('answer');
    if (goal.kind !== 'answer') return;
    expect(goal.topics).toEqual(['price', 'legal', 'location']);
    expect(goal.parkedTopics).toBeUndefined();
  });

  it('lone possession does not become availability (B5.1 FAQ/overview path)', () => {
    expect(detectTopics('when is possession?')).toEqual([]);
    expect(detectTopics('possession date?')).toEqual([]);
  });

  it('possession joins availability so price+RERA+possession all stay active', () => {
    let s = initState('naya-advisor', 't-park-poss');
    s = commitTo(s, 'oasis', 'Brigade Oasis');
    expect(detectTopics('price, possession date, and is it RERA approved?')).toEqual([
      'price',
      'legal',
      'availability',
    ]);
    const goal = focusedDecide(
      s,
      {
        constraints: {},
        askTopics: ['price', 'legal', 'availability'],
        askTopic: 'price',
      },
      'price, possession date, and is it RERA approved?',
    );
    expect(goal.kind).toBe('answer');
    if (goal.kind !== 'answer') return;
    expect(goal.topics).toEqual(['price', 'legal', 'availability']);
    expect(goal.parkedTopics).toBeUndefined();

    const withReq = withAnswerRequirements(goal, 'price, possession date, and is it RERA approved?');
    expect(withReq.requires ?? []).toEqual(expect.arrayContaining(['price', 'rera', 'possession']));
    expect(excludeParkedFaqKeys(['possession', 'rera_status'], [])).toEqual([
      'possession',
      'rera_status',
    ]);
  });

  it('compose still supports an explicit parkedTopics continuation when set', () => {
    const reply = fallbackReply({
      goal: {
        kind: 'answer',
        topic: 'price',
        projectId: 'oasis',
        topics: ['price', 'legal'],
        parkedTopics: ['location'],
      },
      evidence: {
        tools: ['pricing', 'detail'],
        pricing: {
          projectName: 'Brigade Oasis',
          components: [{ label: 'Base Selling Price', value: '₹9,000/sqft' }],
        },
        detail: {
          projectId: 'oasis',
          name: 'Brigade Oasis',
          reraNumber: 'PRM/KA/RERA/1250/303/PR/041122/005401',
          faqs: [],
        },
      },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Naya',
        buyerText: 'price and RERA and location',
        focusProjectName: 'Brigade Oasis',
      },
    });
    expect(reply).toMatch(/location next|cover location/i);
  });
  it('compose includes media chunk when price is primary in a multi-topic set', () => {
    const reply = fallbackReply({
      goal: {
        kind: 'answer',
        topic: 'price',
        projectId: 'oasis',
        topics: ['price', 'media'],
      },
      evidence: {
        tools: ['pricing', 'mediaShare'],
        pricing: {
          projectName: 'Brigade Oasis',
          components: [{ label: 'Base Selling Price', value: '₹9,000/sqft' }],
        },
        media: {
          projectName: 'Brigade Oasis',
          allowed: true,
          assetKind: 'brochure',
          title: 'brochure',
          cdnUrl: 'https://cdn.example/brochure.pdf',
        },
      },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Naya',
        buyerText: 'send the brochure and what is the starting price?',
        focusProjectName: 'Brigade Oasis',
      },
    });
    expect(reply).toMatch(/₹9,000|Pricing/i);
    expect(reply).toMatch(/brochure/i);
    expect(reply).toContain('https://cdn.example/brochure.pdf');
  });
});
