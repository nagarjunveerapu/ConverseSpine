import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * Understanding slice ① — a taught facet answers with the project's own FAQ row.
 * "can i sell the plot later?" was the founder's canonical failure: the bind
 * scored 0.91 (ask_investment_return) and the bot STILL repeated the overview
 * card, because the taught sub-intent never reached compose. With the facet on
 * the vector metadata, compose pins the focused project's resale_value row.
 */
const RESALE_ANSWER =
  'Plots are freely transferable after registration — resale here has tracked the corridor.';

function depsWithTaughtFacet(opts: { withFaqRow: boolean }) {
  const deps = fakeDeps();
  (deps as { routingEnv?: unknown }).routingEnv = {
    AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
    INTENT_VECTORS: {
      query: async () => ({
        matches: [
          {
            id: 'ph_taught_resale',
            score: 0.91,
            metadata: { intent_kind: 'ask_investment_return', facet: 'resale_value' },
          },
        ],
      }),
    },
  };
  const baseLookup = deps.data.faqLookup.bind(deps.data);
  deps.data.faqLookup = async (pid: string, key: string) => {
    if (key === 'resale_value') {
      return opts.withFaqRow ? { question: 'Can I resell?', answer: RESALE_ANSWER } : null;
    }
    return baseLookup(pid, key);
  };
  return deps;
}

async function focusAyana(deps: ReturnType<typeof fakeDeps>) {
  const turn = (text: string) =>
    runEngineTurn(
      { convId: 'facet-e2e', builderId: 'lokations', text, buyerPhone: '+919999999993', channel: 'advisor_web' },
      deps,
    );
  await turn('coorg, 50 Lakhs');
  const focused = await turn('tell me about Ayana');
  expect(focused.state.phase).toBe('focused');
  return turn;
}

describe('taught facet end-to-end (focused ask, bind carries a FAQ key)', () => {
  it('answers from the taught FAQ row instead of the overview card', async () => {
    const deps = depsWithTaughtFacet({ withFaqRow: true });
    const turn = await focusAyana(deps);

    const r = await turn('can i sell the plot later?');
    expect(r.reply).toContain(RESALE_ANSWER);
    // The goal topic stays overview — the facet does the work at compose,
    // exactly the "no facet taught → behaves as today" contract.
    expect(r.debug.goal).toMatchObject({ kind: 'answer', topic: 'overview' });
  });

  it('taught facet with no Desk row → honest miss, never the overview card', async () => {
    const deps = depsWithTaughtFacet({ withFaqRow: false });
    const turn = await focusAyana(deps);

    const r = await turn('can i sell the plot later?');
    expect(r.reply).toContain("I don't have that detail on file");
    // The overview card's signature line must not appear.
    expect(r.reply).not.toMatch(/plots? .*·|configurations on offer/i);
  });

  it('text-bound FAQ key outranks the taught facet (B5.1 family pin)', async () => {
    const deps = depsWithTaughtFacet({ withFaqRow: true });
    const turn = await focusAyana(deps);

    const r = await turn('when is possession?');
    expect(r.reply).toContain('Possession is phased through 2028');
    expect(r.reply).not.toContain(RESALE_ANSWER);
  });
});
