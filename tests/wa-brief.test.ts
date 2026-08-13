import { describe, expect, it } from 'vitest';
import {
  applyWaBriefPatch,
  isWaAdvisorBriefReady,
  nextWaBriefStep,
  patchFromWaBriefAction,
  waBriefRows,
} from '../src/channel/wa-brief.js';
import { decide } from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';
import { packWhatsAppInteractive } from '../src/channel/wa-pack.js';

describe('WA Advisor brief ladder', () => {
  it('walks purpose → budget → type → bhk → location → worries → schools → hub → priority', () => {
    let c = {};
    const asked: never[] = [];
    expect(nextWaBriefStep(c, asked)).toBe('purpose');
    c = { purpose: 'self_use' };
    expect(nextWaBriefStep(c, [])).toBe('budget');
    c = { ...c, budgetMaxInr: 70_00_000 };
    expect(nextWaBriefStep(c, [])).toBe('propertyType');
    c = { ...c, propertyType: 'Apartment' };
    expect(nextWaBriefStep(c, [])).toBe('bhk');
    c = { ...c, bhk: '2 BHK' };
    expect(nextWaBriefStep(c, [])).toBe('bhk'); // until Done
    expect(nextWaBriefStep(c, ['bhk'])).toBe('location');
    c = { ...c, location: 'Aerospace Park / Devanahalli Corridor' };
    expect(nextWaBriefStep(c, ['bhk'])).toBe('worries');
    c = { ...c, worries: ['nothing specific'] };
    expect(nextWaBriefStep(c, ['bhk'])).toBe('schools');
    c = { ...c, schoolsMentioned: true };
    expect(nextWaBriefStep(c, ['bhk'])).toBe('hub');
    c = { ...c, commuteHub: 'Whitefield / ITPL' };
    expect(nextWaBriefStep(c, ['bhk'])).toBe('priority');
    c = { ...c, priorityFocus: 'commute' as const };
    expect(nextWaBriefStep(c, ['bhk'])).toBeUndefined();
    expect(isWaAdvisorBriefReady(c, ['bhk'])).toBe(true);
  });

  it('skipBrief after Self-use shows the book, not the next Advisor probe', () => {
    let s = initState('c', 'brigade-group');
    s = applyWaBriefPatch(s, patchFromWaBriefAction('wa.brief.purpose.self_use', s)!);
    s = { ...s, turnCount: 1 };
    const g = decide(s, { constraints: s.constraints }, 'Self-use', { skipBrief: true });
    expect(g).toEqual({ kind: 'recommend' });
  });

  it('budget chip parses a ceiling', () => {
    const s = initState('c', 'brigade-group');
    const patch = patchFromWaBriefAction('wa.brief.budget.50_70l', s);
    expect(patch?.constraints?.budgetMaxInr).toBe(70_00_000);
  });

  it('2 BHK then 3 BHK merges; Done advances', () => {
    let s = initState('c', 'brigade-group');
    s = applyWaBriefPatch(s, patchFromWaBriefAction('wa.brief.bhk.2', s)!);
    s = applyWaBriefPatch(s, patchFromWaBriefAction('wa.brief.bhk.3', s)!);
    expect(s.constraints.bhk).toBe('2 BHK, 3 BHK');
    expect(s.discover.asked.includes('bhk')).toBe(false);
    const mid = {
      purpose: 'self_use' as const,
      propertyType: 'Apartment',
      budgetMaxInr: 70_00_000,
      bhk: s.constraints.bhk,
    };
    expect(nextWaBriefStep(mid, s.discover.asked)).toBe('bhk');
    s = applyWaBriefPatch(s, patchFromWaBriefAction('wa.brief.bhk.done', s)!);
    expect(s.discover.asked).toContain('bhk');
  });

  it('location list uses catalog markets plus Open to suggestions', () => {
    const rows = waBriefRows('location', ['Aerospace Park / Devanahalli Corridor', 'Whitefield']);
    expect(rows.some((r) => r.id === 'wa.brief.loc.open')).toBe(true);
    expect(rows.some((r) => /aerospace/i.test(r.id))).toBe(true);
  });

  it('recommend with matches packs a match list, not the purpose tray', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'recommend' },
      state: {
        ...initState('c', 'brigade-group'),
        constraints: {
          purpose: 'self_use',
          budgetMaxInr: 70_00_000,
          propertyType: 'Apartment',
          bhk: '2 BHK',
          location: 'Devanahalli',
          worries: ['nothing specific'],
          schoolsMentioned: true,
          commuteHub: 'Whitefield / ITPL',
          priorityFocus: 'commute',
        },
        discover: {
          ...initState('c', 'brigade-group').discover,
          asked: ['bhk'],
        },
      },
      catalogNames: [
        {
          projectId: 'brigade-eldorado',
          name: 'Brigade Eldorado',
          description: '✓ 4 schools, nearest 5 min · within budget',
        },
      ],
      singleProject: false,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      expect(packed.button).toBe('See matches');
      expect(packed.sections[0]!.rows[0]!.id).toBe('wa.pick.brigade-eldorado');
    }
  });
});
