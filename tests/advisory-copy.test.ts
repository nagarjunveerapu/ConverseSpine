import { describe, expect, it } from 'vitest';
import {
  visitChooserPlanPrefix,
  visitOriginAskCopy,
  visitProposeConfirmCopy,
} from '../src/engine/advisory-copy.js';
import { fallbackReply, renderComposePrompt } from '../src/engine/compose.js';
import { speakStickyClarify } from '../src/engine/clarify-outstanding.js';

describe('advisory-copy channel voice', () => {
  it('WhatsApp propose keeps Reply yes chrome', () => {
    const copy = visitProposeConfirmCopy({
      channel: 'whatsapp',
      label: 'Saturday at 10:30 AM',
      projectName: 'Ayana',
    });
    expect(copy).toMatch(/Shall I block/i);
    expect(copy).toMatch(/Reply yes to confirm/i);
  });

  it('advisor_web propose is consultative lock-in', () => {
    const copy = visitProposeConfirmCopy({
      channel: 'advisor_web',
      label: 'Saturday at 10:30 AM',
      projectName: 'Ayana',
      queuedNote: ' After this we\'ll plan *Krishnaja Greens*.',
    });
    expect(copy).toMatch(/shall I lock that in/i);
    expect(copy).not.toMatch(/Reply yes/i);
    expect(copy).toMatch(/\*Ayana\*\.\s+After this/i);
    expect(copy).toMatch(/Shall I lock that in\?$/);
  });

  it('chooser origin prefix differs by channel', () => {
    expect(visitChooserPlanPrefix('whatsapp', 'both')).toBe('Happy to plan both — ');
    expect(visitChooserPlanPrefix('advisor_web', 'both')).toBe(
      'Happy to plan both. To sequence the stops sensibly, ',
    );
    expect(visitOriginAskCopy('advisor_web', 2)).toMatch(/start from/i);
    expect(visitOriginAskCopy('whatsapp', 2)).toMatch(/coming from/i);
  });

  it('compose prompt forks WhatsApp vs advisor_web', () => {
    const base = {
      goal: { kind: 'greet' as const },
      evidence: { tools: [] as string[] },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Lokations',
      },
    };
    const wa = renderComposePrompt({ ...base, context: { ...base.context, channel: 'whatsapp' } });
    expect(wa).toMatch(/WhatsApp property advisor/);
    expect(wa).toMatch(/WhatsApp tone/);

    const adv = renderComposePrompt({
      ...base,
      context: { ...base.context, channel: 'advisor_web' },
    });
    expect(adv).toMatch(/Naya Advisor web app/);
    expect(adv).toMatch(/consultative|advisory/i);
    expect(adv).not.toMatch(/WhatsApp tone/);
  });

  it('sticky clarify discover is softer on advisor_web', () => {
    const wa = speakStickyClarify({ phase: 'discover', constraints: {} });
    const adv = speakStickyClarify({
      phase: 'discover',
      constraints: {},
      channel: 'advisor_web',
    });
    expect(wa).toMatch(/please share your/i);
    expect(adv).toMatch(/own words/i);
  });

  it('advisor recommend lead is consultative', () => {
    const reply = fallbackReply({
      goal: { kind: 'recommend' },
      evidence: {
        tools: ['search'],
        matches: [
          {
            projectId: 'a',
            name: 'Ayana',
            microMarket: 'Sakleshpur',
            startingPriceInr: 2_495_000,
            startingPriceDisplay: '₹24.95 L',
          },
        ],
      },
      context: {
        constraints: { location: 'Sakleshpur' },
        alreadyShownSameSet: false,
        builderName: 'Lokations',
        channel: 'advisor_web',
      },
    });
    expect(reply).toMatch(/look strongest|closest I can stand behind/i);
    expect(reply).toMatch(/closer look|plan a visit/i);
    expect(reply).not.toMatch(/^Here's what fits/i);
  });
});

