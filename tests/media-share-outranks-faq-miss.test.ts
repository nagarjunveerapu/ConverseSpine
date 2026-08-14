/**
 * A file that GOT SENT is not a miss.
 *
 * `floor_plan` and `payment_plan` are FAQ question keys as well as document
 * kinds. On a project carrying no FAQ rows (Brigade Eldorado on dev has zero),
 * the honest-miss branch fired for the very PDF the same turn had attached:
 * the buyer received "I don't have that detail on file for Brigade Eldorado
 * yet" with the 2 BHK floor plan riding along in media_attachments. Master
 * plan read correctly only because it happens not to be an FAQ key.
 */
import { describe, expect, it } from 'vitest';
import { fallbackReply } from '../src/engine/compose.js';
import { resolveFaqQuestionKeys } from '../src/engine/faq-keys.js';
import type { ComposeRequest } from '../src/engine/types.js';

const ctx: ComposeRequest['context'] = {
  builderName: 'Brigade',
  constraints: {},
  focusProjectName: 'Brigade Eldorado',
  buyerText: 'send me the floor plan',
};

const detail = {
  projectId: 'brigade-eldorado',
  name: 'Brigade Eldorado',
  microMarket: 'Devanahalli',
} as ComposeRequest['evidence']['detail'];

const sentFloorPlan = {
  assetKind: 'floor_plan',
  allowed: true,
  cdnUrl: 'https://desk.example/api/media/signed/eldorado-floor-plan-2bhk',
  projectName: 'Brigade Eldorado',
};

describe('media share outranks FAQ miss', () => {
  it('the collision is real — floor_plan is both a doc kind and an FAQ key', () => {
    expect(resolveFaqQuestionKeys('send me the floor plan')).toContain('floor_plan');
    // master_plan is not, which is why only some kinds regressed.
    expect(resolveFaqQuestionKeys('send me the master plan')).not.toContain('master_plan');
  });

  it('does not honest-miss the document it just sent', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'media', projectId: 'brigade-eldorado' },
      evidence: {
        tools: ['faqMiss', 'mediaShare'],
        faqMiss: { keys: ['floor_plan'] },
        detail,
        media: sentFloorPlan,
      },
      context: ctx,
    });
    expect(reply.toLowerCase()).not.toMatch(/don'?t have that detail on file/);
    expect(reply.toLowerCase()).toMatch(/floor plan/);
  });

  it('payment_plan collides the same way', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'media', projectId: 'brigade-eldorado' },
      evidence: {
        tools: ['faqMiss', 'mediaShare'],
        faqMiss: { keys: ['payment_plan'] },
        detail,
        media: { ...sentFloorPlan, assetKind: 'payment_plan' },
      },
      context: { ...ctx, buyerText: 'share the payment plan' },
    });
    expect(reply.toLowerCase()).not.toMatch(/don'?t have that detail on file/);
  });

  it('still honest-misses the atom the share did NOT answer', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'media', projectId: 'brigade-eldorado' },
      evidence: {
        tools: ['faqMiss', 'mediaShare'],
        faqMiss: { keys: ['floor_plan', 'revenue_model'] },
        detail,
        media: sentFloorPlan,
      },
      context: { ...ctx, buyerText: 'floor plan and the revenue model' },
    });
    expect(reply.toLowerCase()).toMatch(/don'?t have that detail on file/);
  });

  it('a WITHHELD share keeps the honest miss — nothing went out', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'media', projectId: 'brigade-eldorado' },
      evidence: {
        tools: ['faqMiss', 'mediaShare'],
        faqMiss: { keys: ['floor_plan'] },
        detail,
        media: {
          assetKind: 'floor_plan',
          allowed: false,
          reason: 'no_matching_asset',
          projectName: 'Brigade Eldorado',
        },
      },
      context: ctx,
    });
    expect(reply.toLowerCase()).toMatch(/don'?t have|on file/);
  });
});
