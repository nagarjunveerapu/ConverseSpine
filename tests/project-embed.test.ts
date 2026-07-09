import { describe, expect, it } from 'vitest';
import {
  collectNamedProjectsFromMatches,
  PROJECT_VECTOR_THRESHOLD,
} from '../src/engine/adapters/semantic-nlu.js';

describe('collectNamedProjectsFromMatches', () => {
  it('dedupes by project_id and keeps best score', () => {
    const named = collectNamedProjectsFromMatches([
      { score: 0.7, metadata: { project_id: 'krishnaja', name: 'Krishnaja Greens' } },
      { score: 0.82, metadata: { project_id: 'krishnaja', name: 'Krishnaja Greens' } },
      { score: 0.68, metadata: { project_id: 'ayana', name: 'Ayana' } },
    ]);
    expect(named).toEqual([
      { projectId: 'krishnaja', name: 'Krishnaja Greens' },
      { projectId: 'ayana', name: 'Ayana' },
    ]);
  });

  it('drops matches below threshold', () => {
    const named = collectNamedProjectsFromMatches(
      [{ score: 0.5, metadata: { project_id: 'krishnaja', name: 'Krishnaja Greens' } }],
      PROJECT_VECTOR_THRESHOLD,
    );
    expect(named).toEqual([]);
  });

  it('returns empty for topic-only text matches (no project metadata)', () => {
    expect(collectNamedProjectsFromMatches([{ score: 0.9, metadata: { phrase: 'legal details' } }])).toEqual(
      [],
    );
  });
});
