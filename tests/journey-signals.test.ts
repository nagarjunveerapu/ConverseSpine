import { scrubEmbedderIdentityNoise, demoteVisitBookOnFreshSearch } from '../src/engine/extract-authority.js';
import type { Extracted } from '../src/engine/types.js';
import {
  detectTopics,
  extractFactsSync,
  isConstraintRefinementTurn,
  isLocationCorrectionTurn,
} from '../src/engine/facts.js';
import * as discover from '../src/engine/phases/discover.js';
import { buildJourneySignalPost } from '../src/engine/journey-signals.js';
import { describe, expect, it } from 'vitest';
import { initState, commitTo, recordOffered, recordDiscussed, clearLastOffered, constraintsMateriallyChanged } from '../src/engine/state.js';
import type { EvidenceSet, TurnGoal } from '../src/engine/types.js';
import { hasExplicitProjectCue, facetNameResidue, detectFocusedSwitchIntent } from '../src/engine/project_switch.js';
import { shouldQueryProjectVectors } from '../src/engine/adapters/semantic-nlu.js';

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

  it('focused bare visit_book does not query PROJECT_VECTORS (VIS-01)', () => {
    expect(
      shouldQueryProjectVectors(
        'I want to visit',
        {
          constraints: {},
          transition: 'want_visit',
          speechAct: 'visit_book',
        },
        { phase: 'focused', offeredProjectNames: ['Ayana', 'Clarks Exotica'] },
      ),
    ).toBe(false);
  });

  it('scrub drops Desire Spaces invent on focused visit_book', () => {
    const scrubbed = scrubEmbedderIdentityNoise(
      'I want to visit',
      'focused',
      {
        constraints: {},
        transition: 'want_visit',
        speechAct: 'visit_book',
        namedProjects: [{ projectId: 'desire-spaces-lokations', name: 'Desire Spaces' }],
      },
      [{ name: 'Ayana' }, { name: 'Clarks Exotica' }],
    );
    expect(scrubbed.namedProjects).toBeUndefined();
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

describe('P2 multi-act + P3 soft prefs', () => {
  it('search + want_visit without named project → recommend first', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      constraints: { location: 'North Bangalore', budgetMaxInr: 15_000_000, propertyType: 'apartment' },
      turnCount: 1,
      discover: { ...initState('c1', 'brigade-group').discover, oriented: true },
    };
    const goal = discover.decide(s, {
      constraints: s.constraints,
      transition: 'want_visit',
      speechAct: 'search',
    });
    expect(goal.kind).toBe('recommend');
  });

  it('search + want_visit with embedder namedProjects on empty board → recommend', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      constraints: { location: 'North Bangalore', budgetMaxInr: 15_000_000, propertyType: 'apartment' },
      turnCount: 1,
      discover: { ...initState('c1', 'brigade-group').discover, oriented: true },
    };
    const goal = discover.decide(s, {
      constraints: s.constraints,
      transition: 'want_visit',
      speechAct: 'visit_book',
      namedProjects: [
        { projectId: 'oasis', name: 'Brigade Oasis' },
        { projectId: 'meadows', name: 'Brigade Meadows' },
      ],
      askTopic: 'compare',
      compareProjectIds: ['oasis', 'meadows'],
    });
    expect(goal.kind).toBe('recommend');
  });

  it('STY-02: ready to move is soft pref, not availability topic; location lands', () => {
    const text =
      'hi we are a family of 4 looking for 3BHK in North Bangalore under 1.2 Cr preferably ready to move near airport with good schools nearby';
    expect(detectTopics(text)).not.toContain('availability');
    expect(detectTopics(text)).not.toContain('location');
    const ex = extractFactsSync(text, initState('c1', 'brigade-group'));
    expect(ex.constraints.location).toMatch(/north bangalore/i);
    expect(ex.constraints.readyToMove).toBe(true);
    expect(ex.constraints.nearAirport).toBe(true);
    expect(ex.askTopics ?? []).not.toContain('availability');
  });

  it('demoteVisitBookOnFreshSearch keeps search primary on empty board', () => {
    const r = demoteVisitBookOnFreshSearch(
      'Apartment in North Bangalore under 1.5 Cr and I want to visit',
      initState('c1', 'brigade-group'),
      {
        primary: {
          id: 'chip.visit_book',
          act: 'visit_book',
          source: 'free_text',
          confidence: 'rule',
        },
        secondary: null,
        speechAct: 'visit_book',
        chipPathIds: ['chip.visit_book'],
      },
    );
    expect(r.speechAct).toBe('search');
    expect(r.primary).toBeNull();
  });

  it('searchFilters does not invent nearAirport localities or readyToMove searchText', () => {
    const f = discover.searchFilters({
      location: 'North Bangalore',
      nearAirport: true,
      readyToMove: true,
    });
    expect(f.locations).toBe('North Bangalore');
    expect(f.searchText).toBeUndefined();
  });

  it('desk identity hit when match_reasons echo buyer location', () => {
    const hit = discover.deskLocationIdentityHit(
      {
        projectId: 'eldorado',
        name: 'Brigade Eldorado',
        microMarket: 'Aerospace Park / Devanahalli Corridor',
        startingPriceInr: 3_100_000,
        startingPriceDisplay: '₹31 L',
        matchReasons: ['North Bangalore ✓'],
      },
      ['North Bangalore'],
    );
    expect(hit).toBe(true);
  });

  it('matchMicroMarket is structural overlap only — no Spine place catalog', () => {
    expect(discover.matchMicroMarket('North Bangalore', 'North Bangalore')).toBe(true);
    expect(discover.matchMicroMarket('Aerospace Park / Devanahalli Corridor', 'North Bangalore')).toBe(false);
    expect(discover.matchMicroMarket('Devanahalli', 'Devanahalli')).toBe(true);
    expect(
      discover.filterSearchMatches(
        [
          {
            projectId: 'eldorado',
            name: 'Brigade Eldorado',
            microMarket: 'Aerospace Park / Devanahalli Corridor',
            startingPriceInr: 3_100_000,
            startingPriceDisplay: '₹31 L',
          },
        ],
        { location: 'North Bangalore' },
        [],
        { locationAliases: ['Devanahalli', 'Aerospace Park'] },
      ),
    ).toHaveLength(1);
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
