import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * Unit-hold sub-flow (Phase 4 launch ops) — the inventory twin of the visit
 * confirm gate. propose → bare affirm → hold placed via the Desk port; the
 * confirm window is one-shot; visit phrasing must not be hijacked.
 */
function harness(convId: string) {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      { convId, builderId: 'lokations', text, buyerPhone: '+919999999992', channel: 'advisor_web' },
      deps,
    );
  return { deps, turn };
}

describe('unit hold flow (launch ops)', () => {
  it('propose → yes → hold placed with deterministic confirmation', async () => {
    const { deps, turn } = harness('hold-happy');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana'); // → focused on ayana

    const propose = await turn('can you hold a 2 bhk for me?');
    expect(propose.debug.goal.kind).toBe('hold_propose');
    expect(propose.reply).toMatch(/hold a \*2 BHK\*/i);
    expect(propose.reply).toMatch(/reply yes to confirm/i);
    expect(propose.state.hold?.awaitingConfirm).toBe(true);

    const booked = await turn('yes');
    expect(booked.debug.goal).toMatchObject({ kind: 'hold_booked', placed: true });
    expect(booked.reply).toMatch(/held for you/i);
    expect(booked.state.hold).toBeUndefined();
    expect(deps.data.holdsPlaced).toHaveLength(1);
    expect(deps.data.holdsPlaced[0]).toMatchObject({ projectId: 'ayana', unitType: '2 BHK' });
  });

  it('digression downgrades the window; a later "yes" RE-PROPOSES (never books directly) — W2', async () => {
    const { deps, turn } = harness('hold-oneshot');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    await turn('hold a 2bhk for me');

    const other = await turn('what are the amenities?');
    expect(other.state.hold?.awaitingConfirm).toBe(false); // downgraded, offer lingers

    const strayYes = await turn('yes');
    expect(strayYes.debug.goal.kind).toBe('hold_propose'); // re-confirm, not a booking
    expect(strayYes.reply).toMatch(/just to confirm/i);
    expect(deps.data.holdsPlaced).toHaveLength(0); // HOLD-05: stale yes never places

    const realYes = await turn('yes');
    expect(realYes.debug.goal).toMatchObject({ kind: 'hold_booked', placed: true });
    expect(deps.data.holdsPlaced).toHaveLength(1);
  });

  it('the lingering offer expires after 6 turns — an old "yes" advances instead — W2', async () => {
    const { deps, turn } = harness('hold-expiry');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    await turn('hold a 2bhk for me');
    for (const q of ['what are the amenities?', 'and the legal details?', 'how far is the airport?',
                     'what about water supply?', 'is there a clubhouse?', 'possession when?', 'road access?']) {
      await turn(q);
    }
    const oldYes = await turn('yes');
    expect(oldYes.debug.goal.kind).not.toBe('hold_propose');
    expect(oldYes.debug.goal.kind).not.toBe('hold_booked');
    expect(deps.data.holdsPlaced).toHaveLength(0);
  });

  it('bare affirm with nothing pending → advance (deal nudge), never a re-answer — W2', async () => {
    const { turn } = harness('hold-advance');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const a1 = await turn('what are the amenities?');
    const ok = await turn('ok');
    expect(ok.debug.goal.kind).toBe('advance');
    expect(ok.reply).not.toBe(a1.reply); // the dev failure mode: verbatim re-answer
    expect(ok.reply).toMatch(/visit|hold/i); // focused advance nudges the deal
  });

  it('visit phrasing ("block saturday for a site visit") is not hijacked by the hold gate', async () => {
    const { turn } = harness('hold-visit-guard');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const v = await turn('can we block saturday for a site visit?');
    expect(v.debug.goal.kind).not.toBe('hold_propose');
    expect(v.debug.goal.kind).not.toBe('hold_booked');
  });

  it('"book a 2 bhk" is purchase intent, NOT a hold — falls through to a normal answer', async () => {
    const { deps, turn } = harness('hold-book-guard');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const r = await turn('can you book a 2 bhk for me?');
    expect(r.debug.goal.kind).not.toBe('hold_propose');
    expect(deps.data.holdsPlaced).toHaveLength(0);
  });

  it('weak object ("hold one for me") works with a strong verb + stated BHK preference', async () => {
    const { turn } = harness('hold-weak-object');
    await turn('2 bhk in coorg, 50 Lakhs'); // constraints.bhk = 2
    await turn('tell me about Ayana');
    const r = await turn('please hold one for me');
    expect(r.debug.goal.kind).toBe('hold_propose');
    expect(r.reply).toMatch(/2 BHK/i);
  });

  it('weak object with a weak verb ("block it") does NOT fire', async () => {
    const { turn } = harness('hold-weak-verb');
    await turn('2 bhk in coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const r = await turn('block it for me');
    expect(r.debug.goal.kind).not.toBe('hold_propose');
  });

  it('no resolvable unit type → no hold proposal (falls through to a normal answer)', async () => {
    const { turn } = harness('hold-no-type');
    await turn('coorg plots around 50 Lakhs');
    await turn('tell me about Ayana');
    const r = await turn('please reserve a flat for me');
    // Explicit object but no BHK anywhere → the proposal must not fire.
    expect(r.debug.goal.kind).not.toBe('hold_propose');
  });

  it('type sold out mid-conversation → honest "just taken" copy, no invented hold', async () => {
    const { deps, turn } = harness('hold-sold-out');
    deps.data.placeHold = async () => ({ ok: false, reason: 'none_available' as const });
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const propose = await turn('hold a 2 bhk for me');
    expect(propose.debug.goal.kind).toBe('hold_propose');

    const booked = await turn('yes');
    expect(booked.debug.goal).toMatchObject({ kind: 'hold_booked', placed: false });
    expect(booked.reply).toMatch(/just taken/i);
    expect(booked.reply).not.toMatch(/held for you/i);
  });
});

describe('hold intent beats the visit-phase transition (dev regression)', () => {
  it('a hold ask that the embedder tags want_visit still proposes a hold, not a visit', async () => {
    // Simulate the REAL dev embedder: it classifies "hold a 2 bhk for me" as
    // want_visit. Before the fix this flipped phase→visit and stole the turn
    // (dev HOLD-01/04/05 all returned visit_ask). The fake NLU never set this,
    // so unit tests were green while dev was broken.
    const deps = fakeDeps();
    const baseEnrich = deps.semantic.enrich.bind(deps.semantic);
    deps.semantic = {
      async enrich(text, b, ex, ctx) {
        const out = await baseEnrich(text, b, ex, ctx);
        return /\bhold\b/i.test(text) ? { ...out, transition: 'want_visit' as const } : out;
      },
    };
    const turn = (text: string) =>
      runEngineTurn(
        { convId: 'hold-vs-visit', builderId: 'lokations', text, buyerPhone: '+919999999901', channel: 'advisor_web' },
        deps,
      );
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const r = await turn('hold a 2 bhk for me');
    expect(r.debug.goal.kind).toBe('hold_propose');
    expect(r.state.phase).not.toBe('visit');
    expect(r.reply).toMatch(/reply yes to confirm/i);
  });
});
