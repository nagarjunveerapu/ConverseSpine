import { describe, expect, it } from 'vitest';
import {
  applyWaInteractiveExtract,
  packWhatsAppInteractive,
  WA_BRIEF_YOURS,
  WA_VISIT_YOURS,
} from '../src/channel/wa-pack.js';
import { buildAdvisorNba } from '../src/advisor/nba.js';
import { fallbackReply } from '../src/engine/compose.js';
import { applyVisitBooked, initState } from '../src/engine/state.js';
import { mergeStoredVisits } from '../src/engine/visit-file.js';
import type { TurnDebug } from '../src/engine/types.js';

const CATALOG = [
  { projectId: 'brigade-cornerstone', name: 'Brigade Cornerstone' },
  { projectId: 'brigade-eldorado', name: 'Brigade Eldorado' },
];

const iso = '2026-09-16T09:30:00.000Z';

describe('Your file', () => {
  it('stamps the just-booked slot onto visitBookedCache', () => {
    const next = applyVisitBooked({
      ...initState('c1', 'brigade-group'),
      phase: 'visit',
      visit: {
        projectId: 'brigade-cornerstone',
        projectName: 'Brigade Cornerstone',
        proposedIso: iso,
        proposedLabel: 'Wednesday at 3:00 PM',
        awaitingConfirm: true,
      },
    });
    expect(next.visitBookedCache).toEqual([
      {
        projectId: 'brigade-cornerstone',
        projectName: 'Brigade Cornerstone',
        iso,
        label: 'Wednesday at 3:00 PM',
      },
    ]);
  });

  it('packs Your file after visit_booked — visits, brief, add another', () => {
    const packed = packWhatsAppInteractive({
      goal: {
        kind: 'visit_booked',
        projectId: 'brigade-cornerstone',
        projectName: 'Brigade Cornerstone',
        iso,
        label: 'Wednesday at 3:00 PM',
      },
      state: {
        ...initState('c', 'brigade-group'),
        constraints: { bhk: '3 BHK', location: 'Devanahalli' },
        visitBookedCache: [
          {
            projectId: 'brigade-cornerstone',
            projectName: 'Brigade Cornerstone',
            iso,
            label: 'Wednesday at 3:00 PM',
          },
        ],
      },
      catalogNames: CATALOG,
      singleProject: false,
      nowMs: Date.parse('2026-09-15T10:00:00.000Z'),
    });
    expect(packed.kind).toBe('list');
    if (packed.kind !== 'list') return;
    expect(packed.button).toBe('Your file');
    const ids = packed.sections[0]!.rows.map((r) => r.id);
    expect(ids).toEqual([WA_VISIT_YOURS, WA_BRIEF_YOURS, 'visit_book', 'wa.menu.projects']);
    expect(packed.sections[0]!.rows[2]!.title).toBe('Add another visit');
  });

  it('Your brief tap sets recallConstraints, not a new interview', () => {
    const extracted = applyWaInteractiveExtract(WA_BRIEF_YOURS, { constraints: {} }, CATALOG);
    expect(extracted.recallConstraints).toBe(true);
    expect(extracted.recall).toBeFalsy();
  });

  it('Advisor visit_booked chips are Your visits / Your brief with action ids', () => {
    const state = initState('advisor:nba-booked', 'naya-advisor');
    const debug: TurnDebug = {
      phase: 'visit',
      goal: {
        kind: 'visit_booked',
        projectId: 'cs',
        projectName: 'Brigade Cornerstone',
        iso,
        label: 'Wednesday at 3:00 PM',
      },
      tools: [],
      grounding: 'pass',
    };
    const nba = buildAdvisorNba(state, debug);
    expect(nba.chips).toContain('Your visits');
    expect(nba.chips).toContain('Your brief');
    expect(nba.chips).toContain('Add another stop');
    expect(nba.chip_actions?.[nba.chips.indexOf('Your visits')]).toBe(WA_VISIT_YOURS);
    expect(nba.chip_actions?.[nba.chips.indexOf('Your brief')]).toBe(WA_BRIEF_YOURS);
  });

  it('size probe copy matches the three-slot sheet', () => {
    const reply = fallbackReply({
      goal: { kind: 'probe', slot: 'bhk' },
      evidence: {},
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Brigade Group',
        channel: 'whatsapp',
        waProjectFirst: true,
        waBriefSheet: true,
      },
    });
    expect(reply).toMatch(/size, area and budget/i);
    expect(reply).not.toMatch(/how many bedrooms/i);
  });

  it('unions Desk rows with the thread cache without wiping', () => {
    const merged = mergeStoredVisits(
      [],
      [
        {
          projectId: 'brigade-cornerstone',
          projectName: 'Brigade Cornerstone',
          iso,
          label: 'Wednesday at 3:00 PM',
          confirmed: true,
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.projectName).toBe('Brigade Cornerstone');
  });
});
