/**
 * NAME-06 — switch from Cornerstone to longer sibling Cornerstone Utopia.
 * Known-fail until Phase 1b consumers read the focus stack / catalog specificity.
 */
import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

describe('NAME-06 sibling switch', () => {
  it('what about cornerstone utopia switches off plain Cornerstone', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        {
          convId: 'name06',
          builderId: 'naya-advisor',
          text,
          buyerPhone: '+919900000006',
          channel: 'advisor_web',
        },
        deps,
      );

    const t1 = await say('tell me about cornerstone');
    expect(t1.reply).toMatch(/cornerstone/i);
    expect(t1.state.phase).toBe('focused');
    expect(t1.state.focus?.projectName ?? '').toMatch(/cornerstone/i);
    expect(t1.state.focus?.projectId).not.toMatch(/utopia/i);

    const t2 = await say('what about cornerstone utopia');
    expect(t2.reply).toMatch(/utopia/i);
    expect(t2.state.focus?.projectId).toMatch(/utopia/i);
  });

  it('dig shape: Brigade Cornerstone Utopia (both names FULL) still switches', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        {
          convId: 'name06dig',
          builderId: 'naya-advisor',
          text,
          buyerPhone: '+919900000007',
          channel: 'advisor_web',
        },
        deps,
      );

    await say('tell me about Brigade Cornerstone');
    // Force dig-like names on the focus + catalog pair.
    const s = await deps.store.load('name06dig');
    s!.focus = { projectId: 'cornerstone', projectName: 'Brigade Cornerstone' };
    await deps.store.save(s!);

    const t2 = await say('what about Brigade Cornerstone Utopia');
    expect(t2.reply).toMatch(/utopia/i);
    expect(t2.state.focus?.projectId).toMatch(/utopia/i);
  });
});
