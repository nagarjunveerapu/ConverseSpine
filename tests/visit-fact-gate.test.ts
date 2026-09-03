/**
 * A visit is a fact only with a slot AND a named project — F1+F2 of
 * NayaDesk docs/designs/visit-fact-measurement.html.
 *
 * Two gates, tested separately:
 *  - the ENGINE never books from a confirm state that lost its project;
 *  - EGRESS never sends the visit_booked journey signal without the complete
 *    fact riding beside it. The old shape split them, which is how Desk
 *    accumulated 296 "booked" visits with 17 dates and 6 outcomes.
 */
import { describe, expect, it, vi } from 'vitest';
import { initState } from '../src/engine/state.js';
import { decide } from '../src/engine/phases/visit.js';
import { postTurnEgress } from '../src/turn/egress.js';

const now = new Date('2026-07-06T10:00:00+05:30');

describe('engine gate — no booking without a project', () => {
  const confirmState = (projectId: string) => ({
    ...initState('t', 'naya-advisor'),
    phase: 'visit' as const,
    visit: {
      ...(projectId ? { projectId, projectName: 'Earth Aroma' } : {}),
      awaitingConfirm: true,
      proposedIso: '2026-07-12T11:00:00+05:30',
      proposedLabel: 'Saturday at 11:00 AM',
    },
  });

  it('books normally when the confirm state carries its project', () => {
    const goal = decide(
      confirmState('earth-aroma'),
      { constraints: {}, transition: 'none', affirm: true },
      { text: 'yes', now },
    );
    expect(goal.kind).toBe('visit_booked');
    if (goal.kind === 'visit_booked') {
      expect(goal.projectId).toBe('earth-aroma');
      expect(goal.iso).toBe('2026-07-12T11:00:00+05:30');
    }
  });

  it('asks which project instead of booking when the confirm state lost it', () => {
    const goal = decide(
      confirmState(''),
      { constraints: {}, transition: 'none', affirm: true },
      { text: 'yes', now },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).toBe('project');
      // The stale confirm must not survive — a second bare "yes" would
      // otherwise book the same unattributed visit.
      expect(goal.state.awaitingConfirm).toBe(false);
    }
  });
});

describe('egress gate — the signal and the fact travel together', () => {
  function runEgress(input: { visitBooked: boolean; project_id?: string; visit_iso?: string }) {
    const postProfileObservations = vi.fn().mockResolvedValue({});
    const postJourneySignals = vi.fn().mockResolvedValue({});
    const rt = {
      crm: { postProfileObservations, postJourneySignals },
      env: {},
    } as never;
    postTurnEgress(rt, undefined, {
      builder_id: 'brigade-group',
      buyer_phone: '+919990000001',
      thread_id: 'conv:test',
      buyer_text: 'yes',
      understood: { intents: [{ kind: 'visit_booked' }], slot_writes: [] },
      ...input,
    });
    return { postProfileObservations, postJourneySignals };
  }

  it('complete fact: observation carries project + iso, signal says booked', () => {
    const { postProfileObservations, postJourneySignals } = runEgress({
      visitBooked: true,
      project_id: 'earth-aroma',
      visit_iso: '2026-07-12T11:00:00+05:30',
    });
    const obs = postProfileObservations.mock.calls[0]![0].observations;
    expect(obs).toHaveLength(1);
    expect(obs[0].value.project_id).toBe('earth-aroma');
    expect(obs[0].value.visit_iso).toBe('2026-07-12T11:00:00+05:30');
    expect(postJourneySignals.mock.calls[0]![0].signals.visit_booked).toBe(true);
  });

  it('no project: nothing is posted at all — the plan stays a plan', () => {
    const { postProfileObservations, postJourneySignals } = runEgress({
      visitBooked: true,
      visit_iso: '2026-07-12T11:00:00+05:30',
    });
    expect(postProfileObservations).not.toHaveBeenCalled();
    expect(postJourneySignals).not.toHaveBeenCalled();
  });

  it('no resolved slot: nothing is posted at all — the plan stays a plan', () => {
    const { postProfileObservations, postJourneySignals } = runEgress({
      visitBooked: true,
      project_id: 'earth-aroma',
    });
    expect(postProfileObservations).not.toHaveBeenCalled();
    expect(postJourneySignals).not.toHaveBeenCalled();
  });
});
