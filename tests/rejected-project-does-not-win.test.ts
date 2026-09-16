import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { partitionNamedByPolarity } from '../src/engine/project_switch.js';
import { fakeDeps } from './fakes.js';

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
