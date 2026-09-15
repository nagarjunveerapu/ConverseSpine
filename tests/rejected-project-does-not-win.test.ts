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

  it('a bare rejection with nothing left standing keeps its existing path', () => {
    // Everything rejected and nothing wanted is just "no" — `ex.rejected` already
    // answers that, and this must not quietly empty namedProjects underneath it.
    const r = partitionNamedByPolarity(
      'not interested in Brigade Sanctuary, not interested in Brigade Orchards',
      BOTH,
    );
    expect(r.rejected).toEqual([]);
    expect(r.wanted).toHaveLength(2);
  });

  it('one name is never a choice between two', () => {
    const r = partitionNamedByPolarity('forget Brigade Sanctuary', [SANCTUARY]);
    expect(r.rejected).toEqual([]);
    expect(r.wanted).toHaveLength(1);
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
});
