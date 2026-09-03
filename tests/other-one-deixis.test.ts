/**
 * OTHER-01 — "the other one" switches to the alternate discourse project.
 * Phase 1b focus-stack / salience consumer (DIALOGUE_STATE_ARCHITECTURE_LLD §4).
 */
import { describe, expect, it } from 'vitest';
import { detectFocusedSwitchIntent, isAlternateDeixis } from '../src/engine/project_switch.js';
import { commitTo, initState, recordDiscussed, recordOffered } from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import type { Extracted, Match } from '../src/engine/types.js';
import { fakeDeps } from './fakes.js';

const AYANA: Match = {
  projectId: 'ayana',
  name: 'Ayana',
  microMarket: 'Sakleshpur',
  startingPriceInr: 2_495_000,
  startingPriceDisplay: '₹24.95 L',
  matchReasons: [],
};
const KRISHNAJA: Match = {
  projectId: 'krishnaja',
  name: 'Krishnaja Greens',
  microMarket: 'Virajpet',
  startingPriceInr: 3_900_000,
  startingPriceDisplay: '₹39 L',
  matchReasons: [],
};

const emptyEx = (): Extracted => ({});

describe('alternate deixis detection', () => {
  it('matches the other one / go back phrasings', () => {
    expect(isAlternateDeixis('what about the other one')).toBe(true);
    expect(isAlternateDeixis('tell me about the other project')).toBe(true);
    expect(isAlternateDeixis('go back to the first one')).toBe(true);
    expect(isAlternateDeixis('what about cornerstone utopia')).toBe(false);
  });
});

describe('detectFocusedSwitchIntent — OTHER-01', () => {
  it('switches from focused Ayana to Krishnaja on "the other one"', () => {
    let s = initState('other01', 'lokations');
    s = recordOffered(s, [AYANA, KRISHNAJA]);
    s = commitTo(s, 'ayana', 'Ayana');
    s = recordDiscussed(s, [{ projectId: 'krishnaja', name: 'Krishnaja Greens' }]);

    const intent = detectFocusedSwitchIntent('what about the other one', emptyEx(), s);
    expect(intent?.commit.projectId).toBe('krishnaja');
    expect(intent?.commit.name).toBe('Krishnaja Greens');
  });

  it('does not invent a switch when three discourse projects are live', () => {
    let s = initState('other01b', 'lokations');
    s = recordOffered(s, [
      AYANA,
      KRISHNAJA,
      {
        projectId: 'clarks',
        name: 'Clarks Exotica',
        microMarket: 'North Bangalore',
        startingPriceInr: 7_500_000,
        startingPriceDisplay: '₹75 L',
        matchReasons: [],
      },
    ]);
    s = commitTo(s, 'ayana', 'Ayana');

    expect(detectFocusedSwitchIntent('the other one', emptyEx(), s)).toBeNull();
  });
});

describe('OTHER-01 engine turn', () => {
  it('what about the other one commits to the alternate shortlist project', async () => {
    const deps = fakeDeps();
    let s = initState('other01e2e', 'lokations');
    s = recordOffered(s, [AYANA, KRISHNAJA]);
    s = commitTo(s, 'ayana', 'Ayana');
    s = recordDiscussed(s, [{ projectId: 'krishnaja', name: 'Krishnaja Greens' }]);
    await deps.store.save(s);

    const t = await runEngineTurn(
      {
        threadId: 'other01e2e',
        builderId: 'lokations',
        text: 'what about the other one',
        buyerPhone: '+919900000061',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(t.state.focus?.projectId).toBe('krishnaja');
    expect(t.reply).toMatch(/krishnaja/i);
  });

  it('the other one with a 1-project board clarifies — does not recycle overview', async () => {
    const deps = fakeDeps();
    let s = initState('other01solo', 'lokations');
    s = recordOffered(s, [AYANA]);
    s = commitTo(s, 'ayana', 'Ayana');
    await deps.store.save(s);

    const t = await runEngineTurn(
      {
        threadId: 'other01solo',
        builderId: 'lokations',
        text: 'what about the other one',
        buyerPhone: '+919900000062',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(t.state.focus?.projectId).toBe('ayana');
    expect(t.debug?.goal).toMatchObject({ kind: 'clarify_discourse', reason: 'no_alternate' });
    expect(t.reply).toMatch(/only got \*Ayana\*/i);
    expect(t.reply).not.toMatch(/quarter acre/i);
  });
});
