import { describe, expect, it } from 'vitest';
import { deriveShadowFailures } from '../src/engine/failure-shadow.js';
import { fail, ok, summarizeFailure, type Failure } from '../src/engine/outcome.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

describe('Failure as a value — Phase 0 primitives', () => {
  it('supports partial success without converting the notice to terminal failure', () => {
    const notice: Failure = {
      kind: 'relaxed',
      stage: 'search',
      subject: 'recommendation',
      dimensions: ['size'],
    };

    expect(ok(['project-a'], [notice])).toEqual({
      ok: true,
      value: ['project-a'],
      notices: [notice],
    });
    expect(fail(notice)).toEqual({ ok: false, failure: notice });
  });

  it('removes internal detail and nearest-project data from durable summaries', () => {
    const summary = summarizeFailure({
      kind: 'no_match',
      stage: 'search',
      subject: 'budget',
      dimensions: ['budget', 'budget'],
      nearest: { projectId: 'secret-id', name: 'Nearest', display: '₹90L' },
      detail: { rawBuyerText: 'private', stack: 'internal' },
    });

    expect(summary).toEqual({
      kind: 'no_match',
      stage: 'search',
      subject: 'budget',
      dimensions: ['budget'],
    });
    expect(summary).not.toHaveProperty('detail');
    expect(summary).not.toHaveProperty('nearest');
  });
});

describe('deriveShadowFailures', () => {
  it('logs a disclosed search relaxation without changing evidence', () => {
    const evidence = { tools: ['searchProjects'], relaxed: ['budget' as const] };

    expect(
      deriveShadowFailures({
        goal: { kind: 'recommend' },
        evidence,
      }),
    ).toMatchObject([
      {
        kind: 'relaxed',
        stage: 'search',
        subject: 'recommendation',
        dimensions: ['budget'],
      },
    ]);
    expect(evidence).toEqual({ tools: ['searchProjects'], relaxed: ['budget'] });
  });

  it('records location drop as area relaxation without storing the captured value', () => {
    expect(
      deriveShadowFailures({
        goal: { kind: 'recommend' },
        evidence: { tools: ['searchProjects'] },
        droppedLocation: true,
      }),
    ).toEqual([
      {
        kind: 'relaxed',
        stage: 'search',
        subject: 'recommendation',
        dimensions: ['area'],
        detail: { event: 'desk_unrecognized_location_drop' },
      },
    ]);
  });

  it('records structured no-match and no-data evidence only', () => {
    expect(
      deriveShadowFailures({
        goal: { kind: 'no_fit' },
        evidence: {
          tools: ['searchProjects', 'projectFaq'],
          budgetGap: {
            budgetDisplay: '₹70L',
            closestName: 'Closest Project',
            closestDisplay: '₹84L',
            closestProjectId: 'closest-project',
          },
          faqMiss: { keys: ['legal.approvals'] },
        },
      }),
    ).toEqual([
      {
        kind: 'no_match',
        stage: 'search',
        subject: 'budget',
        dimensions: ['budget'],
        nearest: {
          projectId: 'closest-project',
          name: 'Closest Project',
          display: '₹84L',
        },
      },
      {
        kind: 'no_data',
        stage: 'tool',
        subject: 'legal.approvals',
      },
    ]);
  });

  it('does not infer failures from a successful ordinary turn', () => {
    expect(
      deriveShadowFailures({
        goal: { kind: 'recommend' },
        evidence: { tools: ['searchProjects'], matches: [] },
      }),
    ).toEqual([]);
  });
});

describe('FAILURE_LOG behavior gate', () => {
  it('adds ledger metadata while leaving the buyer result unchanged', async () => {
    const enabled = fakeDeps();
    const disabled = fakeDeps();
    enabled.failureLog = true;

    let enabledPlan: Record<string, unknown> | undefined;
    let disabledPlan: Record<string, unknown> | undefined;
    enabled.crm.appendTurnLedger = async (payload) => {
      enabledPlan = payload.actionPlan;
    };
    disabled.crm.appendTurnLedger = async (payload) => {
      disabledPlan = payload.actionPlan;
    };

    const common = {
      builderId: 'lokations',
      text: 'plantation in Coorg under 20 lakh',
      buyerPhone: '+919999990001',
      channel: 'whatsapp' as const,
    };
    const withLog = await runEngineTurn({ ...common, convId: 'failure-log-on' }, enabled);
    const withoutLog = await runEngineTurn({ ...common, convId: 'failure-log-off' }, disabled);

    expect(withLog.reply).toBe(withoutLog.reply);
    expect(withLog.debug.goal).toEqual(withoutLog.debug.goal);
    expect(withLog.state.constraints).toEqual(withoutLog.state.constraints);
    expect(enabledPlan).toHaveProperty('failures');
    expect(disabledPlan).not.toHaveProperty('failures');
  });
});
