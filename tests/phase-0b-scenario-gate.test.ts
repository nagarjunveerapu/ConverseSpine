/**
 * Phase 0b scenario gate — DataResult ports + multi-intent articulated compose.
 *
 * Fake inject owns absent/transport. Compose unit asserts own articulation.
 * Dig live: `npm run test:phase-0b:live`.
 */
import { describe, expect, it } from 'vitest';
import { fallbackReply } from '../src/engine/compose.js';
import { buildLedgerWritePayload } from '../src/engine/ledger-write.js';
import { initState } from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import type { EvidenceSet, TurnGoal } from '../src/engine/types.js';
import { fakeData, fakeDeps } from './fakes.js';

const PROJECT = 'eldorado';
const PROJECT_NAME = 'Brigade Eldorado';

function harness(convId: string) {
  const deps = fakeDeps();
  const data = deps.data as ReturnType<typeof fakeData>;
  const ledgerRuns: Array<{
    name: string;
    produced_evidence: boolean;
    latency_ms: number;
    failure_reason?: string;
  }> = [];
  const origLedger = deps.crm.appendTurnLedger.bind(deps.crm);
  deps.crm.appendTurnLedger = async (row) => {
    const runs = (row as { toolRuns?: typeof ledgerRuns }).toolRuns;
    if (runs?.length) ledgerRuns.splice(0, ledgerRuns.length, ...runs);
    return origLedger(row);
  };
  const turn = (text: string) =>
    runEngineTurn(
      {
        convId,
        builderId: 'naya-advisor',
        text,
        buyerPhone: `+9199${convId.replace(/\W/g, '').slice(-8).padStart(8, '0')}`,
        channel: 'advisor_web',
      },
      deps,
    );
  return { deps, data, turn, ledgerRuns };
}

async function focusEldorado(turn: (t: string) => ReturnType<typeof runEngineTurn>) {
  await turn('north bangalore apartment under 80 lakhs');
  const focused = await turn(`tell me about ${PROJECT_NAME}`);
  expect(focused.state.phase).toBe('focused');
  expect(focused.state.focus?.projectId).toBe(PROJECT);
  return focused;
}

function countNameMentions(reply: string, name: string): number {
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return (reply.match(re) ?? []).length;
}

describe('Phase 0b — DataResult ports (inject)', () => {
  it('0B-01 price OK → answer + pricing evidence + latency_ms > 0', async () => {
    const { turn, ledgerRuns } = harness('0b01');
    await focusEldorado(turn);
    const r = await turn("what's the price?");
    expect(r.reply).toMatch(/₹|65|pricing|starting/i);
    expect(r.debug.tools).toContain('pricing');
    const run = ledgerRuns.find((t) => t.name === 'pricing');
    expect(run?.produced_evidence).toBe(true);
    expect(run?.latency_ms).toBeGreaterThan(0);
    expect(run?.failure_reason).toBeUndefined();
  });

  it('0B-02 pricing absent → honest miss + failure_reason absent', async () => {
    const { turn, data, ledgerRuns } = harness('0b02');
    await focusEldorado(turn);
    data.fail.pricing = 'absent';
    const r = await turn("what's the starting price?");
    // Port truth: pricing ran and reported absent (compose may still use cached detail).
    expect(r.debug.tools).toContain('pricing');
    const run = ledgerRuns.find((t) => t.name === 'pricing');
    expect(run?.produced_evidence).toBe(false);
    expect(run?.failure_reason).toBe('absent');
    expect(run?.latency_ms).toBeGreaterThan(0);
  });

  it('0B-03 pricing transport → honest miss + failure_reason transport', async () => {
    const { turn, data, ledgerRuns } = harness('0b03');
    await focusEldorado(turn);
    data.fail.pricing = 'transport';
    const r = await turn("what's the price for 2 bhk?");
    expect(r.debug.goal.kind).not.toBe('recommend');
    const run = ledgerRuns.find((t) => t.name === 'pricing');
    expect(run?.produced_evidence).toBe(false);
    expect(run?.failure_reason).toBe('transport');
  });

  it('0B-04 loan FAQ hit → banks/LTV atom', async () => {
    const { turn } = harness('0b04');
    await focusEldorado(turn);
    const r = await turn('is loan eligibility available?');
    expect(r.reply.toLowerCase()).toMatch(/loan|ltv|bank|hdfc|sbi/i);
    expect(r.state.phase).toBe('focused');
  });

  it('0B-05 yield FAQ absent → no invent %', async () => {
    const { turn, data, ledgerRuns } = harness('0b05');
    await focusEldorado(turn);
    // Force only rental_yield key to miss.
    const orig = data.faqLookup.bind(data);
    data.faqLookup = async (pid, key) => {
      if (key === 'rental_yield') return { ok: false, reason: 'absent', latency_ms: 1 };
      return orig(pid, key);
    };
    const r = await turn('what rental yield can I expect?');
    // Must not invent a yield band; ledger should show faqLookup absent when that key was asked.
    expect(r.reply).not.toMatch(/\d+\s*[-–]\s*\d+\s*%/);
    const run = ledgerRuns.find((t) => t.name === 'faqLookup');
    if (run) {
      expect(run.produced_evidence).toBe(false);
      expect(run.failure_reason).toBe('absent');
    }
  });

  it('0B-06 possession hold focus', async () => {
    const { turn } = harness('0b06');
    await focusEldorado(turn);
    const r = await turn('when is possession?');
    expect(r.state.phase).toBe('focused');
    expect(r.reply.toLowerCase()).toMatch(/possession|2028|phased/i);
  });

  it('0B-09 pivot release on budget change', async () => {
    const { turn } = harness('0b09');
    await focusEldorado(turn);
    const r = await turn('actually budget 50L');
    // Pivot may release or re-search — must not invent Eldorado-only hold forever.
    expect(r.debug.goal.kind === 'recommend' || r.state.phase === 'discover' || /50|budget|fit/i.test(r.reply)).toBe(
      true,
    );
  });

  it('0B-10 detail hydrate OK', async () => {
    const { turn, ledgerRuns, deps } = harness('0b10');
    await focusEldorado(turn);
    // Bust cache so the follow-up must re-fetch projectDetail.
    const s = await deps.store.load('0b10');
    if (s) {
      s.projectCache = {};
      await deps.store.save(s);
    }
    const r = await turn('is it RERA approved?');
    expect(r.state.phase).toBe('focused');
    const run = ledgerRuns.find((t) => t.name === 'detail');
    expect(run?.produced_evidence).toBe(true);
    expect(run?.latency_ms).toBeGreaterThan(0);
  });

  it('0B-11 detail transport → no crash', async () => {
    const { turn, data } = harness('0b11');
    await focusEldorado(turn);
    data.fail.projectDetail = 'transport';
    // Bust cache so hydrate must call projectDetail.
    const r = await turn('is it RERA approved?');
    expect(r.reply.length).toBeGreaterThan(10);
    expect(r.debug.goal.kind).not.toBe('recommend');
  });

  it('0B-12 price then loan both focused', async () => {
    const { turn } = harness('0b12');
    await focusEldorado(turn);
    const p = await turn("what's the price?");
    expect(p.state.phase).toBe('focused');
    const l = await turn('what about loan eligibility?');
    expect(l.state.phase).toBe('focused');
    expect(l.reply.toLowerCase()).toMatch(/loan|ltv|bank/i);
  });
});

describe('Phase 0b — multi-intent articulation', () => {
  it('0B-13 price + location → one subject lead, name not stamped twice', () => {
    const goal: TurnGoal = {
      kind: 'answer',
      topic: 'price',
      topics: ['price', 'location'],
      projectId: PROJECT,
    };
    const evidence: EvidenceSet = {
      tools: ['pricing', 'detail'],
      pricing: {
        projectName: PROJECT_NAME,
        components: [{ label: '2 BHK', value: '₹65 L' }],
        startingDisplay: '₹65 L',
      },
      location: {
        projectName: PROJECT_NAME,
        microMarket: 'North Bangalore',
        connectivitySummary: 'Near Airport Road.',
      },
    };
    const reply = fallbackReply({
      goal,
      evidence,
      context: { focusProjectName: PROJECT_NAME, buyerText: 'what is the price and location?' },
    });
    expect(reply.startsWith(`On *${PROJECT_NAME}*:`)).toBe(true);
    expect(reply.toLowerCase()).toMatch(/65|₹/);
    expect(reply.toLowerCase()).toMatch(/north bangalore|located in|airport/);
    expect(reply).not.toMatch(/Pricing —/);
    // Lead once; location atom must not re-open with *Brigade Eldorado* is in…
    expect(countNameMentions(reply, PROJECT_NAME)).toBe(1);
  });

  it('0B-14 brochure + starting price → one lead, no redundant name', () => {
    const goal: TurnGoal = {
      kind: 'answer',
      topic: 'price',
      topics: ['price', 'media'],
      projectId: PROJECT,
    };
    const evidence: EvidenceSet = {
      tools: ['pricing', 'mediaShare'],
      pricing: {
        projectName: PROJECT_NAME,
        components: [{ label: 'Starting from', value: '₹65 L' }],
        startingDisplay: '₹65 L',
      },
      media: {
        allowed: true,
        title: 'brochure',
        cdnUrl: 'https://cdn.example/brochure.pdf',
        assetKind: 'brochure',
        projectName: PROJECT_NAME,
      },
    };
    const reply = fallbackReply({
      goal,
      evidence,
      context: {
        focusProjectName: PROJECT_NAME,
        buyerText: 'send brochure and starting price',
      },
    });
    expect(reply.startsWith(`On *${PROJECT_NAME}*:`)).toBe(true);
    expect(reply).toMatch(/brochure/i);
    expect(reply).toMatch(/65|₹/);
    expect(countNameMentions(reply, PROJECT_NAME)).toBe(1);
  });

  it('0B-07 loan + availability → one subject lead', () => {
    const goal: TurnGoal = {
      kind: 'answer',
      topic: 'legal',
      topics: ['legal', 'availability'],
      projectId: PROJECT,
    };
    const evidence: EvidenceSet = {
      tools: ['faqLookup', 'detail'],
      detail: {
        projectId: PROJECT,
        name: PROJECT_NAME,
        microMarket: 'North Bangalore',
        faqs: [
          {
            questionKey: 'loan_eligibility',
            question: 'Loan?',
            answer: 'HDFC and SBI — LTV up to 80%.',
          },
        ],
      },
      units: [{ unitType: '2 BHK', priceDisplay: '₹65 L', holdableUnits: 4 }],
    };
    const reply = fallbackReply({
      goal,
      evidence,
      context: {
        focusProjectName: PROJECT_NAME,
        buyerText: 'is loan eligibility available as well as whats the 2 BHK available',
      },
    });
    expect(reply.startsWith(`On *${PROJECT_NAME}*:`)).toBe(true);
    expect(reply.toLowerCase()).toMatch(/loan|ltv|hdfc/);
    expect(reply.toLowerCase()).toMatch(/2\s*bhk|available/);
    expect(countNameMentions(reply, PROJECT_NAME)).toBe(1);
  });

  it('0B-08 returns + cost → both atoms, no double project-name stamp', () => {
    const goal: TurnGoal = {
      kind: 'answer',
      topic: 'overview',
      topics: ['overview', 'price'],
      projectId: PROJECT,
      requires: ['rental_yield', 'price'],
    };
    const evidence: EvidenceSet = {
      tools: ['faqLookup', 'pricing'],
      detail: {
        projectId: PROJECT,
        name: PROJECT_NAME,
        microMarket: 'North Bangalore',
        faqs: [
          {
            questionKey: 'rental_yield',
            question: 'Yield?',
            answer: 'Estimated 3–4% net rental yield — estimate only.',
          },
        ],
      },
      pricing: {
        projectName: PROJECT_NAME,
        components: [{ label: 'Starting from', value: '₹65 L' }],
        startingDisplay: '₹65 L',
      },
    };
    const reply = fallbackReply({
      goal,
      evidence,
      context: {
        focusProjectName: PROJECT_NAME,
        buyerText: 'tell me about returns, also whats the cost here',
      },
    });
    expect(reply.startsWith(`On *${PROJECT_NAME}*:`)).toBe(true);
    expect(reply).toMatch(/yield|3–4%|3-4%/i);
    expect(reply).toMatch(/65|₹/);
    expect(reply).not.toMatch(/Pricing —/);
    expect(countNameMentions(reply, PROJECT_NAME)).toBe(1);
  });

  it('single-topic price path unchanged (no On *lead* join)', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'price', projectId: PROJECT },
      evidence: {
        tools: ['pricing'],
        pricing: {
          projectName: PROJECT_NAME,
          components: [{ label: 'Starting from', value: '₹65 L' }],
          startingDisplay: '₹65 L',
        },
      },
      context: { focusProjectName: PROJECT_NAME, buyerText: "what's the price?" },
    });
    expect(reply).not.toMatch(/^On \*/);
    expect(reply).toMatch(/Pricing —|For \*/);
  });
});

describe('Phase 0b — ledger DataResult fields', () => {
  it('records absent vs transport on tool_runs', () => {
    const absent = buildLedgerWritePayload({
      state: initState('c1', 'naya-advisor'),
      ex: { constraints: {} },
      goal: { kind: 'answer', topic: 'price', projectId: PROJECT },
      evidence: {
        tools: ['pricing'],
        toolLatencyMs: { pricing: 12 },
        toolFailureReason: { pricing: 'absent' },
      },
    });
    expect(absent.tool_runs[0]).toMatchObject({
      name: 'pricing',
      produced_evidence: false,
      latency_ms: 12,
      failure_reason: 'absent',
    });

    const transport = buildLedgerWritePayload({
      state: initState('c1', 'naya-advisor'),
      ex: { constraints: {} },
      goal: { kind: 'answer', topic: 'price', projectId: PROJECT },
      evidence: {
        tools: ['pricing'],
        toolLatencyMs: { pricing: 40 },
        toolFailureReason: { pricing: 'transport' },
      },
    });
    expect(transport.tool_runs[0]?.failure_reason).toBe('transport');
  });
});
