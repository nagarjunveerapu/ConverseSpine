import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { partitionNamedByPolarity } from '../src/engine/project_switch.js';
import { initState, resolvePick } from '../src/engine/state.js';
import { fakeDeps } from './fakes.js';
import type { ThreadState } from '../src/engine/types.js';

/**
 * "No, forget Avalon completely. I only want Brigade Meadows."
 *
 * The bot answered about Avalon.
 *
 * Both of the sentences below are the shape of rows in NayaDesk dev's
 * `turn_ledger`, and both failed the same way. They name two projects, so they
 * tripped the rule that two named projects mean a comparison; the comparison
 * then found the FOCUSED project among the two and held it — and the project it
 * held was the one the buyer had just pushed away. `hold_miss` was the largest
 * recorded defect on dev, at 0.53–0.67.
 *
 * The extractor could not have helped. `negatesShown` is turn-level: any
 * negation word anywhere in the sentence, plus any project name, makes the whole
 * turn a rejection. It knew a rejection had happened. It could not know which of
 * the two projects it landed on, because that is a fact about a CLAUSE.
 *
 * Catalog names here are the fake's own Brigade siblings — the dev rows named
 * Avalon and Meadows, which this builder does not have.
 */

const SANCTUARY = { projectId: 'sanctuary', name: 'Brigade Sanctuary' };
const ORCHARDS = { projectId: 'orchards', name: 'Brigade Orchards' };
const BOTH = [SANCTUARY, ORCHARDS];

describe('a rejection lands on a clause, not on the turn', () => {
  it('"No, forget X completely. I only want Y." wants Y and rejects X', () => {
    const r = partitionNamedByPolarity(
      'No, forget Brigade Sanctuary completely. I only want Brigade Orchards.',
      BOTH,
    );
    expect(r.wanted.map((p) => p.projectId)).toEqual(['orchards']);
    expect(r.rejected.map((p) => p.projectId)).toEqual(['sanctuary']);
  });

  it('"I am not interested in X, show me Y." wants Y and rejects X', () => {
    const r = partitionNamedByPolarity(
      'I am not interested in Brigade Sanctuary, show me Brigade Orchards.',
      BOTH,
    );
    expect(r.wanted.map((p) => p.projectId)).toEqual(['orchards']);
    expect(r.rejected.map((p) => p.projectId)).toEqual(['sanctuary']);
  });

  it('a negative word is not a rejection — what matters is what it governs', () => {
    // "no" sits in the same clause as Orchards. A rule that tested for negation
    // anywhere would push Orchards away; the buyer is asking about its
    // amenities. Rejection needs a verb of preference, not a "not".
    const r = partitionNamedByPolarity(
      'is there no clubhouse at Brigade Orchards, and what about Brigade Sanctuary?',
      BOTH,
    );
    expect(r.rejected).toEqual([]);
    expect(r.wanted.map((p) => p.projectId)).toEqual(['sanctuary', 'orchards']);
  });

  it('a genuine comparison is left alone', () => {
    const r = partitionNamedByPolarity('compare Brigade Sanctuary and Brigade Orchards', BOTH);
    expect(r.rejected).toEqual([]);
    expect(r.wanted).toHaveLength(2);
  });

  // ---------------------------------------------------------------------
  // These two assertions used to read the other way, on the stated premise
  // that `ex.rejected` already carried a sole rejection. Driven against the
  // real catalog on dev, it does not — see the header of
  // `partitionNamedByPolarity`. The premise was wrong, so the assertions are
  // now what the buyer actually needs.
  // ---------------------------------------------------------------------

  it('rejecting every project named leaves nothing wanted', () => {
    const r = partitionNamedByPolarity(
      'not interested in Brigade Sanctuary, not interested in Brigade Orchards',
      BOTH,
    );
    expect(r.rejected).toHaveLength(2);
    expect(r.wanted).toEqual([]);
  });

  it('one name pushed away is a rejection, not a mention', () => {
    const r = partitionNamedByPolarity('forget Brigade Sanctuary', [SANCTUARY]);
    expect(r.rejected).toEqual([SANCTUARY]);
    expect(r.wanted).toEqual([]);
  });

  it('the two sentences dev answered backwards, with one project on the board', () => {
    // Both observed live on 16 Sep 2026 against brigade-group, Avalon the only
    // project offered. The first arrived with `ex.rejected` FALSE and was bound
    // as focus — the bot pitched the project she had just refused.
    for (const text of ['not interested in Brigade Sanctuary', 'no, Brigade Sanctuary is not for me']) {
      const r = partitionNamedByPolarity(text, [SANCTUARY]);
      expect(r.rejected, text).toEqual([SANCTUARY]);
      expect(r.wanted, text).toEqual([]);
    }
  });

  it('a lone name with no rejecting verb is left completely alone', () => {
    // The control that keeps the widening honest: same single-name shape, no
    // rejection in it. Nothing may be pushed away here.
    for (const text of ['tell me about Brigade Sanctuary', 'is there no clubhouse at Brigade Sanctuary']) {
      const r = partitionNamedByPolarity(text, [SANCTUARY]);
      expect(r.rejected, text).toEqual([]);
      expect(r.wanted, text).toHaveLength(1);
    }
  });
});

/** The wiring: the same two sentences, through a real turn. */
describe('the project she rejected does not win the bind', () => {
  const thread = (id: string) => {
    const deps = fakeDeps();
    return (text: string) =>
      runEngineTurn(
        { threadId: id, builderId: 'lokations', text, buyerPhone: '+919999991170', channel: 'whatsapp' },
        deps,
      );
  };

  it('"No, forget Brigade Sanctuary completely. I only want Brigade Orchards."', async () => {
    const turn = thread('reject-then-want');
    await turn('tell me about Brigade Sanctuary');
    const r = await turn('No, forget Brigade Sanctuary completely. I only want Brigade Orchards.');

    expect(r.state.focus?.projectId).toBe('orchards');
    expect(r.reply).toMatch(/Brigade Orchards/);
    // The reply used to open "Brigade Sanctuary: Sarjapur Road, from ₹79 L".
    expect(r.reply).not.toMatch(/Brigade Sanctuary/);
  });

  it('"I am not interested in Brigade Sanctuary, show me Brigade Orchards."', async () => {
    const turn = thread('not-interested');
    await turn('tell me about Brigade Sanctuary');
    const r = await turn('I am not interested in Brigade Sanctuary, show me Brigade Orchards.');

    expect(r.state.focus?.projectId).toBe('orchards');
    expect(r.reply).toMatch(/Brigade Orchards/);
    expect(r.reply).not.toMatch(/Brigade Sanctuary/);
  });

  it('and it is not a comparison — she named two, she asked about one', async () => {
    const turn = thread('not-a-compare');
    await turn('tell me about Brigade Sanctuary');
    const r = await turn('No, forget Brigade Sanctuary completely. I only want Brigade Orchards.');
    expect(r.debug.goal.kind).toBe('answer');
    expect(JSON.stringify(r.debug.goal)).not.toMatch(/compare/i);
  });

  it('the rejected project is recorded, so the board stops offering it', async () => {
    const turn = thread('rejected-recorded');
    await turn('tell me about Brigade Sanctuary');
    const r = await turn('No, forget Brigade Sanctuary completely. I only want Brigade Orchards.');
    expect(r.state.discover.rejectedProjectIds).toContain('sanctuary');
  });

  it('a real comparison still holds its focus', async () => {
    const turn = thread('real-compare');
    await turn('tell me about Brigade Sanctuary');
    const r = await turn('compare Brigade Sanctuary and Brigade Orchards');
    expect(r.state.focus?.projectId).toBe('sanctuary');
    expect(r.state.discover.rejectedProjectIds).not.toContain('sanctuary');
  });

  it('a question containing "no" drops neither project', async () => {
    const turn = thread('no-clubhouse');
    await turn('tell me about Brigade Sanctuary');
    const r = await turn(
      'is there no clubhouse at Brigade Orchards, and what about Brigade Sanctuary?',
    );
    expect(r.state.discover.rejectedProjectIds).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // One project on the board, and she refuses it. Observed on dev 16 Sep 2026
  // against brigade-group with Avalon the only project offered: the bot read
  // the refusal as interest and pitched the project straight back at her.
  // -----------------------------------------------------------------------

  it('"not interested in Brigade Sanctuary" does not pitch Brigade Sanctuary', async () => {
    const turn = thread('sole-not-interested');
    await turn('tell me about Brigade Sanctuary');
    const r = await turn('not interested in Brigade Sanctuary');
    // The live bot answered: "*Brigade Avalon* — Bengaluru Urban. 2 BHK Test ·
    // from ₹95 L ... Want pricing details?" — the project she had just refused.
    // It now asks which area she wants instead of pitching the refused project.
    expect(r.reply).not.toMatch(/Brigade Sanctuary/);
    expect(r.state.discover.rejectedProjectIds).toContain('sanctuary');
  });

  it('"no, Brigade Sanctuary is not for me" records the refusal', async () => {
    // This one DID set decline, and still bound no id: `resolveRejected` reads
    // only `ex.rejectedName`, which nothing had filled. The board kept offering it.
    const turn = thread('sole-not-for-me');
    await turn('tell me about Brigade Sanctuary');
    const r = await turn('no, Brigade Sanctuary is not for me');
    expect(r.state.discover.rejectedProjectIds).toContain('sanctuary');
  });

  it('a sole refusal does not silently become a different project', async () => {
    const turn = thread('sole-no-substitute');
    await turn('tell me about Brigade Sanctuary');
    const r = await turn('not interested in Brigade Sanctuary');
    expect(r.state.focus?.projectId).not.toBe('sanctuary');
  });

  it('the control: naming it WITHOUT a refusal still binds it', async () => {
    // Proves the single-name path was widened for rejections only.
    const turn = thread('sole-control');
    const r = await turn('tell me about Brigade Sanctuary');
    expect(r.state.focus?.projectId).toBe('sanctuary');
    expect(r.state.discover.rejectedProjectIds).toEqual([]);
  });
});

/**
 * Clearing the name off the turn was not enough.
 *
 * On dev the board held exactly one apartment. She said "not interested in
 * Brigade Avalon" and the reply was "*Brigade Avalon* — 2 BHK Test, from ₹95 L.
 * Want pricing details?" — because `offered.length === 1` hands the only project
 * on the board back to ANY implicit signal, with nothing consulted about whether
 * she had just refused it.
 */
describe('a refused project is never picked for her', () => {
  const AVALON = { projectId: 'avalon', name: 'Brigade Avalon' };
  const board = [AVALON];
  const withRefusal = (ids: string[]): ThreadState => {
    const s = initState('pick-guard', 'brigade-group');
    return { ...s, discover: { ...s.discover, rejectedProjectIds: ids } };
  };

  it('the only project on the board is not handed back after a refusal', () => {
    expect(resolvePick({ constraints: {}, implicitProjectPick: true }, board, withRefusal(['avalon']))).toBeNull();
  });

  it('control — with no refusal on file, the sole board project is still picked', () => {
    expect(resolvePick({ constraints: {}, implicitProjectPick: true }, board, withRefusal([]))?.projectId).toBe('avalon');
  });

  it('"tell me more" does not reopen a refused project either', () => {
    expect(resolvePick({ constraints: {}, transition: 'want_details' }, board, withRefusal(['avalon']))).toBeNull();
  });

  it('nor does a bare yes to an offer prompt', () => {
    const s = withRefusal(['avalon']);
    const armed = { ...s, rti: { pendingPrompt: { kind: 'offer_project' as const } } } as ThreadState;
    expect(resolvePick({ constraints: {}, affirm: true }, board, armed)).toBeNull();
  });

  it('but naming it again DOES reopen it — she is allowed to change her mind', () => {
    const picked = resolvePick(
      { constraints: {}, namedProjects: [AVALON] },
      board,
      withRefusal(['avalon']),
    );
    expect(picked?.projectId).toBe('avalon');
  });

  it('and so does picking it by position', () => {
    const picked = resolvePick({ constraints: {}, pickOrdinal: 1 }, board, withRefusal(['avalon']));
    expect(picked?.projectId).toBe('avalon');
  });
});

/**
 * And clearing it off the turn was STILL not enough.
 *
 * `[POL2] {"standing":false,"wanted":[],"rej":["brigade-avalon"]}` — the
 * partition ran on dev and did exactly what it was asked. Twelve hundred lines
 * later the same turn reported
 * `[GOALPROBE] {"goal":{"kind":"answer","projectId":"brigade-avalon"},
 * "named":["brigade-avalon"],"focus":"brigade-avalon"}`.
 *
 * Between the two sits the cold catalog resolve, which fires precisely WHEN
 * `ex.namedProjects` is empty and matches catalog names against the raw
 * sentence. Emptying the field is the condition that wakes it, and the sentence
 * it re-reads still holds the name. The fix could not be a better partition; it
 * had to be asking the same polarity question of the name the cold resolve
 * hands back — and of the copy it keeps for the cold-name door near the goal.
 */
describe('the cold catalog resolve cannot hand a refused name back', () => {
  // `failureSearch` is the flag dev runs with, and the cold catalog resolve
  // sits behind it — with the plain fake the block never executes at all and
  // the assertions below pass without testing anything.
  const cold = (id: string) => {
    const deps = { ...fakeDeps(), failureSearch: true };
    return (text: string) =>
      runEngineTurn(
        { threadId: id, builderId: 'lokations', text, buyerPhone: '+919999991174', channel: 'whatsapp' },
        deps,
      );
  };

  it('a refusal that is the FIRST thing she says opens nothing', async () => {
    // No prior turn, so no board and no focus: the only thing that can bind
    // this name is the cold resolve reading the sentence itself.
    const r = await cold('cold-refusal')('not interested in Brigade Sanctuary');
    expect(r.state.focus?.projectId).not.toBe('sanctuary');
    expect(r.reply).not.toMatch(/Brigade Sanctuary/);
  });

  it('and it is recorded, so later search will not offer it', async () => {
    const r = await cold('cold-refusal-recorded')('not interested in Brigade Sanctuary');
    expect(r.state.discover.rejectedProjectIds).toContain('sanctuary');
  });

  it('a refusal that is also a question opens nothing either', async () => {
    // "what else" makes this a question, which is the shape the cold-name door
    // near the goal decide waits for: no focus, an empty board, a catalog name
    // in the text. It reads a hit of its OWN, so clearing `ex.namedProjects`
    // above does not reach it.
    const r = await cold('cold-refusal-question')(
      'not interested in Brigade Sanctuary, what else do you have?',
    );
    expect(r.state.focus?.projectId).not.toBe('sanctuary');
    expect(r.state.discover.rejectedProjectIds).toContain('sanctuary');
  });

  it('the control: the same cold name WITHOUT a refusal still opens it', async () => {
    // Proves the cold resolve is intact — only the refusal is being declined.
    const r = await cold('cold-control')('tell me about Brigade Sanctuary');
    expect(r.state.focus?.projectId).toBe('sanctuary');
  });
});

/**
 * A negation with no verb behind it.
 *
 * "not Brigade Avalon, show me Brigade Eldorado" was answered on dev with a
 * side-by-side of Avalon and Eldorado. `REJECTING_CLAUSE` requires a verb of
 * preference — deliberately, because "is there no clubhouse at Sanctuary" must
 * not bury Sanctuary — and this sentence has none. What it has is adjacency:
 * the "not" sits directly on the name.
 */
describe('a negation directly on the name is a rejection', () => {
  it('"not X, show me Y" wants Y and rejects X', () => {
    const r = partitionNamedByPolarity('not Brigade Sanctuary, show me Brigade Orchards', BOTH);
    expect(r.wanted.map((p) => p.projectId)).toEqual(['orchards']);
    expect(r.rejected.map((p) => p.projectId)).toEqual(['sanctuary']);
  });

  it('a brand word may stand between the negation and the name', () => {
    const r = partitionNamedByPolarity('no Brigade Sanctuary please, Brigade Orchards instead', BOTH);
    expect(r.rejected.map((p) => p.projectId)).toEqual(['sanctuary']);
  });

  it('but a negation governing something ELSE in the clause is not a rejection', () => {
    // The floor this rule must not break: "no" lands on the amenity, not on
    // the project, and the buyer is asking a question about it.
    const r = partitionNamedByPolarity(
      'is there no clubhouse at Brigade Orchards, and what about Brigade Sanctuary?',
      BOTH,
    );
    expect(r.rejected).toEqual([]);
  });

  it('and a bare mention with no negation at all is untouched', () => {
    const r = partitionNamedByPolarity('Brigade Sanctuary and Brigade Orchards', BOTH);
    expect(r.rejected).toEqual([]);
    expect(r.wanted).toHaveLength(2);
  });

  it('the switch does not come back as a comparison', async () => {
    const deps = { ...fakeDeps(), failureSearch: true };
    const turn = (text: string) =>
      runEngineTurn(
        { threadId: 'bare-negation-switch', builderId: 'lokations', text, buyerPhone: '+919999991175', channel: 'whatsapp' },
        deps,
      );
    await turn('show me homes');
    const r = await turn('not Brigade Sanctuary, show me Brigade Orchards');
    expect(r.state.discover.rejectedProjectIds).toContain('sanctuary');
    expect(r.reply).not.toMatch(/Side-by-side|vs Brigade/i);
  });
});

/**
 * And the reply must not name it back to her.
 *
 * Dev, after the binds above were all closed:
 *
 *   > not interested in Brigade Avalon
 *   "I've only got *Brigade Avalon* in *Bengaluru Urban* for apartments.
 *    Nearby: Brigade Eldorado ...; Brigade Cornerstone ...; Brigade Orchards ..."
 *
 * The goal was right — `recommend`, with the alternatives — but the locality
 * widen still led on `currentShortlist(s)[0]`, which is the board from the
 * previous turn, which is the project she had just refused. Sarjapur holds
 * exactly one apartment in the fake, which is the same shape.
 */
describe('a refused project is not the exact fit we lead with', () => {
  const turn = (id: string) => {
    const deps = { ...fakeDeps(), failureSearch: true };
    return (text: string) =>
      runEngineTurn(
        { threadId: id, builderId: 'lokations', text, buyerPhone: '+919999991176', channel: 'whatsapp' },
        deps,
      );
  };

  it('the widen does not lead with the project she just turned down', async () => {
    // Devanahalli holds exactly one apartment in the fake, which is the shape
    // dev was in: the board's head IS the refused project.
    const t = turn('widen-after-refusal');
    const first = await t('show me 2 BHK apartments in Devanahalli under 1 crore');
    expect(first.reply).toMatch(/only match I have in \*Devanahalli\*/);
    const r = await t('not interested in Brigade Cornerstone');
    expect(r.state.discover.rejectedProjectIds).toContain('cornerstone');
    expect(r.reply).not.toMatch(/Brigade Cornerstone/);
    // And it still answers: what it DOES have, where.
    expect(r.reply).toMatch(/North Bangalore|Sarjapur/);
  });

  it('the control: with no refusal, the widen still names the one exact fit', async () => {
    const t = turn('widen-control');
    const r = await t('show me 2 BHK apartments in Devanahalli under 1 crore');
    expect(r.reply).toMatch(/\*Brigade Cornerstone\* is the only match I have/);
  });
});
