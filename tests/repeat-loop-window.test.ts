import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * L10 on the live line — four straight questions about the agreement:
 *    7 > any litigation on the land
 *    9 > what happens if you delay — do i get compensated
 *   10 > is there a penalty clause in the agreement
 *   13 > is it refundable
 * Every one of them answered with the identical menu: "price, the legal papers,
 * the amenities, or put a site visit on the calendar. Which one?"
 *
 * `lastReply` caught turns 9→10 and nothing else — the guard could only see one
 * line back, and the loop was four turns wide. A menu sent three times is not
 * an answer, and by the third send the bot should say so.
 */
function harness(threadId: string) {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      { threadId, builderId: 'lokations', text, buyerPhone: '+919999991160', channel: 'whatsapp' },
      deps,
    );
  return { turn };
}

describe('a line sent three times inside the window', () => {
  it('remembers more than one line back', async () => {
    const { turn } = harness('repeat-window-state');
    const a = await turn('coorg, 50 Lakhs');
    const b = await turn('tell me about Ayana');

    expect(a.state.recentReplies?.length).toBe(1);
    expect(b.state.recentReplies?.length).toBe(2);
    // Newest first, and fingerprints — not the lines themselves, which would
    // put kilobytes of prose in a blob that rides every turn.
    expect(b.state.recentReplies?.[0]).not.toBe(b.state.recentReplies?.[1]);
    expect(b.state.recentReplies?.[0]?.length).toBeLessThan(20);
  });

  it('stops asking and hands the buyer the wheel', async () => {
    const { turn } = harness('repeat-window-loop');

    // This fixture has now been rebuilt twice, both times for the same reason:
    // the loop it relied on was being manufactured by a phantom locality, not
    // by the thing under test.
    //
    // Round one started "coorg, 50 Lakhs" / "tell me about Ayana", where
    // "agreement" was captured as a LOCATION and stuck, so every send came back
    // as the same probe. Round two dropped the opening brief entirely — and
    // that version looped too, because with no brief at all the bare question
    // was answered "I couldn't match that area exactly — here's the closest I
    // have: *Ayana* in Sakleshpur…", three times. The area it could not match
    // was "the agreement". Once a locality has to be a place Desk knows, that
    // reply is gone, the asks advance instead of repeating, and no loop forms.
    //
    // So the brief is back, and it is a REAL area this time. The loop is now a
    // real one: the buyer asks three times about a penalty clause, and three
    // times gets the same line about her Whitefield search — which is L10's
    // live case exactly ("every one of them answered with the identical menu"),
    // and is still not an answer. The guard itself is unchanged.
    await turn('3 BHK in Whitefield under 1 Cr, to live in');
    const one = await turn('is there a penalty clause in the agreement');
    await turn('what is the price');
    const two = await turn('is there a penalty clause in the agreement');
    await turn('what is the price');
    const three = await turn('is there a penalty clause in the agreement');

    expect(three.debug.repeat_guard).toBe('loop_broken');
    expect(three.reply).toMatch(/third time/i);
    // Two real exits, not a fourth menu.
    expect(three.reply).toMatch(/your own words/i);
    expect(three.reply).toMatch(/talk to someone/i);
    // The first two sends are untouched — twice is not yet a loop.
    expect(one.reply).not.toMatch(/third time/i);
    expect(two.reply).not.toMatch(/third time/i);
  });

  /**
   * The guard above lives on the compose tail. L10's four sends never got there:
   * the unknown-request branch returns early, and that return wrote `turnCount`
   * and nothing else — no `lastReply`, no fingerprint. So the loop was invisible
   * to both the old adjacent guard and the new window. A path that speaks has to
   * leave the trace the next turn reads.
   */
  it('counts the sends that leave by an early return', async () => {
    const deps = fakeDeps();
    deps.failureRouting = true;
    deps.failureSearch = true;
    // Embedder fires and misses — below_tau is the miss that becomes
    // unknown_request, which is the branch that returns early.
    deps.routingEnv = {
      SIL_EMBED_FIRST: 'true',
      FAILURE_ROUTING: 'true',
      AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
      INTENT_VECTORS: {
        query: async () => ({
          matches: [{ id: 'fixture-below-tau', score: 0.2, metadata: { intent_kind: 'ask_price' } }],
        }),
      },
    } as unknown as NonNullable<typeof deps.routingEnv>;
    const turn = (text: string) =>
      runEngineTurn(
        {
          threadId: 'repeat-early-return',
          builderId: 'lokations',
          text,
          buyerPhone: '+919999991161',
          channel: 'whatsapp',
        },
        deps,
      );

    await turn('tell me about Brigade Eldorado');
    await turn('is there a penalty clause in the agreement'); // first ask still orients
    const one = await turn('is there a penalty clause in the agreement');
    const two = await turn('is there a penalty clause in the agreement');
    const three = await turn('is there a penalty clause in the agreement');

    // The early return now stamps its own outbound line …
    expect(two.state.recentReplies?.length).toBeGreaterThanOrEqual(3);
    expect(one.reply).toBe(two.reply);
    // … so the third send is the one that changes.
    expect(three.reply).not.toBe(two.reply);
    expect(three.reply).toMatch(/third time/i);
  });

  it('leaves a legitimate re-ask alone', async () => {
    const { turn } = harness('repeat-window-rebook');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const first = await turn('book a visit');
    await turn('saturday morning');
    await turn('yes');
    await turn('actually cancel that');
    const second = await turn('can we book another visit');

    // Twice is not a loop: a cancel and a rebook are owed the same question.
    expect(second.reply).not.toMatch(/third time/i);
    expect(first.reply.length).toBeGreaterThan(0);
  });
});
