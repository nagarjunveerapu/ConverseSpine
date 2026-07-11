import { describe, expect, it } from 'vitest';
import { buildJourneySignalPost } from '../src/engine/journey-signals.js';
import { initState, commitTo, recordOffered, recordDiscussed, clearLastOffered, constraintsMateriallyChanged } from '../src/engine/state.js';
import type { EvidenceSet, TurnGoal } from '../src/engine/types.js';
import { hasExplicitProjectCue, facetNameResidue, detectFocusedSwitchIntent } from '../src/engine/project_switch.js';
import { shouldQueryProjectVectors } from '../src/engine/adapters/semantic-nlu.js';
import { scrubEmbedderIdentityNoise } from '../src/engine/extract-authority.js';
import type { Extracted } from '../src/engine/types.js';
import { isConstraintRefinementTurn, isLocationCorrectionTurn } from '../src/engine/facts.js';

describe('buildJourneySignalPost (W5)', () => {
  it('maps recommend → recommendation_served + shortlist_add', () => {
    const s = initState('c1', 'brigade-group');
    const goal: TurnGoal = { kind: 'recommend' };
    const evidence: EvidenceSet = {
      tools: ['search'],
      matches: [
        {
          projectId: 'brigade-eldorado',
          name: 'Brigade Eldorado',
          microMarket: 'Devanahalli',
          startingPriceInr: 3_100_000,
          startingPriceDisplay: '₹31 L',
          matchReasons: [],
        },
      ],
    };
    const post = buildJourneySignalPost(goal, s, evidence);
    expect(post.signals.recommendation_served).toBe(true);
    expect(post.shortlistAdd).toContain('brigade-eldorado');
  });

  it('maps commit → project_committed', () => {
    const s = initState('c1', 'lokations');
    const goal: TurnGoal = {
      kind: 'commit',
      projectId: 'ayana-lokations',
      projectName: 'Ayana',
    };
    const post = buildJourneySignalPost(goal, s, { tools: [] });
    expect(post.signals.project_committed).toBe(true);
    expect(post.shortlistAdd).toContain('ayana-lokations');
  });

  it('counts facts_known from constraints', () => {
    let s = initState('c1', 'brigade-group');
    s = {
      ...s,
      constraints: { location: 'Whitefield', budgetMaxInr: 15_000_000, bhk: '3 BHK' },
    };
    const post = buildJourneySignalPost({ kind: 'greet' }, s, { tools: [] });
    expect(post.signals.facts_known).toBe(3);
    expect(post.signals.goal_known).toBe(true);
  });

  it('maps visit_booked', () => {
    const s = initState('c1', 'lokations');
    const goal: TurnGoal = {
      kind: 'visit_booked',
      projectId: 'ayana-lokations',
      projectName: 'Ayana',
      label: 'Monday 9 AM',
      iso: '2026-07-14T09:00:00+05:30',
    };
    const post = buildJourneySignalPost(goal, s, { tools: [] });
    expect(post.signals.visit_booked).toBe(true);
    expect(post.signals.visit_date).toBe('2026-07-14');
  });
});

describe('hasExplicitProjectCue / sticky scrub (W1)', () => {
  it('BSP dump is not an explicit project cue', () => {
    expect(hasExplicitProjectCue("what's the BSP and carpet area and possession date")).toBe(false);
    expect(facetNameResidue("what's the BSP and carpet area and possession date").length).toBeLessThan(3);
  });

  it('back to Ayana is an explicit cue', () => {
    expect(hasExplicitProjectCue('back to Ayana')).toBe(true);
  });

  it('does not hardcode catalog brand names', () => {
    expect(hasExplicitProjectCue('Ayana')).toBe(false);
    expect(hasExplicitProjectCue('Eldorado price')).toBe(true); // residue + price facet
    expect(hasExplicitProjectCue('brochure for Eldorado')).toBe(true);
    expect(hasExplicitProjectCue('Krishnaja Greens pricing')).toBe(true);
  });

  it('brochure bhejo does not switch on vector noise', () => {
    const s = commitTo(initState('c1', 'lokations'), 'ayana-lokations', 'Ayana');
    const ex: Extracted = {
      constraints: {},
      transition: 'none',
      askTopic: 'media',
      askTopics: ['media'],
      namedProjects: [{ projectId: 'desire-spaces-lokations', name: 'Desire Spaces' }],
    };
    expect(detectFocusedSwitchIntent('brochure bhejo', ex, s)).toBeNull();
  });

  it('focused vectors blocked on BSP ask', () => {
    expect(
      shouldQueryProjectVectors(
        "what's the BSP and carpet area and possession date",
        {
          constraints: {},
          transition: 'none',
          askTopic: 'price',
          askTopics: ['price'],
          speechAct: 'answer',
        },
        { phase: 'focused' },
      ),
    ).toBe(false);
  });

  it('scrub drops Desire Spaces on expert price ask', () => {
    const ex: Extracted = {
      constraints: {},
      transition: 'none',
      askTopic: 'price',
      askTopics: ['price'],
      namedProjects: [{ projectId: 'desire-spaces-lokations', name: 'Desire Spaces' }],
    };
    const scrubbed = scrubEmbedderIdentityNoise(
      "what's the BSP and carpet area and possession date",
      'focused',
      ex,
    );
    expect(scrubbed.namedProjects).toBeUndefined();
  });
});

describe('W2 lastOffered invalidation (no catalog hardcode)', () => {
  it('detects material constraint deltas', () => {
    expect(
      constraintsMateriallyChanged(
        { location: 'Devanahalli', budgetMaxInr: 12_000_000 },
        { location: 'Whitefield', budgetMaxInr: 12_000_000 },
      ),
    ).toBe(true);
    expect(
      constraintsMateriallyChanged(
        { location: 'Whitefield', bhk: '3 BHK' },
        { location: 'Whitefield', bhk: '2 BHK' },
      ),
    ).toBe(true);
    expect(
      constraintsMateriallyChanged({ location: 'Whitefield' }, { location: 'Whitefield' }),
    ).toBe(false);
  });

  it('clearLastOffered empties board', () => {
    let s = initState('c1', 'brigade-group');
    s = recordOffered(s, [
      {
        projectId: 'a',
        name: 'A',
        microMarket: 'x',
        startingPriceInr: 1,
        startingPriceDisplay: '1',
        matchReasons: [],
      },
    ]);
    expect(s.discover.lastOffered).toHaveLength(1);
    s = clearLastOffered(s);
    expect(s.discover.lastOffered).toHaveLength(0);
  });

  it('refine/correction detectors stay structural', () => {
    expect(isLocationCorrectionTurn('wait I meant Whitefield not Devanahalli')).toBe(true);
    expect(isConstraintRefinementTurn('change to 2BHK under 70L')).toBe(true);
    expect(isConstraintRefinementTurn('Send brochure')).toBe(false);
  });
});
