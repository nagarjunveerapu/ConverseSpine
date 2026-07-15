import { describe, expect, it } from 'vitest';
import { fallbackReply } from '../src/engine/compose.js';
import { stripComposerDirectives } from '../src/engine/grounding.js';
import type { ComposeRequest } from '../src/engine/types.js';

/**
 * AB-10 — a media/FAQ miss must reach the buyer as clean copy, never an internal
 * composer instruction. The live bot printed to buyers, verbatim:
 *
 *   "For *Brigade Oasis* — no floor_plan on file for this project yet — offer to follow up"
 *
 * "offer to follow up" is a directive Desk authors for the RM (disclosure.ts), and
 * `floor_plan` is a raw key. Both leaked because the composer echoed Desk's
 * `redirect_hint` instead of translating the miss.
 */
function mediaMissReq(overrides: Partial<ComposeRequest['evidence']['media']> = {}): ComposeRequest {
  return {
    goal: { kind: 'answer', topic: 'media', projectId: 'brigade-oasis' },
    evidence: {
      tools: ['mediaShare'],
      media: {
        projectName: 'Brigade Oasis',
        allowed: false,
        assetKind: 'floor_plan',
        // this is the exact internal directive Desk returns on a media miss
        redirectHint: 'no floor_plan on file for this project yet — offer to follow up',
        ...overrides,
      },
    },
    context: {
      constraints: {},
      alreadyShownSameSet: false,
      builderName: 'Naya',
      buyerText: 'send me the floor plan',
      focusProjectName: 'Brigade Oasis',
    },
  };
}

describe('AB-10 — media miss composes buyer-safe copy, never the internal hint', () => {
  it('does not echo the redirect_hint directive', () => {
    const reply = fallbackReply(mediaMissReq());
    expect(reply).not.toMatch(/offer to follow up/i);
    expect(reply).not.toMatch(/redirect/i);
  });

  it('never prints a raw underscored asset key', () => {
    const reply = fallbackReply(mediaMissReq());
    expect(reply).not.toMatch(/floor_plan/);
    expect(reply).toMatch(/floor plan/); // humanized
  });

  it('names the asset the buyer asked for and stays on the focused project', () => {
    const reply = fallbackReply(mediaMissReq());
    expect(reply).toMatch(/Brigade Oasis/);
    expect(reply).toMatch(/floor plan/);
    expect(reply).toMatch(/site visit|walk you through/i);
  });

  it('falls back to "document" when the asset kind is unknown, still no leak', () => {
    const reply = fallbackReply(mediaMissReq({ assetKind: undefined, redirectHint: 'this is not currently sharable' }));
    expect(reply).not.toMatch(/sharable|redirect|offer to/i);
    expect(reply).toMatch(/document/);
  });

  it('still shares the asset when it is allowed', () => {
    const reply = fallbackReply(
      mediaMissReq({ allowed: true, cdnUrl: 'https://cdn/x.pdf', title: 'Oasis Floor Plan' }),
    );
    expect(reply).toContain('https://cdn/x.pdf');
    expect(reply).toMatch(/Oasis Floor Plan/);
  });
});

describe('AB-10 verify — stripComposerDirectives removes leaked instructions', () => {
  it('strips the exact leak the founder found', () => {
    const leaked = 'For *Brigade Oasis* — no floor plan on file for this project yet — offer to follow up';
    const out = stripComposerDirectives(leaked);
    expect(out).not.toMatch(/offer to follow up/i);
    expect(out).toMatch(/Brigade Oasis/); // the real content survives
  });

  it('strips other internal directive tails', () => {
    expect(stripComposerDirectives('Pricing is on file — do not quote this number')).not.toMatch(/do not quote/i);
    expect(stripComposerDirectives('That unit is gone — pivot to current inventory')).not.toMatch(/pivot to/i);
    expect(stripComposerDirectives('Here you go — reassure a human will follow up')).not.toMatch(/reassure a human/i);
  });

  it('drops a whole sentence that is pure composer meta', () => {
    const out = stripComposerDirectives('For Ayana, possession is Dec 2027. Use the exact template in EVIDENCE.');
    expect(out).toMatch(/possession is Dec 2027/);
    expect(out).not.toMatch(/EVIDENCE|exact template/);
  });

  it('never touches a normal buyer reply', () => {
    const clean = 'Brigade Oasis plots start from ₹71 L in Devanahalli. Want pricing or a visit?';
    expect(stripComposerDirectives(clean)).toBe(clean);
  });

  it('never returns blank — falls back to the input if stripping would empty it', () => {
    expect(stripComposerDirectives('offer to follow up').length).toBeGreaterThan(0);
  });
});
