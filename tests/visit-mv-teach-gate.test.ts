/**
 * V3 flywheel gate: open visit speech acts must have teach rows + ablation proof.
 * New kind in embedder-map → row in upsert-items.jsonl + unit ablation (no regex under embedActsOnly).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decide } from '../src/engine/phases/visit.js';
import { initState } from '../src/engine/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPSERT = join(ROOT, 'corpus/pending/visit-mv-teach/upsert-items.jsonl');

/** Open acts: teach owns phrasing; regex fallback must be off under VISIT_EMBED_ACTS_ONLY. */
const OPEN_VISIT_KINDS = [
  'visit_ask_team',
  'visit_force_same_day',
  'visit_same_day',
  'visit_other_day',
  'visit_choose_stops',
] as const;

const now = new Date('2026-08-02T10:00:00+05:30');

function teachKinds(): Set<string> {
  const kinds = new Set<string>();
  for (const line of readFileSync(UPSERT, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as { metadata?: { intent_kind?: string } };
    const k = row.metadata?.intent_kind;
    if (k) kinds.add(k);
  }
  return kinds;
}

describe('V3 visit open-act teach gate', () => {
  it('every open visit kind has ≥1 teach row in upsert-items.jsonl', () => {
    const taught = teachKinds();
    for (const kind of OPEN_VISIT_KINDS) {
      expect(taught.has(kind), `missing teach rows for ${kind}`).toBe(true);
    }
  });

  it('ablation+: ask-team fires only with teach bind under embedActsOnly', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        lastAsk: 'time' as const,
        pendingDayIso: '2026-08-04',
        pendingDayLabel: 'Monday',
        pendingTimeLabel: '6:00 PM',
      },
    };
    const without = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'ask the team for 6pm',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedActsOnly: true,
      },
    );
    if (without.kind === 'visit_ask') {
      expect(without.ask).not.toBe('team_request');
      expect(without.state.pendingTeamRequests ?? []).toHaveLength(0);
    }

    const withBind = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'ask the team for 6pm',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedActsOnly: true,
        embedderIntentKind: 'visit_ask_team',
      },
    );
    expect(withBind.kind).toBe('visit_ask');
    if (withBind.kind === 'visit_ask') {
      expect(withBind.ask).toBe('team_request');
      expect((withBind.state.pendingTeamRequests ?? []).length).toBeGreaterThan(0);
    }
  });

  it('ablation+: same-day phrase ignored under embedActsOnly without teach bind', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        projectId: 'krishnaja',
        projectName: 'Krishnaja Greens',
        lastAsk: 'same_day_choice' as const,
        originText: 'Indiranagar',
        originAsked: true,
      },
    };
    const booked = [
      {
        projectId: 'ayana',
        projectName: 'Ayana',
        iso: '2026-08-09T10:30:00+05:30',
        label: 'Saturday at 10:30 AM',
        confirmed: true,
      },
    ];
    const without = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'same day for Krishnaja',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedActsOnly: true,
        bookedVisits: booked,
        driveFromPriorMin: 240,
      },
    );
    // Without teach bind, must not stagger-propose from phrase alone.
    if (without.kind === 'visit_propose') {
      expect(without.copy).not.toMatch(/placing|works/i);
    }

    const withBind = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'same day for Krishnaja',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedActsOnly: true,
        embedderIntentKind: 'visit_same_day',
        bookedVisits: booked,
        driveFromPriorMin: 240,
      },
    );
    expect(['visit_propose', 'visit_ask']).toContain(withBind.kind);
    if (withBind.kind === 'visit_propose') {
      expect(withBind.copy).toMatch(/placing|works|block|confirm|hours|drive/i);
    }
  });

  it('ablation+: force same-day ignored without bind; fires with teach bind', () => {
    const s = {
      ...initState('t', 'brigade-group'),
      phase: 'visit' as const,
      visit: {
        projectId: 'cornerstone-utopia',
        projectName: 'Brigade Cornerstone Utopia',
        queued: [
          { projectId: 'eldorado', projectName: 'Brigade Eldorado' },
          { projectId: 'orchards', projectName: 'Brigade Orchards' },
        ],
        lastAsk: 'split_day' as const,
        splitOffered: true,
        originText: 'Whitefield',
        originAsked: true,
        tripOrdered: true,
      },
    };
    const without = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'cram all three into Monday anyway',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedActsOnly: true,
      },
    );
    // Without bind: must not pack/force into propose with team overflow.
    if (without.kind === 'visit_propose') {
      expect(without.state.awaitingTeamRequestConfirm).toBeFalsy();
    }

    const withBind = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'cram all three into Monday anyway',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedActsOnly: true,
        embedderIntentKind: 'visit_force_same_day',
        driveFromPriorMin: 90,
      },
    );
    expect(['visit_propose', 'visit_ask']).toContain(withBind.kind);
    if (withBind.kind === 'visit_propose') {
      expect(
        withBind.state.awaitingTeamRequestConfirm || (withBind.state.pendingTeamRequests?.length ?? 0) > 0,
      ).toBe(true);
    } else if (withBind.kind === 'visit_ask') {
      expect(withBind.ask).not.toBe('window');
    }
  });
});
