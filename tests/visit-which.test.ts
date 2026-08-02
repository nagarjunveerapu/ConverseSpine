import { describe, expect, it } from 'vitest';
import { applyPickToQueue, resolveWhichPick } from '../src/engine/visit-which.js';

const pool = [
  { projectId: 'a', name: 'Ayana' },
  { projectId: 'k', name: 'Krishnaja Greens' },
  { projectId: 'e', name: 'Eldorado' },
];

describe('visit-which', () => {
  it('maps all / everything / both to full set', () => {
    expect(resolveWhichPick('all of them', pool).kind).toBe('all');
    expect(resolveWhichPick('everything', pool).kind).toBe('all');
    expect(resolveWhichPick('both', pool.slice(0, 2)).kind).toBe('all');
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

  it('applyPickToQueue caps and queues', () => {
    const q = applyPickToQueue(pool, 4);
    expect(q?.projectId).toBe('a');
    expect(q?.queued).toHaveLength(2);
  });
});
