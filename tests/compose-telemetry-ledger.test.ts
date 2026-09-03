import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLedgerWritePayload } from '../src/engine/ledger-write.js';
import type {
  ThreadState,
  EvidenceSet,
  TurnGoal,
} from '../src/engine/types.js';

/**
 * The engine has computed `llm_used`, `compose_template` and seventeen stage
 * timings on every turn for months, put them in the HTTP debug response, and
 * dropped every one when the response returned. `buildLedgerWritePayload` kept
 * tool latencies and nothing else — so "is the paid composer worth what it
 * costs?" had no production answer at all.
 *
 * Two halves have to hold, and only one of them is arithmetic: the projection
 * must carry the block, AND the one live call site must actually pass it. A
 * suite that tested only the first would stay green while the ledger recorded
 * nothing — which is exactly how `routing_bind` lived in code and in zero rows
 * for 12,036 turns.
 */

const state = {
  threadId: 'c1',
  builderId: 'b1',
  phase: 'focused',
  turnCount: 3,
  constraints: {},
  discover: { lastOffered: [], discussedProjects: [] },
} as unknown as ThreadState;
const goal = { kind: 'answer', topic: 'price' } as TurnGoal;
const evidence = { tools: [] } as unknown as EvidenceSet;
const ex = { constraints: {} };

const build = (compose?: Parameters<typeof buildLedgerWritePayload>[0]['compose']) =>
  buildLedgerWritePayload({ state, ex, goal, evidence, ...(compose ? { compose } : {}) });

describe('the compose lane leaves a durable record', () => {
  it('carries which lane wrote the reply, and what it cost', () => {
    const verify = build({ llm_used: true, compose_ms: 812, total_ms: 1943 }).verify;
    const row = verify.compose as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.llm_used).toBe(true);
    expect(row.compose_ms).toBe(812);
    expect(row.total_ms).toBe(1943);
  });

  it('records the turn that paid and shipped a template anyway', () => {
    // The only failure mode a ledger can show and a per-turn debug response
    // cannot: the paid call was made, then abandoned on timeout or the rate
    // cap, and a voice template went to the buyer. Money spent, template sent.
    const row = build({ llm_used: false, llm_shed: true, template: true }).verify
      .compose as Record<string, unknown>;
    expect(row.llm_shed).toBe(true);
    expect(row.template).toBe(true);
  });

  it('sits beside grounding, so "did paid replies grade better" is one row', () => {
    // Not in resolved_intent: this is a claim about the REPLY, and the thing it
    // gets scored against — grounding, over_answer — is in verify already.
    const payload = build({ llm_used: true });
    expect(payload.verify).toHaveProperty('compose');
    expect(payload.verify).toHaveProperty('grounding');
    expect(payload.resolved_intent).not.toHaveProperty('compose');
    expect(payload.action_plan).not.toHaveProperty('compose');
  });

  it('writes no key at all when the caller had nothing to report', () => {
    expect(build()).not.toHaveProperty('verify.compose');
    expect(build().verify).not.toHaveProperty('compose');
  });

  it('omits the optional flags rather than writing false', () => {
    // A row of `false`s is indistinguishable from a row nobody filled in.
    const row = build({ llm_used: true }).verify.compose as Record<string, unknown>;
    expect(row).not.toHaveProperty('llm_shed');
    expect(row).not.toHaveProperty('template');
  });
});

describe('the wire is live, not just the projection', () => {
  const turnSrc = readFileSync(new URL('../src/engine/turn.ts', import.meta.url), 'utf8');

  it('the one syncTelemetry call site passes the block', () => {
    const call = turnSrc.slice(
      turnSrc.indexOf('await syncTelemetry('),
      turnSrc.indexOf('await syncTelemetry(') + 1200,
    );
    expect(call).toContain('compose:');
    expect(call).toContain('llm_used: llmUsed');
  });

  it('reports the same numbers debug.timings does, off the same locals', () => {
    // If these ever diverge, the ledger and the debug response start telling
    // two different stories about one turn.
    for (const local of ['llmShed', 'composeTemplate', 'composeMs', 'turnStartedMs']) {
      expect(turnSrc).toContain(local);
    }
  });
});
