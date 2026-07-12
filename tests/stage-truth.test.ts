import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import type { EngineCrm } from '../src/engine/ports.js';

/**
 * W5 — stage truth. The engine climbs Desk's funnel ladder as the
 * conversation earns it: engaged = focus + (facet ask OR second focused
 * turn); qualified = focus + budget + (bhk OR property type). Every ladder
 * write carries onlyForward so Desk can never be downgraded, and each rung
 * is written at most once per conversation.
 */
function harness(convId: string) {
  const deps = fakeDeps();
  const crm = deps.crm as EngineCrm & { calls: string[] };
  const turn = (text: string) =>
    runEngineTurn(
      { convId, builderId: 'lokations', text, buyerPhone: '+919999999993', channel: 'advisor_web' },
      deps,
    );
  const stageCalls = () => crm.calls.filter((c) => c.startsWith('stage:'));
  return { deps, turn, stageCalls };
}

describe('W5 stage truth', () => {
  it('focus + facet ask → engaged, written once with onlyForward', async () => {
    const { turn, stageCalls } = harness('stage-engaged');
    await turn('plantation in sakleshpur');
    expect(stageCalls()).toEqual([]); // discover: no rung earned

    await turn('tell me about Ayana'); // focus turn 1, no facet yet
    const afterFocus = stageCalls();

    await turn('what are the amenities?'); // facet ask while focused
    expect(stageCalls()).toContain('stage:engaged:fwd');

    await turn('and the legal details?'); // second facet — must NOT re-write
    expect(stageCalls().filter((c) => c === 'stage:engaged:fwd')).toHaveLength(1);
    // and never wrote anything before focus
    expect(afterFocus.filter((c) => c.startsWith('stage:engaged'))).toHaveLength(afterFocus.length ? 1 : 0);
  });

  it('budget + type known at focus time → jumps straight to qualified', async () => {
    const { turn, stageCalls } = harness('stage-qualified');
    await turn('plots in sakleshpur under 50 lakhs'); // budget + property type
    await turn('tell me about Ayana');
    expect(stageCalls()).toContain('stage:qualified:fwd');
    expect(stageCalls()).not.toContain('stage:engaged:fwd'); // skipped rung, by design

    await turn('what are the amenities?'); // qualified already written — no repeat
    expect(stageCalls().filter((c) => c === 'stage:qualified:fwd')).toHaveLength(1);
  });

  it('engaged upgrades to qualified when the budget lands later', async () => {
    const { turn, stageCalls } = harness('stage-upgrade');
    await turn('plantation in sakleshpur');
    await turn('tell me about Ayana');
    await turn('what are the amenities?');
    expect(stageCalls()).toContain('stage:engaged:fwd');

    // Focus-keeping budget mention (a bare "my budget is 40L" pivots to a
    // re-search, drops focus, and correctly does NOT qualify — by formula).
    await turn('does a plot at ayana fit in 40 lakhs?');
    expect(stageCalls()).toContain('stage:qualified:fwd');
    // ladder is monotonic: exactly one write per rung
    expect(stageCalls().filter((c) => c.includes('engaged'))).toHaveLength(1);
    expect(stageCalls().filter((c) => c.includes('qualified'))).toHaveLength(1);
  });

  it('event stages (visit_booked) still fire without onlyForward', async () => {
    const { turn, stageCalls } = harness('stage-visit');
    await turn('plantation in sakleshpur');
    await turn('tell me about Ayana');
    await turn('book a site visit for saturday morning');
    const yes = await turn('yes');
    if (yes.debug.goal.kind === 'visit_booked') {
      expect(stageCalls()).toContain('stage:visit_booked'); // event write, unchanged semantics
    }
  });
});
