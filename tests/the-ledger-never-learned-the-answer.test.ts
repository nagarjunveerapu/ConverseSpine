/**
 * The buyer answered, and the ledger never wrote it down.
 *
 * Desk has carried the whole receiving end since migration 0092: `stamp_prior`
 * on the append door, `buyer_response_intent` / `buyer_rejected_ids_json` /
 * `responded_at` columns, a stamp that is idempotent because it only touches
 * rows where the intent is still NULL, and a `/context` reply that unions every
 * rejected id it was ever told about. Spine has never sent one.
 *
 * So `rejected_project_ids` comes back `[]` on every bootstrap and
 * `awaiting_response` is true forever. The engine DOES know when a buyer turns
 * a project down — `ex.rejected`, `resolveRejected`, and a
 * `discover.rejectedProjectIds` that filters search at some twenty sites — but
 * that list lives in the KV session. When the session rolls it is gone, and the
 * bot offers her the project she already refused.
 *
 * Run against origin/main, the wire test below fails outright (`stamp_prior` is
 * not a field anything sends) and every classifier test fails to import.
 */
import { describe, expect, it } from 'vitest';
import { classifyPriorResponse } from '../src/engine/ledger-write.js';
import { nayadeskCrm } from '../src/engine/adapters/nayadesk.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import type { NayaDeskClient } from '../src/crm/nayadesk-client.js';
import type { Extracted } from '../src/engine/types.js';

const ALPHA = 'p_alpha';
const BETA = 'p_beta';
const GAMMA = 'p_gamma';

/** Minimal shape — only `constraints` is required on Extracted. */
const ex = (over: Partial<Extracted> = {}): Extracted => ({ constraints: {}, ...over });

/** The ordinary case: last turn put two projects on the board. */
const offer = (over: Partial<Parameters<typeof classifyPriorResponse>[0]> = {}) => ({
  priorTurnIndex: 4,
  priorOfferedIds: [ALPHA, BETA],
  priorPendingPrompt: false,
  rejectedBefore: [] as string[],
  rejectedAfter: [] as string[],
  ex: ex(),
  ...over,
});

describe('classifyPriorResponse — reporting what the engine already decided', () => {
  it('stamps the PRIOR turn, not the one being written', () => {
    // Desk keys the stamp on (thread_id, turn_index). Naming this turn would
    // stamp a row that does not exist yet and leave the offer unanswered.
    const out = classifyPriorResponse(offer({ ex: ex({ affirm: true }) }));
    expect(out?.turn_index).toBe(4);
  });

  it('a rejection carries the id the ENGINE bound, not a second reading', () => {
    // `applyExtracted` ran `resolveRejected` against the board she was looking
    // at; the difference across it is what she refused just now.
    const out = classifyPriorResponse(
      offer({ ex: ex({ rejected: true }), rejectedBefore: [], rejectedAfter: [ALPHA] }),
    );
    expect(out).toEqual({ turn_index: 4, response: 'rejected', rejected_ids: [ALPHA] });
  });

  it('never re-reports a rejection from an earlier turn', () => {
    // `discover.rejectedProjectIds` accumulates for the life of the session.
    // Reporting the whole list would stamp this turn with a refusal she made
    // three turns ago, every turn, forever.
    const out = classifyPriorResponse(
      offer({
        ex: ex({ rejected: true }),
        rejectedBefore: [ALPHA],
        rejectedAfter: [ALPHA, BETA],
      }),
    );
    expect(out?.rejected_ids).toEqual([BETA]);
  });

  it('never stamps a turn with a rejection of something it did not offer', () => {
    // She refused Gamma — which this turn never showed her. Recording it
    // against this row would say the offer was refused when it was not.
    const out = classifyPriorResponse(
      offer({ ex: ex({ rejected: true }), rejectedAfter: [GAMMA] }),
    );
    expect(out).toEqual({ turn_index: 4, response: 'rejected', rejected_ids: [] });
  });

  it('a bare "no" is a rejection with nothing named', () => {
    // Real and useful: the offer was declined. Guessing WHICH project would
    // bury one of them in every later search on no evidence at all.
    const out = classifyPriorResponse(offer({ ex: ex({ decline: true }) }));
    expect(out).toEqual({ turn_index: 4, response: 'rejected', rejected_ids: [] });
  });

  it('naming one of the offered projects is acceptance', () => {
    const out = classifyPriorResponse(
      offer({ ex: ex({ namedProjects: [{ projectId: BETA, name: 'Beta' }] as Extracted['namedProjects'] }) }),
    );
    expect(out?.response).toBe('accepted');
  });

  it('naming a project that was NOT offered is not acceptance of this offer', () => {
    // She walked off the board to something else entirely.
    const out = classifyPriorResponse(
      offer({ ex: ex({ namedProjects: [{ projectId: GAMMA, name: 'Gamma' }] as Extracted['namedProjects'] }) }),
    );
    expect(out?.response).toBe('ignored');
  });

  it('"the second one" is acceptance', () => {
    const out = classifyPriorResponse(offer({ ex: ex({ pickOrdinal: 2 }) }));
    expect(out?.response).toBe('accepted');
  });

  it('an ordinal past the end of the board is not acceptance', () => {
    const out = classifyPriorResponse(offer({ ex: ex({ pickOrdinal: 5 }) }));
    expect(out?.response).toBe('ignored');
  });

  it('a new constraint is refinement, and buries nothing', () => {
    // She did not refuse either project; she changed the question. Writing
    // rejected_ids here would permanently hide both from her next search.
    const out = classifyPriorResponse(
      offer({ ex: ex({ constraints: { bhk: '3' } as Extracted['constraints'] }) }),
    );
    expect(out).toEqual({ turn_index: 4, response: 'refined', rejected_ids: [] });
  });

  it('"show me others" is refinement, not rejection', () => {
    const out = classifyPriorResponse(offer({ ex: ex({ transition: 'see_others' }) }));
    expect(out?.response).toBe('refined');
  });

  it('an unrelated question is ignored', () => {
    const out = classifyPriorResponse(offer({ ex: ex({ askTopic: 'rera' as Extracted['askTopic'] }) }));
    expect(out?.response).toBe('ignored');
  });

  it('a turn that offered nothing and asked nothing is NOT stamped', () => {
    // The stamp is what flips `awaiting_response` to false, and Desk hands
    // that flag back so a cold-started session knows whether its pending
    // prompt is still live. Stamping an unanswerable turn retires a question
    // the buyer never got.
    const out = classifyPriorResponse(
      offer({ priorOfferedIds: [], priorPendingPrompt: false, ex: ex({ affirm: true }) }),
    );
    expect(out).toBeUndefined();
  });

  it('a turn that asked a question with no projects IS stamped', () => {
    // "What is your budget?" is answerable, and the answer is worth recording.
    const out = classifyPriorResponse(
      offer({
        priorOfferedIds: [],
        priorPendingPrompt: true,
        ex: ex({ constraints: { budgetMaxInr: 9_000_000 } as Extracted['constraints'] }),
      }),
    );
    expect(out?.response).toBe('refined');
  });

  it('there is nothing behind the first turn', () => {
    const out = classifyPriorResponse(offer({ priorTurnIndex: -1, ex: ex({ affirm: true }) }));
    expect(out).toBeUndefined();
  });
});

describe('the stamp reaches Desk', () => {
  function fakeClient() {
    const appends: Array<Record<string, unknown>> = [];
    return {
      appends,
      client: {
        appendTurnLedger: async (req: Record<string, unknown>) => {
          appends.push(req);
          return { ok: true };
        },
      } as unknown as NayaDeskClient,
    };
  }

  const entry = {
    threadId: 'th_1',
    turnIndex: 5,
    builderId: 'brigade-group',
    buyerPhone: '+919200000001',
    buyerText: 'not that one',
    reply: 'Understood — here are two others.',
    goal: 'recommend',
    tools: [],
    phase: 'discover',
  };

  it('carries stamp_prior onto the wire, in the snake_case Desk parses', async () => {
    // This is the whole bug: every layer below Desk existed and none of them
    // ever put this field on the request.
    const { client, appends } = fakeClient();
    await nayadeskCrm(client).appendTurnLedger({
      ...entry,
      stampPrior: { turn_index: 4, response: 'rejected', rejected_ids: [ALPHA] },
    });
    expect(appends[0]!.stamp_prior).toEqual({
      turn_index: 4,
      response: 'rejected',
      rejected_ids: [ALPHA],
    });
  });

  it('omits the field entirely when there is nothing to stamp', async () => {
    // Desk's stamp is idempotent but it still writes. An empty stamp would
    // retire a question that is still open.
    const { client, appends } = fakeClient();
    await nayadeskCrm(client).appendTurnLedger(entry);
    expect('stamp_prior' in appends[0]!).toBe(false);
  });
});

/**
 * Where the two halves meet.
 *
 * `classifyPriorResponse` reports `ex.rejected`, so anything that clears that
 * flag on the way past silently turns a refusal into "she ignored us" in the
 * durable record. The sole-rejection path in turn.ts rewrites `ex` — it must
 * not clear the one flag the ledger is reading.
 */
describe('a refusal survives all the way to the stamp', () => {
  function depsWithLedgerSpy() {
    const stamps: Array<Record<string, unknown> | undefined> = [];
    const deps = fakeDeps();
    deps.crm = {
      ...deps.crm,
      appendTurnLedger: async (entry: { stampPrior?: Record<string, unknown> }) => {
        stamps.push(entry.stampPrior);
      },
    } as typeof deps.crm;
    return { deps, stamps };
  }

  it('a sole rejection is stamped "rejected", not "ignored"', async () => {
    const { deps, stamps } = depsWithLedgerSpy();
    const t = (text: string) =>
      runEngineTurn(
        { threadId: 'stamp-sole-reject', builderId: 'lokations', text, buyerPhone: '+919999991172', channel: 'whatsapp' },
        deps,
      );
    await t('tell me about Brigade Sanctuary');
    await t('not interested in Brigade Sanctuary');
    const last = stamps.filter(Boolean).at(-1);
    expect(last?.response).toBe('rejected');
  });

  it('and an ordinary question is not', async () => {
    const { deps, stamps } = depsWithLedgerSpy();
    const t = (text: string) =>
      runEngineTurn(
        { threadId: 'stamp-sole-control', builderId: 'lokations', text, buyerPhone: '+919999991173', channel: 'whatsapp' },
        deps,
      );
    await t('tell me about Brigade Sanctuary');
    await t('what is the price');
    const last = stamps.filter(Boolean).at(-1);
    expect(last?.response).not.toBe('rejected');
  });
});
