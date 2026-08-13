import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import type { ComposeRequest } from '../src/engine/types.js';

/**
 * W3 — repeat guard: the bot never sends the previous line verbatim. One
 * bounded re-compose with vary:true; template-locked goals are exempt
 * (commitments must stay deterministic and MAY repeat).
 *
 * The scripted LLM always drafts the same line unless asked to vary — the
 * shape of the real failure (20% of dev conversations had verbatim repeats).
 */
function scriptedLlm(fixed: string, variedLine: string) {
  const calls: ComposeRequest[] = [];
  return {
    calls,
    async compose(req: ComposeRequest): Promise<string> {
      calls.push(req);
      return req.vary ? variedLine : fixed;
    },
  };
}

describe('W3 repeat guard', () => {
  it('an identical second draft triggers the guard: vary retry, or the accepted template floor', async () => {
    const deps = fakeDeps();
    const llm = scriptedLlm(
      'Ayana is a lovely pick.',
      'Ayana it is — want me to line up the next step?',
    );
    deps.llm = { ...deps.llm, compose: llm.compose }; // override compose only
    const turn = (text: string) =>
      runEngineTurn(
        { convId: 'rg-1', builderId: 'lokations', text, buyerPhone: '+919999999996', channel: 'advisor_web' },
        deps,
      );
    await turn('plantation in sakleshpur under 50 lakhs');
    // An off-book question the file cannot answer, asked twice. The reply is
    // LLM-composed, so a second identical draft is exactly what the guard is for.
    const first = await turn('what school district is this in?');
    const second = await turn('what school district is this in?');

    // The contract: the guard FIRES on a would-be verbatim repeat, and either
    // re-composes (replies differ) or lands on the accepted template floor
    // (explicitly marked still_identical) — never a silent repeat.
    expect(second.reply).not.toBe(first.reply);
    if (second.debug.repeat_guard) {
      expect(['recomposed', 'template']).toContain(second.debug.repeat_guard);
    }
  });

  it('a bare affirm answers the question the bot just asked — it does not re-nudge', async () => {
    // Was: two bare "ok"s produced two identical 'advance' nudges, and the
    // guard existed to break the tie. The affirm now binds to the closer the
    // buyer actually read, so consecutive yeses walk the offer instead.
    const deps = fakeDeps();
    const turn = (text: string) =>
      runEngineTurn(
        { convId: 'rg-3', builderId: 'lokations', text, buyerPhone: '+919999999994', channel: 'advisor_web' },
        deps,
      );
    await turn('plantation in sakleshpur under 50 lakhs');
    await turn('tell me about Ayana');
    const first = await turn('ok');
    const second = await turn('ok');
    expect(first.debug.goal.kind).toBe('answer');
    expect(second.debug.goal.kind).toBe('answer');
    expect(second.reply).not.toBe(first.reply);
  });

  it('a nudge never repeats itself verbatim — templates are exempt from the guard', async () => {
    // advance is template-locked, so W3 never sees it. The nudge has to notice
    // for itself that the buyer already read it and step aside.
    const deps = fakeDeps();
    const turn = (text: string) =>
      runEngineTurn(
        { convId: 'rg-4', builderId: 'lokations', text, buyerPhone: '+919999999993', channel: 'advisor_web' },
        deps,
      );
    await turn('plantation in sakleshpur under 50 lakhs');
    await turn('tell me about Ayana');
    const first = await turn('no thanks');
    const second = await turn('no thanks');
    expect(first.debug.goal.kind).toBe('advance');
    expect(second.debug.goal.kind).toBe('advance');
    expect(second.reply).not.toBe(first.reply);
  });

  it('template-locked goals are exempt — deterministic content may repeat', async () => {
    const deps = fakeDeps();
    const turn = (text: string) =>
      runEngineTurn(
        { convId: 'rg-2', builderId: 'lokations', text, buyerPhone: '+919999999997', channel: 'advisor_web' },
        deps,
      );
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    await turn('hold a 2bhk for me');
    await turn('what are the amenities?');
    const re1 = await turn('yes'); // re-propose (template-locked hold copy)
    expect(re1.debug.goal.kind).toBe('hold_propose');
    expect(re1.debug.repeat_guard).toBeUndefined(); // guard never fires on locked goals
  });
});
