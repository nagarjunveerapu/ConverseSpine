import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * Brief-extract turn (SPA landing/brief funnel free text): natural language sent
 * with briefExtract:true runs the full extraction funnel and MERGES constraints,
 * then stops — no goal, no search, no compose, empty reply. The merged brief
 * rides back out via state.constraints (→ prefs_snapshot). Fixes the Cowork F1/F6:
 * the landing message reaches the language authority instead of three local
 * one-pref matchers. (Location resolution needs the live NLU lane and is covered
 * by the curl verification, not the fakes harness; budget/bhk/purpose are
 * deterministic and asserted here.)
 */

function harness(convId: string) {
  const deps = fakeDeps();
  const turn = (text: string, briefExtract = false) =>
    runEngineTurn(
      { convId, builderId: 'lokations', text, buyerPhone: '+919999999995', channel: 'advisor_web', briefExtract },
      deps,
    );
  return { deps, turn };
}

describe('brief-extract turn — extract, do not search/compose', () => {
  it('first-time buyer opener extracts budget + bhk, no reply, no shortlist', async () => {
    const { turn } = harness('be-first');
    const r = await turn(
      "Hi, I'm buying my first home. My budget is around 80 lakhs and I work near Whitefield. What areas should I look at for a 2BHK?",
      true,
    );
    expect(r.reply).toBe('');
    expect(r.state.constraints.budgetMaxInr).toBe(8_000_000);
    expect(r.state.constraints.bhk).toMatch(/2/);
    expect(r.state.discover.lastOffered).toHaveLength(0);
    expect(r.debug.goal.kind).toBe('orient');
  });

  it('investor opener detects purpose=investment, no reply', async () => {
    const { turn } = harness('be-investor');
    const r = await turn(
      "I'm an investor looking for the best rental yield and appreciation. Which projects give the highest ROI and what resale potential do they have?",
      true,
    );
    expect(r.reply).toBe('');
    expect(r.state.constraints.purpose).toBe('investment');
    expect(r.state.discover.lastOffered).toHaveLength(0);
  });

  it('luxury opener extracts a crore-scale budget + 4BHK, no reply', async () => {
    const { turn } = harness('be-luxury');
    const r = await turn(
      'Looking for a luxury 4BHK villa or penthouse, budget is flexible around 5 crore. I want premium amenities.',
      true,
    );
    expect(r.reply).toBe('');
    expect(r.state.constraints.budgetMaxInr).toBe(50_000_000);
    expect(r.state.constraints.bhk).toMatch(/4/);
    expect(r.state.discover.lastOffered).toHaveLength(0);
  });

  it('extract turn does not consume turnCount — post-brief first turn behaves as today', async () => {
    const { turn } = harness('be-then-real');
    const extract = await turn('2bhk around 50 lakhs in coorg', true);
    expect(extract.reply).toBe('');
    // turnCount untouched by the silent extract.
    expect(extract.state.turnCount).toBe(0);

    // The SPA fires the one real dispatch once the brief is ready.
    const real = await turn('2bhk around 50 lakhs in coorg', false);
    expect(real.reply.length).toBeGreaterThan(0);
    expect(real.state.turnCount).toBe(1);
  });

  it('a normal (non-extract) opener with the same text DOES search — proves the flag gates it', async () => {
    const { turn } = harness('be-control');
    const r = await turn('2bhk plantation around 50 lakhs', false);
    // Control: without briefExtract the engine may greet/probe/recommend — the
    // point is it is NOT force-empty. Extract mode alone yields the empty reply.
    expect(typeof r.reply).toBe('string');
    expect(r.reply.length).toBeGreaterThan(0);
  });
});
