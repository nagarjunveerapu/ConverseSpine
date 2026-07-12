import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import { phaseNoteFrom } from '../src/engine/compose.js';

/**
 * W7 — feed the starved features. The Desk context carries live per-type
 * holdable counts (#203) and journey-composer phase output; the engine now
 * consumes both: sold-out types get the waitlist offer BEFORE a doomed
 * propose, a confirm joins the waitlist for real (queue:true → 202), and
 * detail evidence carries one honest phase caveat.
 */
function harness(convId: string, detailPatch?: Record<string, unknown>) {
  const deps = fakeDeps();
  if (detailPatch) {
    const orig = deps.data.projectDetail.bind(deps.data);
    deps.data.projectDetail = async (b, nd, id) => {
      const d = await orig(b, nd, id);
      return d ? { ...d, ...detailPatch } : d;
    };
  }
  const turn = (text: string) =>
    runEngineTurn(
      { convId, builderId: 'lokations', text, buyerPhone: '+919999999998', channel: 'advisor_web' },
      deps,
    );
  return { deps, turn };
}

describe('W7 sold-out pre-check → waitlist via chat', () => {
  const soldOut = {
    configurations: [{ unitType: '2 BHK', priceDisplay: '₹71 L', priceMinInr: 7_100_000, holdableUnits: 0 }],
  };

  it('a sold-out type gets the waitlist offer up front, and yes JOINS it (no invented hold)', async () => {
    const { deps, turn } = harness('w7-queue', soldOut);
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');

    const propose = await turn('hold a 2 bhk for me');
    expect(propose.debug.goal.kind).toBe('hold_propose');
    expect(propose.reply).toMatch(/waitlist/i); // offer rewritten before a doomed propose
    expect(propose.state.hold?.queue).toBe(true);

    const confirmed = await turn('yes');
    expect(confirmed.debug.goal).toMatchObject({ kind: 'hold_booked', placed: true, queued: true });
    expect(confirmed.reply).toMatch(/first in line/i);
    expect(confirmed.reply).not.toMatch(/held for you until/i); // never claims a hold it didn't place
    expect(deps.data.holdsPlaced).toHaveLength(1); // the queue request went to Desk
  });

  it('counts absent (pre-#203 payload) → fail open: normal hold propose', async () => {
    const { turn } = harness('w7-failopen'); // fake detail has no configurations
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const propose = await turn('hold a 2 bhk for me');
    expect(propose.debug.goal.kind).toBe('hold_propose');
    expect(propose.reply).toMatch(/reply yes to confirm/i);
    expect(propose.reply).not.toMatch(/waitlist/i);
  });

  it('holdable units remaining → normal hold flow untouched', async () => {
    const { deps, turn } = harness('w7-normal', {
      configurations: [{ unitType: '2 BHK', priceDisplay: '₹71 L', priceMinInr: 7_100_000, holdableUnits: 3 }],
    });
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    await turn('hold a 2 bhk for me');
    const booked = await turn('yes');
    expect(booked.debug.goal).toMatchObject({ kind: 'hold_booked', placed: true });
    expect(booked.debug.goal).not.toMatchObject({ queued: true });
    expect(deps.data.holdsPlaced).toHaveLength(1);
  });
});

describe('W7 phase note (journey composer finally reaches the bot)', () => {
  it('renders one caveat only for money-gated phases', () => {
    expect(phaseNoteFrom([
      { phase_label: 'Phase 1', money_allowed: true },
      { phase_label: 'Phase 2', money_allowed: false, primary: 'eoi' },
    ])).toMatch(/Phase 2 is pre-RERA — booking opens at registration/);
    expect(phaseNoteFrom([{ phase_label: 'Phase 1', money_allowed: true }])).toBe('');
    expect(phaseNoteFrom(undefined)).toBe('');
  });

  it('single-phase projects say "This phase"', () => {
    expect(phaseNoteFrom([{ phase_label: 'P1', money_allowed: false }])).toMatch(/^This phase is pre-RERA/);
  });
});
