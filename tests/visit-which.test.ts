import { describe, expect, it } from 'vitest';
import { applyPickToQueue, resolveWhichPick } from '../src/engine/visit-which.js';

const pool = [
  { projectId: 'a', name: 'Ayana' },
  { projectId: 'k', name: 'Krishnaja Greens' },
  { projectId: 'e', name: 'Eldorado' },
];

describe('visit-which', () => {
  it('maps all / everything / both / dono / sab / ye sab to full set', () => {
    expect(resolveWhichPick('all of them', pool).kind).toBe('all');
    expect(resolveWhichPick('everything', pool).kind).toBe('all');
    expect(resolveWhichPick('both', pool.slice(0, 2)).kind).toBe('all');
    expect(resolveWhichPick('dono', pool.slice(0, 2)).kind).toBe('all');
    expect(resolveWhichPick('दोनों', pool.slice(0, 2)).kind).toBe('all');
    expect(resolveWhichPick('sab', pool).kind).toBe('all');
    expect(resolveWhichPick('ye sab', pool).kind).toBe('all');
    expect(resolveWhichPick('saare', pool).kind).toBe('all');
    expect(resolveWhichPick('सब', pool).kind).toBe('all');
  });

  it('parses ordinals', () => {
    const r = resolveWhichPick('1 and 3', pool);
    expect(r.kind).toBe('subset');
    if (r.kind === 'subset') {
      expect(r.projects.map((p) => p.projectId)).toEqual(['a', 'e']);
    }
  });

  it('parses names', () => {
    const r = resolveWhichPick('Eldorado please', pool);
    expect(r.kind).toBe('subset');
    if (r.kind === 'subset') {
      expect(r.projects[0]?.projectId).toBe('e');
    }
  });

  it('parses short name against Brigade-prefixed candidate', () => {
    const brigadePool = [
      { projectId: 'uts', name: 'Under The Sun' },
      { projectId: 'be', name: 'Brigade Eldorado' },
    ];
    const r = resolveWhichPick(
      'I want to visit Eldorado on Monday at 10am',
      brigadePool,
    );
    expect(r.kind).toBe('subset');
    if (r.kind === 'subset') {
      expect(r.projects.map((p) => p.projectId)).toEqual(['be']);
    }
  });

  it('does not pick on ambiguous shared token alone', () => {
    const twoBrigade = [
      { projectId: 'be', name: 'Brigade Eldorado' },
      { projectId: 'bo', name: 'Brigade Orchards' },
    ];
    expect(resolveWhichPick('Brigade please', twoBrigade).kind).toBe('none');
    const orchards = resolveWhichPick('Orchards Monday 10am', twoBrigade);
    expect(orchards.kind).toBe('subset');
    if (orchards.kind === 'subset') {
      expect(orchards.projects[0]?.projectId).toBe('bo');
    }
  });

  it('applyPickToQueue caps and queues', () => {
    const q = applyPickToQueue(pool, 4);
    expect(q?.projectId).toBe('a');
    expect(q?.queued).toHaveLength(2);
  });
});
