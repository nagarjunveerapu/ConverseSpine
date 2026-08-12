import { describe, expect, it } from 'vitest';
import {
  applyPriceObjectionAuthority,
  hasPreferCheaperCue,
  hasPriceObjectionCue,
} from '../src/engine/price-objection.js';
import { needsIntentRecovery, applyIntentRecovery } from '../src/engine/intent-recovery.js';
import { hybridPreferTemplate, needsPaidLlmFloor } from '../src/engine/hybrid.js';
import { fallbackReply } from '../src/engine/compose.js';
import type { ComposeRequest, Extracted } from '../src/engine/types.js';

const emptyEx = (): Extracted => ({ constraints: {} });

describe('evaluative cost stance (generic)', () => {
  it('stance × cost-eval → objection across phrasings', () => {
    const objections = [
      'a bit expensive for me',
      'feels too costly',
      'quite pricey',
      'thoda mehengaa lag raha hai',
      'bahut mehnga hai',
      'on the higher side',
      'out of my budget',
      'budget tight',
    ];
    for (const u of objections) {
      expect(hasPriceObjectionCue(u), u).toBe(true);
    }
  });

  it('price information-asks stay non-objection', () => {
    const asks = [
      "what's the price",
      'how much does it cost',
      'price batao',
      'per sqft rate',
      'landed cost please',
      'any discount',
    ];
    for (const u of asks) {
      expect(hasPriceObjectionCue(u), u).toBe(false);
    }
  });

  it('prefer-cheaper is a separate stance', () => {
    expect(hasPreferCheaperCue('show me something cheaper')).toBe(true);
    expect(hasPreferCheaperCue("what's the price")).toBe(false);
  });

  it('authority clears price topics for stance (intent-before-slots)', () => {
    const next = applyPriceObjectionAuthority(
      { ...emptyEx(), askTopic: 'price', askTopics: ['price'], speechAct: 'unknown' },
      'feels too expensive',
    );
    expect(next.objection).toBe(true);
    expect(next.askTopics).toBeUndefined();
    expect(next.speechAct).toBe('object');
  });

  it('wrong-class price topic still needs recovery when stance present', () => {
    const ex: Extracted = {
      ...emptyEx(),
      askTopic: 'price',
      askTopics: ['price'],
      speechAct: 'unknown',
    };
    expect(needsIntentRecovery(ex, 'quite pricey for us')).toBe(true);
    expect(needsIntentRecovery(ex, "what's the price per sqft")).toBe(false);
    const recovered = applyIntentRecovery(ex, {
      confidence: 'llm',
      labels: ['objection_price'],
    });
    expect(recovered.objection).toBe(true);
  });
});

describe('hybrid gate (goal/evidence — not utterance lists)', () => {
  it('templates for structured goals with evidence', () => {
    expect(
      hybridPreferTemplate(
        { kind: 'objection', topic: 'price', projectId: 'x' },
        { tools: [] },
        { ...emptyEx(), objection: true },
      ),
    ).toBe(true);
    expect(
      hybridPreferTemplate(
        { kind: 'answer', topic: 'price', projectId: 'x' },
        {
          tools: ['pricing'],
          pricing: { projectName: 'X', components: [{ label: 'BSP', value: '₹1 Cr' }] },
        },
        emptyEx(),
      ),
    ).toBe(true);
    expect(hybridPreferTemplate({ kind: 'greet' }, { tools: [] }, emptyEx())).toBe(true);
  });

  it('paid floor only when extract/goal thin', () => {
    expect(
      needsPaidLlmFloor({ ...emptyEx(), speechAct: 'unknown' }, { kind: 'clarify_intent' }),
    ).toBe(true);
    expect(needsPaidLlmFloor({ ...emptyEx(), speechAct: 'greet' }, { kind: 'greet' })).toBe(false);
  });
});

describe('voice template greet', () => {
  it('uses short WA voice', () => {
    const req: ComposeRequest = {
      goal: { kind: 'greet' },
      evidence: { tools: [] },
      context: {
        channel: 'whatsapp',
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Brigade',
        priorTopics: [],
      },
    };
    const reply = fallbackReply(req);
    expect(reply.toLowerCase()).toMatch(/hi|hey/);
    expect(reply).not.toMatch(/I can help you find the right property/);
  });
});
