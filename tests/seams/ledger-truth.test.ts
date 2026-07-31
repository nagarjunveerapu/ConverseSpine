/**
 * Phase 0a — the ledger must not report success it did not observe.
 *
 * Today every row claims the turn went well:
 *
 *   ledger-write.ts   tool_runs[].success = true          hardcoded
 *   nayadesk.ts:907   engine_status       = 'ok'          hardcoded
 *   journey-signals   projects_compared   = max(…, 2)     floored
 *
 * and every Desk adapter is `catch { return null }`. So a turn where `pricing`
 * returned nothing is indistinguishable from one where it returned a cost
 * sheet. That is the instrument every later phase is measured through, and it
 * is why this session cost a 30,000-line read instead of a query.
 *
 * SCOPE. 0a records what is OBSERVABLE without changing the port: whether each
 * tool actually produced evidence. It deliberately does NOT claim to separate
 * "the project has no price" from "the price fetch failed" — that needs the
 * result wrappers in 0b. Reporting `produced_evidence` is honest; reporting
 * `success` for a legitimate FAQ miss would be a new lie in place of the old one.
 */
import { describe, expect, it } from 'vitest';
import { buildLedgerWritePayload } from '../../src/engine/ledger-write.js';
import { buildJourneySignalPost } from '../../src/engine/journey-signals.js';
import { initState } from '../../src/engine/state.js';
import type { EvidenceSet, TurnGoal } from '../../src/engine/types.js';

const base = (evidence: EvidenceSet, goal: TurnGoal = { kind: 'answer', topic: 'price', projectId: 'p1' }) =>
  buildLedgerWritePayload({
    state: initState('c1', 'naya-advisor'),
    ex: { constraints: {} },
    goal,
    evidence,
  });

describe('tool runs record what was observed, not an assumption', () => {
  it('a tool that produced evidence is marked as having produced it', () => {
    const p = base({
      tools: ['pricing'],
      pricing: { projectName: 'Brigade Eldorado', components: [{ label: 'BSP', value: '₹9,000/sqft' }] },
    });
    expect(p.tool_runs.find((t) => t.name === 'pricing')?.produced_evidence).toBe(true);
  });

  it('a tool that ran and produced nothing is not recorded as if it had', () => {
    // The live shape: adapters swallow the failure and return null, so `tools`
    // still lists the call while the evidence slot stays empty.
    const p = base({ tools: ['pricing'] });
    expect(p.tool_runs.find((t) => t.name === 'pricing')?.produced_evidence).toBe(false);
  });

  it('an explicit faq miss is visible as a miss', () => {
    const p = base({ tools: ['faqLookup'], faqMiss: { keys: ['rental_yield'] } });
    expect(p.tool_runs.find((t) => t.name === 'faqLookup')?.produced_evidence).toBe(false);
  });

  it('does not overclaim: produced_evidence is not the same as success', () => {
    // A legitimate absence and a transport failure both read false here. That
    // distinction belongs to 0b's result wrappers; pretending to have it now
    // would replace one lie with another.
    const p = base({ tools: ['faqLookup'], faqMiss: { keys: ['lifts'] } });
    const run = p.tool_runs.find((t) => t.name === 'faqLookup')!;
    expect(run).not.toHaveProperty('success', true);
  });
});

describe('Phase 0a — ledger promotes understanding fields', () => {
  it('records named_projects as id:name and full extract_provenance', () => {
    const p = buildLedgerWritePayload({
      state: initState('c1', 'naya-advisor'),
      ex: {
        constraints: {},
        namedProjects: [{ projectId: 'brigade-eldorado', name: 'Brigade Eldorado' }],
      },
      goal: { kind: 'answer', topic: 'price', projectId: 'brigade-eldorado' },
      evidence: { tools: [] },
      extractProvenance: {
        path: 'free_text_funnel',
        fields: { askTopics: 'regex' },
        routing_bind: { bind_source: 'embed_intent', embed_fired: true, top_kind: 'get_price', top_score: 0.9 },
      },
    });
    expect(p.resolved_intent.named_projects).toEqual(['brigade-eldorado:Brigade Eldorado']);
    expect(p.resolved_intent.extract_provenance).toMatchObject({
      path: 'free_text_funnel',
      routing_bind: { top_kind: 'get_price' },
    });
  });
});

describe('journey signals do not invent a comparison', () => {
  it('reports the real count, with no floor of two', () => {
    const s = initState('c1', 'naya-advisor');
    s.discover.discussedProjects = [{ projectId: 'a', name: 'Ayana' }];
    const post = buildJourneySignalPost(
      { kind: 'answer', topic: 'compare', projectId: 'a' },
      s,
      { tools: [] },
    );
    expect(post.signals.projects_compared).not.toBe(2);
  });

  it('a real two-project compare still reports two', () => {
    const s = initState('c1', 'naya-advisor');
    s.discover.discussedProjects = [
      { projectId: 'a', name: 'Ayana' },
      { projectId: 'b', name: 'Vanam' },
    ];
    const post = buildJourneySignalPost(
      { kind: 'answer', topic: 'compare', projectId: 'a' },
      s,
      { tools: [] },
    );
    expect(post.signals.projects_compared).toBe(2);
  });
});
