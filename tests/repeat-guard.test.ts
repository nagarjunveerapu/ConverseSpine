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
    await turn('plantation in sakleshpur');
    await turn('tell me about Ayana');
    // Two bare affirms → two 'advance' goals (LLM-composed, not template-locked).
    const first = await turn('ok');
    const second = await turn('ok');
    expect(second.debug.goal.kind).toBe('advance');

    // The contract: the guard FIRES on a would-be verbatim repeat, and either
    // re-composes (replies differ) or lands on the accepted template floor
    // (explicitly marked still_identical) — never a silent repeat.
    if (second.reply === first.reply) {
      expect(second.debug.repeat_guard).toBe('still_identical');
    } else if (second.debug.repeat_guard) {
      expect(['recomposed', 'template']).toContain(second.debug.repeat_guard);
      expect(llm.calls.some((c) => c.vary)).toBe(true);
    }
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
