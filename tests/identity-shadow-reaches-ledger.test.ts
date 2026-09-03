import { describe, expect, it } from 'vitest';
import { makeSemanticNlu } from '../src/engine/adapters/semantic-nlu.js';
import { mergeExtractedAuthority } from '../src/engine/extract-authority.js';
import { buildLedgerWritePayload } from '../src/engine/ledger-write.js';
import type { Env } from '../src/env.js';
import type {
  ThreadState,
  EvidenceSet,
  Extracted,
  TurnGoal,
} from '../src/engine/types.js';

/**
 * The U8 shadow is stamped in one file and read in another, with an authority
 * merge in between that spreads `base` and copies enriched fields BY NAME. A
 * suite that only exercises hybrid-identity.ts would stay green while the row
 * reached the ledger on exactly zero turns — that has happened here before (one
 * noise gate shipped, three copies unit-green, the reply never moved). So this
 * file walks the real adapter and the real merge, and asserts nothing about the
 * arithmetic, which hybrid-identity.test.ts already owns.
 */

const CATALOG = [
  { projectId: 'brigade-eldorado', name: 'Brigade Eldorado' },
  { projectId: 'krishnaja-greens', name: 'Krishnaja Greens' },
  { projectId: 'viva-greens', name: 'Viva Greens' },
];

/** No AI, no Vectorize — the dense lane cannot run, which is the point below. */
const envWithoutVectors = { AI: {} } as unknown as Env;

const ctx = {
  phase: 'discover' as const,
  microMarkets: [],
  catalogNames: CATALOG,
};

const emptyEx: Extracted = { constraints: {} };

describe('the shadow row survives the path from retrieval to the ledger', () => {
  it('is stamped by the real adapter, not just by the pure core', async () => {
    const out = await makeSemanticNlu(envWithoutVectors).enrich(
      'tell me about eldorad',
      'b1',
      emptyEx,
      ctx,
    );
    expect(out.identityShadow).toBeDefined();
    expect(out.identityShadow!.top).toBe('brigade-eldorado');
  });

  it('is stamped on a turn where PROJECT_VECTORS never ran at all', async () => {
    // The gate — not the embedder — is the measured bottleneck, so a shadow
    // that only appeared on gate-approved turns would sample away the very
    // failures U9 is looking for. `dense_ran: false` is what marks them.
    const out = await makeSemanticNlu(envWithoutVectors).enrich(
      'tell me about eldorad',
      'b1',
      emptyEx,
      ctx,
    );
    expect(out.identityShadow!.dense_ran).toBe(false);
    expect(out.identityShadow!.dense_rank).toBeNull();
    expect(out.identityShadow!.lexical_rank).toBe(1);
  });

  it('survives mergeExtractedAuthority, which spreads base and drops the rest', async () => {
    const enriched = await makeSemanticNlu(envWithoutVectors).enrich(
      'tell me about eldorad',
      'b1',
      emptyEx,
      ctx,
    );
    const merged = mergeExtractedAuthority({ constraints: {} }, enriched);
    expect(merged.identityShadow).toEqual(enriched.identityShadow);
  });

  it('does not change what the turn resolves', async () => {
    // Shadow only. If this ever fails, the shadow has started deciding.
    const before: Extracted = { constraints: {}, askTopic: 'price' };
    const after = await makeSemanticNlu(envWithoutVectors).enrich(
      'tell me about eldorad',
      'b1',
      before,
      ctx,
    );
    const { identityShadow: _shadow, ...rest } = after;
    expect(rest).toEqual(before);
  });

  it('is absent, not empty, when the tenant has no catalog to judge against', async () => {
    const out = await makeSemanticNlu(envWithoutVectors).enrich('tell me about eldorad', 'b1', emptyEx, {
      ...ctx,
      catalogNames: [],
    });
    expect(out.identityShadow).toBeUndefined();
  });
});

describe('the ledger projection actually carries it', () => {
  const state = {
    threadId: 'c1',
    builderId: 'b1',
    phase: 'discover',
    turnCount: 1,
    constraints: {},
    discover: { lastOffered: [], discussedProjects: [] },
  } as unknown as ThreadState;
  const goal = { kind: 'answer', topic: 'overview' } as TurnGoal;
  const ev = { tools: [] } as unknown as EvidenceSet;

  const payloadFor = async (namedProjects?: Extracted['namedProjects']) => {
    const enriched = await makeSemanticNlu(envWithoutVectors).enrich(
      'tell me about eldorad',
      'b1',
      emptyEx,
      ctx,
    );
    const ex = mergeExtractedAuthority({ constraints: {} }, enriched);
    return buildLedgerWritePayload({
      state,
      ex: { ...ex, ...(namedProjects ? { namedProjects } : {}) },
      goal,
      evidence: ev,
    });
  };

  it('survives the resolved_intent projection', async () => {
    // `resolved_intent` is hand-picked field by field. `routing_bind` once
    // existed in code and in NO ledger row for 12,036 turns for exactly this
    // reason — a shadow that never lands measures nothing.
    const payload = await payloadFor();
    const row = payload.resolved_intent.identity_shadow as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.top).toBe('brigade-eldorado');
    expect(row.dense_ran).toBe(false);
  });

  it('scores itself against what bound, not against what was proposed', async () => {
    // The two must come off the same row: `shipped` here and `named_projects`
    // one field up are read from one `ex`, after the merge and the scrub.
    const payload = await payloadFor([{ projectId: 'viva-greens', name: 'Viva Greens' }]);
    const row = payload.resolved_intent.identity_shadow as Record<string, unknown>;
    expect(row.shipped).toEqual(['viva-greens']);
    expect(payload.resolved_intent.named_projects).toEqual(['viva-greens:Viva Greens']);
    // And it is free to disagree — that disagreement is the measurement.
    expect(row.top).toBe('brigade-eldorado');
  });

  it('writes no key at all when there was no shadow', async () => {
    const payload = buildLedgerWritePayload({
      state,
      ex: { constraints: {} },
      goal,
      evidence: ev,
    });
    expect(payload.resolved_intent).not.toHaveProperty('identity_shadow');
  });
});
