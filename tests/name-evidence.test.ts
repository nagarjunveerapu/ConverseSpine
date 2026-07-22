/**
 * Name-evidence precision floor — the fix for state-dependent focus steals
 * (4q-fix2 scorecard root cause #1: Century Breeze hijacks, wrong-sibling
 * Cornerstone→Utopia, "and krishnaja greens?" blocked by the pool gate).
 * Every case below is a verbatim buyer line from the replay transcripts.
 */
import { describe, expect, it } from 'vitest';
import {
  detectFocusedSwitchIntent,
  filterNamedProjectsByEvidence,
  nameEvidenceIn,
} from '../src/engine/project_switch.js';
import { scrubEmbedderIdentityNoise } from '../src/engine/extract-authority.js';
import type { ConversationState, Extracted, OfferedProject } from '../src/engine/types.js';

const ELDORADO: OfferedProject = { projectId: 'brigade-eldorado', name: 'Brigade Eldorado' };
const CORNERSTONE: OfferedProject = { projectId: 'brigade-cornerstone', name: 'Brigade Cornerstone' };
const UTOPIA: OfferedProject = {
  projectId: 'brigade-cornerstone-utopia',
  name: 'Brigade Cornerstone Utopia',
};
const ORCHARDS: OfferedProject = { projectId: 'brigade-orchards', name: 'Brigade Orchards' };
const CENTURY: OfferedProject = { projectId: 'century-breeze', name: 'Century Breeze' };
const AYANA: OfferedProject = { projectId: 'ayana', name: 'Ayana' };
const KRISHNAJA: OfferedProject = { projectId: 'krishnaja-greens', name: 'Krishnaja Greens' };
const VANAM: OfferedProject = { projectId: 'vanam', name: 'Vanam' };

const BOARD = [ELDORADO, CORNERSTONE, ORCHARDS];

describe('nameEvidenceIn', () => {
  it('full on exact name in text', () => {
    expect(nameEvidenceIn('tell me about brigade eldorado', 'Brigade Eldorado')).toBe('full');
  });
  it('full on typo within one edit ("conerstone")', () => {
    expect(nameEvidenceIn('tell me about Conerstone', 'Brigade Cornerstone')).toBe('full');
  });
  it('partial when only one distinctive token of a longer name appears', () => {
    expect(nameEvidenceIn('tell me about Conerstone', 'Brigade Cornerstone Utopia')).toBe('partial');
  });
  it('none when the buyer never named the project', () => {
    expect(nameEvidenceIn('fine. take home 85k. 13L down payment', 'Century Breeze')).toBe('none');
    expect(nameEvidenceIn('which of these two is the safer bet', 'Ayana')).toBe('none');
    expect(
      nameEvidenceIn(
        'most weekends hopefully. and honestly my biggest fear is the builder disappearing with my money',
        'Century Breeze',
      ),
    ).toBe('none');
  });
  it('short names stay exact-only (no fuzzy on 5-char tokens)', () => {
    expect(nameEvidenceIn('vanam', 'Vanam')).toBe('full');
    expect(nameEvidenceIn('vanamm', 'Vanam')).toBe('none');
  });
});

describe('filterNamedProjectsByEvidence', () => {
  it('kills a proposal the buyer never typed (Century Breeze steal)', () => {
    expect(
      filterNamedProjectsByEvidence('fine. take home 85k. 13L down payment', [CENTURY], BOARD),
    ).toEqual([]);
  });

  it('keeps only the named project when a steal rides along', () => {
    const out = filterNamedProjectsByEvidence(
      "Trade-offs on Eldorado? Don't sell me.",
      [CENTURY, ELDORADO],
      BOARD,
    );
    expect(out).toEqual([ELDORADO]);
  });

  it('resolves "conerstone" to the board sibling, not the global Utopia', () => {
    const out = filterNamedProjectsByEvidence('tell me about Conerstone', [UTOPIA], BOARD);
    expect(out).toEqual([CORNERSTONE]);
  });

  it('explicit "cornerstone utopia" beats the plain board sibling (superset rule)', () => {
    const out = filterNamedProjectsByEvidence(
      'cornerstone utopia details please',
      [UTOPIA],
      BOARD,
    );
    expect(out).toEqual([UTOPIA]);
  });

  it('bare project name on an empty board survives', () => {
    expect(filterNamedProjectsByEvidence('vanam', [VANAM], [])).toEqual([VANAM]);
  });

  it('never invents: empty proposal stays empty even when the pool matches', () => {
    expect(filterNamedProjectsByEvidence('tell me about eldorado', [], BOARD)).toEqual([]);
  });
});

function focusedState(focus: OfferedProject, offered: OfferedProject[]): ConversationState {
  return {
    phase: 'focused',
    focus: { projectId: focus.projectId, projectName: focus.name },
    discover: { lastOffered: offered, discussedProjects: [] },
    constraints: {},
  } as unknown as ConversationState;
}

describe('detectFocusedSwitchIntent — typed name beats the pool gate', () => {
  it('"and krishnaja greens?" switches off Ayana even though Krishnaja is off-board', () => {
    const s = focusedState(AYANA, [AYANA, VANAM]);
    const ex = { namedProjects: [KRISHNAJA], askTopic: 'overview' } as unknown as Extracted;
    const intent = detectFocusedSwitchIntent('and krishnaja greens?', ex, s);
    expect(intent?.commit.projectId).toBe('krishnaja-greens');
  });

  it('sticky facet with no typed name still stays on focus (vector noise)', () => {
    const s = focusedState(AYANA, [AYANA, VANAM]);
    const ex = { namedProjects: [CENTURY], askTopic: 'price' } as unknown as Extracted;
    expect(detectFocusedSwitchIntent('price?', ex, s)).toBeNull();
  });
});

describe('scrubEmbedderIdentityNoise — floor applies in every phase', () => {
  it('discover phase with a live board: steal proposal is dropped', () => {
    const scrubbed = scrubEmbedderIdentityNoise(
      'fine. take home 85k. 13L down payment',
      'discover',
      { namedProjects: [CENTURY], constraints: {} } as unknown as Extracted,
      BOARD,
    );
    expect(scrubbed.namedProjects).toBeUndefined();
  });

  it('discover phase: typo-named board sibling replaces the global proposal', () => {
    const scrubbed = scrubEmbedderIdentityNoise(
      'tell me about Conerstone',
      'discover',
      { namedProjects: [UTOPIA], constraints: {} } as unknown as Extracted,
      BOARD,
    );
    expect(scrubbed.namedProjects).toEqual([CORNERSTONE]);
  });

  it('focused detail-ask keeps a fully-typed off-pool name (krishnaja bypass)', () => {
    const scrubbed = scrubEmbedderIdentityNoise(
      'and krishnaja greens?',
      'focused',
      { namedProjects: [KRISHNAJA], askTopic: 'overview', constraints: {} } as unknown as Extracted,
      [AYANA, VANAM],
    );
    expect(scrubbed.namedProjects).toEqual([KRISHNAJA]);
  });
});
