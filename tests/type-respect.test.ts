import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { detectPropertyTypes } from '../src/engine/facts.js';
import { fakeDeps } from './fakes.js';

/**
 * AB-2 — a declared property type is a HARD filter. The old shortlist padding
 * dropped `projectTypes` to reach 3 cards, so "show plotted developments in North
 * Bangalore" listed Century Breeze (an apartment) and "show me villas" listed a
 * plantation. The buyer reads every card as what they asked for — a polluted list
 * actively misleads. Two honest typed cards beat three polluted ones; zero typed
 * matches must become an honest propertyTypeGap no_fit that NAMES the gap.
 *
 * Fake catalog: 1 villa (Clarks Exotica, North Bangalore), 3 plantations, 3
 * apartments — so a villa ask has exactly one true match and plenty of bait.
 */
const turn = (convId: string, deps: ReturnType<typeof fakeDeps>) => (text: string) =>
  runEngineTurn({ convId, builderId: 'lokations', text, buyerPhone: '+919999999991' }, deps);

describe('AB-2 — type-respect search', () => {
  it('a villa ask returns ONLY villas — never padded with other types', async () => {
    const t = turn('ab2-villa', fakeDeps());
    const r = await t('show me villas');
    expect(r.debug.goal.kind).toBe('recommend');
    expect(r.reply).toMatch(/Clarks Exotica/);
    // the pre-fix pads — a plantation and an apartment — must not appear
    expect(r.reply).not.toMatch(/Ayana|Krishnaja|Coorg Hills/);
    expect(r.reply).not.toMatch(/Eldorado|Cornerstone|Orchards/);
  });

  it('zero typed matches → honest propertyTypeGap naming type AND place, not a wrong-type list', async () => {
    const t = turn('ab2-gap', fakeDeps());
    const r = await t('apartments in sakleshpur');
    expect(r.debug.goal.kind).toBe('no_fit');
    expect(r.reply).toMatch(/No \*apartment\*/i);
    expect(r.reply).toMatch(/sakleshpur/i);
    // must not present the plantation as if it were the asked type
    expect(r.reply).not.toMatch(/Here's what fits/);
  });

  it('a named project still beats pending recovery chips (name beats filters)', async () => {
    const t = turn('ab2-name', fakeDeps());
    await t('apartments in sakleshpur'); // honest no_fit leaves recovery chips pending
    const r = await t('tell me about Ayana'); // must commit focus, not fall into the probe
    expect(r.debug.phase).toBe('focused');
  });

  it('detectPropertyTypes reads farmland as a plantation ask (D1.5)', () => {
    expect(detectPropertyTypes('farmland near Kanakapura')).toBe('plantation');
    expect(detectPropertyTypes('agricultural land in Coorg')).toBe('plantation');
    expect(detectPropertyTypes('farm plots near Mysore')).toBe('plantation');
  });
});
